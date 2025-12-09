# Stress Testing Guide

Local stress testing for the LLM Agent application. All tools run 100% locally with no external dependencies.

## Quick Start

```bash
# 1. Start the server with Docker/Podman (uses mock LLM by default)
podman compose up -d

# 2. Verify mock mode is active (fast responses, no LLM costs)
yarn llm:status

# 3. Run a quick smoke test
node stress-tests/native/stress-test.mjs --scenario smoke

# 4. Run load test
make stress-load
```

## LLM Provider for Testing

**Important**: Use the appropriate LLM provider for your testing needs:

```bash
# Check current provider
yarn llm:status

# Switch to mock (RECOMMENDED for stress testing)
yarn llm:mock
# Result: ~300ms p95, 0% errors, no API costs

# Switch to Ollama (for realistic local testing)
yarn llm:ollama
# Result: ~25s avg, may timeout under load

# Switch to Azure (for production testing)
yarn llm:azure
# Result: Depends on Azure tier
```

| Provider | p95 Latency | Error Rate | Best For |
|----------|-------------|------------|----------|
| `mock` | ~300ms | 0% | Load testing, CI/CD |
| `ollama` | ~25-90s | 10-40% | Realistic local dev |
| `azure` | ~2-5s | <1% | Production validation |

## Available Tools

| Tool | Installation | Best For |
|------|-------------|----------|
| **Native Node.js** | None (built-in) | Quick tests, CI/CD, zero deps |
| **k6** | `brew install k6` | Advanced scenarios, detailed metrics |
| **Artillery** | `npm i -g artillery` | YAML config, HTML reports |

> **Note**: All services (Ollama, Redis, etc.) run in containers - no global installation needed!

## Test Scenarios

### 1. Smoke Test
Quick verification that the system works.
```bash
make stress-smoke
# or
node stress-tests/native/stress-test.mjs --scenario smoke
```
- **VUs**: 1
- **Duration**: 30s
- **Purpose**: Verify basic functionality

### 2. Load Test
Normal expected traffic.
```bash
make stress-load
# or
node stress-tests/native/stress-test.mjs --scenario load
```
- **VUs**: 10
- **Duration**: 60s
- **Purpose**: Baseline performance

### 3. Stress Test
Push system to its limits.
```bash
make stress-stress
# or
node stress-tests/native/stress-test.mjs --scenario stress
```
- **VUs**: 50
- **Duration**: 120s
- **Purpose**: Find breaking points

### 4. Spike Test
Sudden traffic surge.
```bash
make stress-spike
# or
node stress-tests/native/stress-test.mjs --scenario spike
```
- **VUs**: 100
- **Duration**: 30s
- **Purpose**: Test auto-scaling, resilience

### 5. Soak Test
Long-running sustained load.
```bash
node stress-tests/native/stress-test.mjs --scenario soak
```
- **VUs**: 20
- **Duration**: 600s (10 min)
- **Purpose**: Memory leaks, resource exhaustion

### 6. SSE Streaming Test
Specific test for Server-Sent Events.
```bash
make stress-sse
# or
node stress-tests/native/sse-test.mjs --streams 20
```
- **Concurrent Streams**: 10-20
- **Measures**: Time to first token, message count

## Using Different Tools

### Native Node.js (Recommended for Quick Tests)

Zero dependencies - works everywhere Node.js is installed.

```bash
# Basic usage
node stress-tests/native/stress-test.mjs

# With options
node stress-tests/native/stress-test.mjs --vus 20 --duration 120

# Target a different URL (e.g., load balancer)
node stress-tests/native/stress-test.mjs --target http://localhost:80

# SSE-specific test
node stress-tests/native/sse-test.mjs --streams 30
```

### k6 (Best Features)

```bash
# Install
brew install k6

# Run with custom options
k6 run stress-tests/k6/chat-stream.js

# Override VUs and duration
k6 run --vus 50 --duration 2m stress-tests/k6/chat-stream.js

# Output to JSON for analysis
k6 run --out json=results.json stress-tests/k6/chat-stream.js

# Target load balancer
k6 run --env TARGET_URL=http://localhost:80 stress-tests/k6/chat-stream.js
```

### Artillery

```bash
# Install
npm install -g artillery

# Run
artillery run stress-tests/artillery/config.yml

# Generate HTML report
artillery run --output report.json stress-tests/artillery/config.yml
artillery report report.json
```

## Testing Scaled Setup

```bash
# 1. Start with scaling
./scripts/dev.sh scale 3

# 2. Run tests against load balancer
TARGET_URL=http://localhost:80 make stress-load

# 3. Watch metrics
open http://localhost:9090  # Prometheus
open http://localhost:3001  # Grafana
```

## Pass/Fail Thresholds

| Metric | Threshold | Description |
|--------|-----------|-------------|
| Error Rate | < 10% | Requests returning 4xx/5xx |
| p95 Latency | < 5000ms | 95th percentile response time |
| p99 Latency | < 10000ms | 99th percentile response time |
| First Byte | < 2000ms | Time to first SSE token |

## Interpreting Results

### Native Test Output

```
📊 RESULTS
═══════════════════════════════════════════════════════════

  Duration:        60.05s
  Total Requests:  523
  Requests/sec:    8.71

  ✅ Successes:    520
  ❌ Failures:     3
  📉 Error Rate:   0.57%

  ⏱️  Latency (ms):
     Min:          45.23
     Max:          2341.12
     Avg:          523.45
     p50:          412.33
     p95:          1234.56
     p99:          1987.23
```

### What to Look For

1. **Error Rate Increasing**: Server overloaded, increase resources
2. **p95/p99 Spike**: Garbage collection, cold starts, or resource contention
3. **Requests/sec Plateauing**: Bottleneck reached (CPU, memory, connections)
4. **First Byte Time High**: LLM processing delay or queue backup

## CI/CD Integration

```yaml
# .github/workflows/stress-test.yml
name: Stress Test

on:
  push:
    branches: [main]
  schedule:
    - cron: '0 0 * * *'  # Daily

jobs:
  stress-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: yarn install

      - name: Start server (mock mode)
        run: |
          LLM_PROVIDER=mock yarn start:dev &
          sleep 10

      - name: Run smoke test
        run: node stress-tests/native/stress-test.mjs --scenario smoke

      - name: Run load test
        run: node stress-tests/native/stress-test.mjs --scenario load
```

## Troubleshooting

### "Server not responding"
```bash
# Check if server is running
curl http://localhost:8083/health

# Start it
./scripts/dev.sh start
# or
yarn start:dev
```

### "Too many open files"
```bash
# Increase file descriptor limit
ulimit -n 65535
```

### "Connection refused" during spike test
```bash
# Server can't handle connections fast enough
# Solutions:
# 1. Increase server instances
./scripts/dev.sh scale 5

# 2. Reduce VUs
node stress-tests/native/stress-test.mjs --vus 30
```

### Mock Mode for Testing Infrastructure

Test your infrastructure without LLM costs:

```bash
# Option 1: Use yarn scripts (Docker/Podman)
yarn llm:mock
make stress-stress

# Option 2: Environment variable (local dev)
LLM_PROVIDER=mock yarn start:dev
make stress-stress

# Option 3: Direct container recreation
LLM_PROVIDER=mock podman compose up -d --force-recreate app
make stress-stress
```

### Switching Between Providers During Testing

```bash
# Test with mock first (baseline)
yarn llm:mock
make stress-load
# Expected: ~300ms p95, 0% errors

# Then test with Ollama (realistic)
yarn llm:ollama
make stress-smoke  # Use smoke test for slower providers
# Expected: Higher latency, some timeouts under load

# Finally validate with Azure (if configured)
yarn llm:azure
make stress-load
# Expected: Production-like performance
```
