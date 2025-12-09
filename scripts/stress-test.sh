#!/bin/bash
# =============================================================================
# Stress Test Runner
# =============================================================================
#
# Runs stress tests using available tools (k6, Artillery, or native Node.js)
#
# Usage:
#   ./scripts/stress-test.sh                    # Auto-detect tool, run load test
#   ./scripts/stress-test.sh smoke              # Quick smoke test
#   ./scripts/stress-test.sh load               # Normal load test
#   ./scripts/stress-test.sh stress             # Push limits
#   ./scripts/stress-test.sh spike              # Sudden traffic spike
#   ./scripts/stress-test.sh sse                # SSE-specific test
#   ./scripts/stress-test.sh --tool native      # Force specific tool
#
# =============================================================================

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; }

# =============================================================================
# Configuration
# =============================================================================

SCENARIO="${1:-load}"
TOOL=""
TARGET_URL="${TARGET_URL:-http://localhost:8083}"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --tool)
      TOOL="$2"
      shift 2
      ;;
    --target)
      TARGET_URL="$2"
      shift 2
      ;;
    smoke|load|stress|spike|soak|sse)
      SCENARIO="$1"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

# =============================================================================
# Tool Detection
# =============================================================================

detect_tool() {
  if [[ -n "$TOOL" ]]; then
    echo "$TOOL"
    return
  fi

  # Prefer k6 if available (best features)
  if command -v k6 &> /dev/null; then
    echo "k6"
    return
  fi

  # Fall back to Artillery
  if command -v artillery &> /dev/null; then
    echo "artillery"
    return
  fi

  # Native Node.js (always available)
  echo "native"
}

# =============================================================================
# Test Runners
# =============================================================================

run_k6() {
  local scenario="$1"
  log_info "Running k6 stress test: $scenario"

  case $scenario in
    smoke)
      k6 run --vus 1 --duration 30s \
        --env TARGET_URL="$TARGET_URL" \
        stress-tests/k6/chat-stream.js
      ;;
    load)
      k6 run --vus 10 --duration 60s \
        --env TARGET_URL="$TARGET_URL" \
        stress-tests/k6/chat-stream.js
      ;;
    stress)
      k6 run --vus 50 --duration 120s \
        --env TARGET_URL="$TARGET_URL" \
        stress-tests/k6/chat-stream.js
      ;;
    spike)
      k6 run --vus 100 --duration 30s \
        --env TARGET_URL="$TARGET_URL" \
        stress-tests/k6/chat-stream.js
      ;;
    soak)
      k6 run --vus 20 --duration 600s \
        --env TARGET_URL="$TARGET_URL" \
        stress-tests/k6/chat-stream.js
      ;;
    sse)
      # Run native SSE test even with k6
      run_native "sse"
      ;;
    *)
      k6 run --env TARGET_URL="$TARGET_URL" stress-tests/k6/chat-stream.js
      ;;
  esac
}

run_artillery() {
  local scenario="$1"
  log_info "Running Artillery stress test: $scenario"

  artillery run \
    --target "$TARGET_URL" \
    stress-tests/artillery/config.yml
}

run_native() {
  local scenario="$1"
  log_info "Running native Node.js stress test: $scenario"

  if [[ "$scenario" == "sse" ]]; then
    TARGET_URL="$TARGET_URL" node stress-tests/native/sse-test.mjs --streams 10
  else
    TARGET_URL="$TARGET_URL" node stress-tests/native/stress-test.mjs --scenario "$scenario"
  fi
}

# =============================================================================
# Pre-flight Checks
# =============================================================================

preflight_check() {
  log_info "Running pre-flight checks..."

  # Check if server is running
  if ! curl -s "$TARGET_URL/api/v1/chat/status" > /dev/null 2>&1; then
    log_error "Server not responding at $TARGET_URL"
    echo ""
    echo "Start the server first:"
    echo "  ./scripts/dev.sh start"
    echo "  # or"
    echo "  yarn start:dev"
    exit 1
  fi

  log_success "Server is healthy at $TARGET_URL"
}

# =============================================================================
# Main
# =============================================================================

echo ""
echo "🔥 Stress Test Runner"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Pre-flight
preflight_check

# Detect tool
DETECTED_TOOL=$(detect_tool)
log_info "Using tool: $DETECTED_TOOL"
log_info "Scenario: $SCENARIO"
log_info "Target: $TARGET_URL"
echo ""

# Run test
case $DETECTED_TOOL in
  k6)
    run_k6 "$SCENARIO"
    ;;
  artillery)
    run_artillery "$SCENARIO"
    ;;
  native)
    run_native "$SCENARIO"
    ;;
  *)
    log_error "Unknown tool: $DETECTED_TOOL"
    exit 1
    ;;
esac

echo ""
log_success "Stress test complete!"
