# =============================================================================
# Makefile for LLM Agent Development
# =============================================================================
#
# Supports both Docker and Podman (auto-detects)
#
# Quick Start:
#   make setup          # First-time setup
#   make dev            # Start development environment
#   make test-llm       # Test the local LLM
#
# =============================================================================

.PHONY: help setup dev stop scale logs clean test test-llm observability build stress

# Default target
help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "Development:"
	@echo "  setup          First-time setup (install deps, pull model)"
	@echo "  dev            Start development environment"
	@echo "  stop           Stop all services"
	@echo "  logs           Follow application logs"
	@echo "  scale N=3      Scale to N app instances"
	@echo ""
	@echo "Testing:"
	@echo "  test           Run unit tests"
	@echo "  test-e2e       Run E2E tests"
	@echo "  test-llm       Test local LLM connection"
	@echo ""
	@echo "Stress Testing:"
	@echo "  stress-smoke   Quick verification (1 VU, 30s)"
	@echo "  stress-load    Normal load test (10 VUs, 60s)"
	@echo "  stress-stress  Push limits (50 VUs, 120s)"
	@echo "  stress-spike   Sudden traffic (100 VUs, 30s)"
	@echo "  stress-sse     SSE streaming test"
	@echo ""
	@echo "Observability:"
	@echo "  observability  Start monitoring stack"
	@echo ""
	@echo "Build:"
	@echo "  build          Build production image"
	@echo "  build-dev      Build development image"
	@echo ""
	@echo "Cleanup:"
	@echo "  clean          Stop and remove containers"
	@echo "  clean-all      Remove containers, volumes, and images"

# =============================================================================
# Setup
# =============================================================================

setup:
	@echo "🚀 Setting up development environment..."
	@yarn install
	@./scripts/dev.sh start
	@./scripts/dev.sh init-ollama
	@echo "✅ Setup complete! Run 'make dev' to start."

# =============================================================================
# Development
# =============================================================================

dev:
	@./scripts/dev.sh start

stop:
	@./scripts/dev.sh stop

logs:
	@./scripts/dev.sh logs app

scale:
	@./scripts/dev.sh scale $(N)

status:
	@./scripts/dev.sh status

shell:
	@./scripts/dev.sh shell app

# =============================================================================
# Testing
# =============================================================================

test:
	@yarn test

test-watch:
	@yarn test:watch

test-cov:
	@yarn test:cov

test-e2e:
	@yarn test:e2e

test-llm:
	@./scripts/dev.sh test-llm

# =============================================================================
# Stress Testing
# =============================================================================

stress-smoke:
	@./scripts/stress-test.sh smoke

stress-load:
	@./scripts/stress-test.sh load

stress-stress:
	@./scripts/stress-test.sh stress

stress-spike:
	@./scripts/stress-test.sh spike

stress-sse:
	@./scripts/stress-test.sh sse

# Alias for quick stress test
stress: stress-load

# =============================================================================
# Observability
# =============================================================================

observability:
	@./scripts/dev.sh observability

# =============================================================================
# Build
# =============================================================================

build:
	@echo "Building production image..."
	@docker build -t llm-agent:latest --target production .

build-dev:
	@echo "Building development image..."
	@docker build -t llm-agent:dev --target development .

# =============================================================================
# Cleanup
# =============================================================================

clean:
	@./scripts/dev.sh stop

clean-all:
	@./scripts/dev.sh clean
