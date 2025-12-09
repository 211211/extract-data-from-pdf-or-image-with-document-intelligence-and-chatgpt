#!/bin/bash
# =============================================================================
# LLM Provider Switcher for Stress Testing
# =============================================================================
# Usage:
#   ./scripts/switch-llm.sh mock     # Fast, for load testing (default)
#   ./scripts/switch-llm.sh ollama   # Local LLM, slower but realistic
#   ./scripts/switch-llm.sh azure    # Production Azure OpenAI
#   ./scripts/switch-llm.sh status   # Show current provider
#
# Examples:
#   ./scripts/switch-llm.sh mock && yarn stress-test
#   LLM_PROVIDER=ollama ./scripts/switch-llm.sh ollama

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

show_status() {
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  LLM Provider Status${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

    # Check if container is running
    if podman compose ps 2>/dev/null | grep -q "app.*Up" || docker compose ps 2>/dev/null | grep -q "app.*Up"; then
        # Get logs and detect provider
        LOGS=$(podman compose logs app --tail 200 2>/dev/null || docker compose logs app --tail 200 2>/dev/null)

        # Try to find Provider: line first
        CURRENT=$(echo "$LOGS" | grep "Provider:" | tail -1 | sed 's/.*Provider: //' | awk '{print $1}')

        # If not found, detect from activity logs
        if [ -z "$CURRENT" ]; then
            if echo "$LOGS" | grep -q "Mock streaming"; then
                CURRENT="mock"
            elif echo "$LOGS" | grep -q "Ollama streaming\|Ollama completing"; then
                CURRENT="ollama"
            elif echo "$LOGS" | grep -q "Azure streaming\|Azure completing"; then
                CURRENT="azure"
            fi
        fi

        if [ -n "$CURRENT" ]; then
            echo -e "  Current Provider: ${GREEN}${CURRENT}${NC}"
        else
            echo -e "  Current Provider: ${YELLOW}Unknown (no recent LLM activity)${NC}"
        fi

        echo ""
        echo -e "  Container Status: ${GREEN}Running${NC}"
    else
        echo -e "  Container Status: ${RED}Not Running${NC}"
    fi

    echo ""
    echo -e "${BLUE}───────────────────────────────────────────────────────────────${NC}"
    echo -e "  Available Providers:"
    echo -e "    ${GREEN}mock${NC}    - Fast responses (50ms/token), for load testing"
    echo -e "    ${YELLOW}ollama${NC}  - Local LLM (phi3:mini), realistic but slower"
    echo -e "    ${RED}azure${NC}   - Azure OpenAI, requires API keys"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
}

switch_provider() {
    local PROVIDER=$1

    case $PROVIDER in
        mock|ollama|azure)
            echo -e "${BLUE}Switching to ${GREEN}${PROVIDER}${BLUE} provider...${NC}"
            ;;
        *)
            echo -e "${RED}Error: Unknown provider '${PROVIDER}'${NC}"
            echo "Valid options: mock, ollama, azure"
            exit 1
            ;;
    esac

    # Export and recreate container
    cd "$PROJECT_ROOT"
    export LLM_PROVIDER=$PROVIDER

    echo -e "${YELLOW}Recreating app container...${NC}"
    podman compose up -d --force-recreate app 2>/dev/null || \
    docker compose up -d --force-recreate app 2>/dev/null

    echo -e "${YELLOW}Waiting for app to start...${NC}"
    sleep 5

    # Verify the switch
    echo ""
    show_status

    echo ""
    echo -e "${GREEN}✓ Ready for stress testing!${NC}"
    echo -e "  Run: ${BLUE}yarn stress-test${NC}"
}

# Main
case "${1:-status}" in
    status|--status|-s)
        show_status
        ;;
    mock|ollama|azure)
        switch_provider "$1"
        ;;
    -h|--help|help)
        echo "Usage: $0 [mock|ollama|azure|status]"
        echo ""
        echo "Commands:"
        echo "  mock     Switch to mock provider (fast, for load testing)"
        echo "  ollama   Switch to local Ollama (realistic, slower)"
        echo "  azure    Switch to Azure OpenAI (requires API keys)"
        echo "  status   Show current provider status (default)"
        echo ""
        echo "Examples:"
        echo "  $0 mock           # Switch to mock mode"
        echo "  $0 status         # Check current provider"
        echo "  $0 mock && yarn stress-test"
        ;;
    *)
        echo -e "${RED}Unknown command: $1${NC}"
        echo "Run '$0 --help' for usage"
        exit 1
        ;;
esac
