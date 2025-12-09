#!/bin/bash
# =============================================================================
# Local Development Script - Supports both Docker and Podman
# =============================================================================
#
# Usage:
#   ./scripts/dev.sh start              # Start all services
#   ./scripts/dev.sh stop               # Stop all services
#   ./scripts/dev.sh status             # Show running services
#   ./scripts/dev.sh logs               # Follow app logs
#   ./scripts/dev.sh init-ollama        # Download LLM model
#   ./scripts/dev.sh observability      # Start Langfuse/Prometheus/Grafana
#   ./scripts/dev.sh observability-stop # Stop monitoring stack
#   ./scripts/dev.sh clean              # Remove all containers and volumes
#
# =============================================================================

set -e

# Auto-detect container runtime (prefer Podman)
if command -v podman &> /dev/null; then
    RUNTIME="podman"

    # Check if Podman machine is running (macOS/Windows)
    if [[ "$(uname)" == "Darwin" ]] || [[ "$(uname)" =~ MINGW|CYGWIN ]]; then
        if ! podman machine inspect &> /dev/null 2>&1; then
            echo "⚠️  Podman machine not initialized. Setting up..."
            echo "   This may take a few minutes on first run..."
            podman machine init --cpus 4 --memory 8192 --disk-size 50
        fi

        if ! podman info &> /dev/null 2>&1; then
            echo "⚠️  Podman machine not running. Starting..."
            podman machine start
            # Wait for machine to be ready
            for i in {1..30}; do
                if podman info &> /dev/null 2>&1; then
                    break
                fi
                sleep 1
            done
        fi
    fi

    # Prefer native 'podman compose' over 'podman-compose' (more stable)
    if podman compose version &> /dev/null 2>&1; then
        COMPOSE="podman compose"
    elif command -v podman-compose &> /dev/null; then
        COMPOSE="podman-compose"
    else
        echo "⚠️  No compose tool found. Installing podman-compose..."
        if command -v pip3 &> /dev/null; then
            pip3 install podman-compose
            COMPOSE="podman-compose"
        elif command -v brew &> /dev/null; then
            brew install podman-compose
            COMPOSE="podman-compose"
        else
            echo "❌ Please install podman-compose: pip3 install podman-compose"
            exit 1
        fi
    fi

elif command -v docker &> /dev/null; then
    RUNTIME="docker"
    COMPOSE="docker compose"  # Docker Compose V2 syntax

    # Check if Docker daemon is running
    if ! docker info &> /dev/null 2>&1; then
        echo "❌ Docker daemon is not running!"
        echo "   Please start Docker Desktop or the Docker service."
        exit 1
    fi
else
    echo "❌ Neither Podman nor Docker found. Please install one:"
    echo "   Podman (recommended, free): brew install podman"
    echo "   Docker: https://docker.com"
    exit 1
fi

echo "🐳 Using container runtime: $RUNTIME"
echo "🔧 Using compose command: $COMPOSE"

# Project root directory
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; }

# =============================================================================
# Commands
# =============================================================================

cmd_start() {
    log_info "Starting core services..."
    $COMPOSE up -d redis memcached ollama

    log_info "Waiting for services to be healthy..."
    sleep 5

    log_info "Starting application..."
    $COMPOSE up -d app

    log_success "Services started!"
    echo ""
    echo "📍 Application:  http://localhost:8083"
    echo "📍 Ollama:       http://localhost:11434"
    echo "📍 Swagger:      http://localhost:8083/swaggers"
    echo ""
    echo "💡 First time? Run: ./scripts/dev.sh init-ollama"
}

cmd_stop() {
    log_info "Stopping all services..."
    $COMPOSE down
    log_success "Services stopped!"
}

cmd_scale() {
    local instances=${1:-3}
    log_info "Scaling app to $instances instances..."

    # Start nginx for load balancing
    $COMPOSE --profile scaled up -d nginx
    $COMPOSE up -d --scale app=$instances

    log_success "Scaled to $instances instances!"
    echo ""
    echo "📍 Load Balancer: http://localhost:80"
}

cmd_logs() {
    local service=${1:-app}
    log_info "Following logs for: $service"
    $COMPOSE logs -f $service
}

cmd_init_ollama() {
    local model="${1:-phi3:mini}"

    log_info "Downloading $model model..."
    log_info "Model will be stored in container volume 'llm-ollama-models'"

    # Check if Ollama container is running
    if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
        log_warning "Ollama container not running. Starting..."
        $COMPOSE up -d ollama
        log_info "Waiting for Ollama to be ready..."

        # Wait for Ollama to be healthy
        for i in {1..30}; do
            if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
                break
            fi
            sleep 2
        done
    fi

    # Pull the model using container's ollama
    log_info "Pulling model inside container..."
    if [ "$RUNTIME" = "podman" ]; then
        podman exec -it "$(podman ps -q -f name=ollama | head -1)" ollama pull "$model"
    else
        docker exec -it "$(docker ps -q -f name=ollama | head -1)" ollama pull "$model"
    fi

    log_success "Model '$model' downloaded! Stored in persistent volume."
    echo ""
    echo "💡 The model is cached in Docker/Podman volume 'llm-ollama-models'"
    echo "   It will persist across container restarts."
    echo ""
    echo "   To use this model, set in .env:"
    echo "   OLLAMA_MODEL=$model"
}

cmd_ollama_list() {
    log_info "Available models in container:"

    if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
        log_error "Ollama container not running!"
        echo "Start it with: ./scripts/dev.sh start"
        exit 1
    fi

    curl -s http://localhost:11434/api/tags | grep -o '"name":"[^"]*"' | cut -d'"' -f4

    echo ""
    echo "💡 To pull more models:"
    echo "   ./scripts/dev.sh init-ollama mistral:7b-instruct"
    echo "   ./scripts/dev.sh init-ollama qwen2.5:1.5b"
}

cmd_observability() {
    log_info "Starting observability stack (Langfuse, Prometheus, Grafana)..."

    # Start the database first
    log_info "Starting Langfuse database..."
    $COMPOSE --profile observability up -d langfuse-db

    log_info "Waiting for database to be ready..."
    sleep 10

    # Start remaining observability services
    log_info "Starting observability services..."
    $COMPOSE --profile observability up -d

    log_info "Waiting for services to initialize..."
    sleep 5

    log_success "Observability stack started!"
    echo ""
    echo "📊 Langfuse:    http://localhost:3000 (LLM tracing & analytics)"
    echo "📊 Prometheus:  http://localhost:9090 (metrics collection)"
    echo "📊 Grafana:     http://localhost:3001 (dashboards)"
    echo ""
    echo "🔐 Grafana credentials: admin / admin"
    echo ""
    echo "💡 First time setup for Langfuse:"
    echo "   1. Open http://localhost:3000"
    echo "   2. Click 'Sign up' to create an account"
    echo "   3. Create a project and get API keys"
    echo "   4. Update LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in docker-compose.yml"
}

cmd_observability_stop() {
    log_info "Stopping observability stack..."
    $COMPOSE --profile observability down
    log_success "Observability stack stopped!"
}

cmd_observability_logs() {
    local service=${1:-langfuse}
    log_info "Following logs for: $service"
    $COMPOSE --profile observability logs -f $service
}

cmd_clean() {
    log_warning "This will remove all containers and volumes!"
    read -p "Are you sure? (y/N) " -n 1 -r
    echo

    if [[ $REPLY =~ ^[Yy]$ ]]; then
        log_info "Cleaning up..."
        $COMPOSE down -v --remove-orphans

        if [ "$RUNTIME" = "podman" ]; then
            podman volume prune -f
        else
            docker volume prune -f
        fi

        log_success "Cleanup complete!"
    fi
}

cmd_status() {
    log_info "Service status:"
    $COMPOSE ps
}

cmd_shell() {
    local service=${1:-app}
    log_info "Opening shell in: $service"
    $COMPOSE exec $service /bin/sh
}

cmd_test_llm() {
    log_info "Testing LLM connection (via container)..."

    # Check if Ollama is running
    if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
        log_error "Ollama container not running!"
        echo "Start it with: ./scripts/dev.sh start"
        exit 1
    fi

    # Check if model is available
    local models=$(curl -s http://localhost:11434/api/tags | grep -o '"name":"[^"]*"' | head -1)
    if [ -z "$models" ]; then
        log_warning "No models found. Pulling phi3:mini..."
        cmd_init_ollama
    fi

    log_info "Sending test request..."
    local response=$(curl -s http://localhost:11434/api/chat -d '{
        "model": "phi3:mini",
        "messages": [{"role": "user", "content": "Say hello in one word"}],
        "stream": false
    }')

    local content=$(echo "$response" | grep -o '"content":"[^"]*"' | head -1 | cut -d'"' -f4)

    if [ -n "$content" ]; then
        echo ""
        echo "🤖 Response: $content"
        echo ""
        log_success "LLM is working!"
    else
        log_error "No response from LLM"
        echo "Response: $response"
        exit 1
    fi
}

cmd_help() {
    echo "Usage: $0 <command> [options]"
    echo ""
    echo "Commands:"
    echo "  start                Start all core services (app, ollama, redis, memcached)"
    echo "  stop                 Stop all services"
    echo "  status               Show service status"
    echo "  logs [service]       Follow logs (default: app)"
    echo "  shell [service]      Open shell in container"
    echo ""
    echo "LLM Commands:"
    echo "  init-ollama [model]  Download LLM model to container (default: phi3:mini)"
    echo "  ollama-list          List downloaded models in container"
    echo "  test-llm             Test LLM connection via container"
    echo ""
    echo "Observability Commands:"
    echo "  observability        Start monitoring (Langfuse, Prometheus, Grafana)"
    echo "  observability-stop   Stop monitoring stack"
    echo "  observability-logs [svc] Follow observability logs (default: langfuse)"
    echo ""
    echo "Advanced Commands:"
    echo "  scale <n>            Scale app to n instances (starts nginx load balancer)"
    echo "  clean                Remove all containers and volumes"
    echo "  help                 Show this help"
    echo ""
    echo "Services:"
    echo "  app          NestJS application         http://localhost:8083"
    echo "  ollama       Local LLM                  http://localhost:11434"
    echo "  redis        Session state, pub/sub     localhost:6379"
    echo "  memcached    Embedding cache            localhost:11211"
    echo ""
    echo "Observability (with --profile observability):"
    echo "  langfuse     LLM tracing & analytics    http://localhost:3000"
    echo "  prometheus   Metrics collection         http://localhost:9090"
    echo "  grafana      Dashboards (admin/admin)   http://localhost:3001"
    echo ""
    echo "Available LLM Models (MIT/Apache licensed):"
    echo "  phi3:mini           Microsoft Phi-3 (~2.3GB) - Default"
    echo "  qwen2.5:1.5b        Alibaba Qwen (~1GB) - Fast"
    echo "  mistral:7b-instruct Mistral (~4GB) - Quality"
    echo "  gemma2:2b           Google Gemma (~1.6GB)"
    echo ""
    echo "Examples:"
    echo "  $0 start                          # Start development environment"
    echo "  $0 observability                  # Add monitoring stack"
    echo "  $0 init-ollama                    # Download default model"
    echo "  $0 status                         # Check what's running"
}

# =============================================================================
# Main
# =============================================================================

case "${1:-help}" in
    start)        cmd_start ;;
    stop)         cmd_stop ;;
    scale)        cmd_scale "$2" ;;
    logs)         cmd_logs "$2" ;;
    init-ollama)  cmd_init_ollama "$2" ;;
    ollama-list)  cmd_ollama_list ;;
    observability) cmd_observability ;;
    observability-stop) cmd_observability_stop ;;
    observability-logs) cmd_observability_logs "$2" ;;
    status)       cmd_status ;;
    shell)        cmd_shell "$2" ;;
    test-llm)     cmd_test_llm ;;
    clean)        cmd_clean ;;
    help|--help|-h) cmd_help ;;
    *)
        log_error "Unknown command: $1"
        cmd_help
        exit 1
        ;;
esac
