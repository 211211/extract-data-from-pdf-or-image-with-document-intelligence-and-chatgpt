#!/usr/bin/env node
/**
 * Native Node.js Stress Test - Zero Dependencies
 *
 * Runs entirely with built-in Node.js modules.
 * No npm install required!
 *
 * Usage:
 *   node stress-tests/native/stress-test.mjs
 *   node stress-tests/native/stress-test.mjs --vus 20 --duration 60
 *   node stress-tests/native/stress-test.mjs --target http://localhost:80
 *   node stress-tests/native/stress-test.mjs --scenario spike
 */

import { URL } from 'url';
import http from 'http';
import https from 'https';
import { performance } from 'perf_hooks';

// =============================================================================
// Configuration
// =============================================================================

const CONFIG = {
  target: process.env.TARGET_URL || 'http://localhost:8083',
  vus: 10, // Virtual users (concurrent connections)
  duration: 60, // Test duration in seconds
  rampUp: 10, // Ramp-up time in seconds
  scenario: 'load', // smoke | load | stress | spike
  thinkTime: [1, 3], // Random think time range [min, max] seconds
};

// Parse command line arguments
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const key = args[i].replace('--', '');
  const value = args[i + 1];
  if (key === 'vus') CONFIG.vus = parseInt(value);
  if (key === 'duration') CONFIG.duration = parseInt(value);
  if (key === 'target') CONFIG.target = value;
  if (key === 'scenario') CONFIG.scenario = value;
}

// Scenario presets with thresholds appropriate for LLM/SSE streaming
// Note: LLM responses typically take 5-30+ seconds, so thresholds are higher
// All scenarios now test all agents with per-agent metrics breakdown
const SCENARIOS = {
  // Smoke: Quick validation with all agents
  smoke: {
    vus: 1,
    duration: 60,
    rampUp: 0,
    maxP95: 90000,
    maxErrorRate: 15,
    timeout: 120000,
    agents: ['normal', 'rag', 'multi-agent'],
  },
  // Load: Normal expected traffic
  load: {
    vus: 5,
    duration: 120,
    rampUp: 10,
    maxP95: 90000,
    maxErrorRate: 15,
    timeout: 120000,
    agents: ['normal', 'rag', 'multi-agent'],
  },
  // Stress: Push limits with all agents
  stress: {
    vus: 20,
    duration: 180,
    rampUp: 30,
    maxP95: 120000,
    maxErrorRate: 25,
    timeout: 150000,
    agents: ['normal', 'rag', 'multi-agent'],
  },
  // Spike: Sudden burst (use fast agents only)
  spike: {
    vus: 50,
    duration: 60,
    rampUp: 5,
    maxP95: 120000,
    maxErrorRate: 30,
    timeout: 150000,
    agents: ['normal'],
  },
  // Soak: Long-running endurance
  soak: {
    vus: 10,
    duration: 600,
    rampUp: 30,
    maxP95: 90000,
    maxErrorRate: 20,
    timeout: 120000,
    agents: ['normal', 'rag', 'multi-agent'],
  },
};

// Default thresholds (can be overridden by scenario)
CONFIG.maxP95 = 60000; // 60s for LLM streaming
CONFIG.maxErrorRate = 15; // 15% error rate (LLM can be flaky)
CONFIG.timeout = 90000; // 90s request timeout
CONFIG.agents = ['normal']; // Default to fast agent

if (SCENARIOS[CONFIG.scenario]) {
  Object.assign(CONFIG, SCENARIOS[CONFIG.scenario]);
}

// =============================================================================
// Test Data
// =============================================================================

const TEST_QUERIES = [
  'What is the capital of France?',
  'Explain quantum computing.',
  'Write a haiku about coding.',
  'What are microservices?',
  'How does caching work?',
  'Explain REST APIs.',
  'What is Docker?',
  'How does load balancing work?',
];

const AGENT_TYPES = ['normal', 'rag', 'multi-agent'];

// =============================================================================
// Metrics Collection (with per-agent tracking)
// =============================================================================

class MetricsCollector {
  constructor() {
    this.reset();
  }

  reset() {
    this.requests = 0;
    this.successes = 0;
    this.failures = 0;
    this.latencies = [];
    this.firstByteLatencies = [];
    this.errors = {};
    this.startTime = performance.now();
    // Per-agent metrics
    this.byAgent = {};
  }

  recordRequest(success, latency, firstByte, error, agentType = 'unknown') {
    this.requests++;

    // Initialize agent metrics if needed
    if (!this.byAgent[agentType]) {
      this.byAgent[agentType] = {
        requests: 0,
        successes: 0,
        failures: 0,
        latencies: [],
        errors: {},
      };
    }

    const agentMetrics = this.byAgent[agentType];
    agentMetrics.requests++;

    if (success) {
      this.successes++;
      this.latencies.push(latency);
      if (firstByte) this.firstByteLatencies.push(firstByte);
      agentMetrics.successes++;
      agentMetrics.latencies.push(latency);
    } else {
      this.failures++;
      const errKey = error || 'unknown';
      this.errors[errKey] = (this.errors[errKey] || 0) + 1;
      agentMetrics.failures++;
      agentMetrics.errors[errKey] = (agentMetrics.errors[errKey] || 0) + 1;
    }
  }

  percentile(arr, p) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  getAgentStats(agentType) {
    const agent = this.byAgent[agentType];
    if (!agent || agent.requests === 0) return null;

    return {
      requests: agent.requests,
      successes: agent.successes,
      failures: agent.failures,
      errorRate: ((agent.failures / agent.requests) * 100 || 0).toFixed(2),
      latency: {
        avg: (agent.latencies.reduce((a, b) => a + b, 0) / agent.latencies.length || 0).toFixed(2),
        p50: this.percentile(agent.latencies, 50).toFixed(2),
        p95: this.percentile(agent.latencies, 95).toFixed(2),
      },
      errors: agent.errors,
    };
  }

  getStats() {
    const elapsed = (performance.now() - this.startTime) / 1000;
    const rps = this.requests / elapsed;

    return {
      duration: elapsed.toFixed(2),
      requests: this.requests,
      rps: rps.toFixed(2),
      successes: this.successes,
      failures: this.failures,
      errorRate: ((this.failures / this.requests) * 100 || 0).toFixed(2),
      latency: {
        min: Math.min(...this.latencies, 0).toFixed(2),
        max: Math.max(...this.latencies, 0).toFixed(2),
        avg: (this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length || 0).toFixed(2),
        p50: this.percentile(this.latencies, 50).toFixed(2),
        p95: this.percentile(this.latencies, 95).toFixed(2),
        p99: this.percentile(this.latencies, 99).toFixed(2),
      },
      firstByte: {
        avg: (this.firstByteLatencies.reduce((a, b) => a + b, 0) / this.firstByteLatencies.length || 0).toFixed(2),
        p95: this.percentile(this.firstByteLatencies, 95).toFixed(2),
      },
      errors: this.errors,
      byAgent: Object.keys(this.byAgent).map((agent) => ({
        agent,
        ...this.getAgentStats(agent),
      })),
    };
  }

  printLive(activeVUs) {
    const stats = this.getStats();
    process.stdout.write(
      `\r⚡ VUs: ${activeVUs.toString().padStart(3)} | ` +
        `Reqs: ${stats.requests.toString().padStart(6)} | ` +
        `RPS: ${stats.rps.padStart(7)} | ` +
        `Err: ${stats.errorRate.padStart(5)}% | ` +
        `p95: ${stats.latency.p95.padStart(8)}ms`,
    );
  }
}

// =============================================================================
// HTTP Client
// =============================================================================

function makeRequest(url, options, body) {
  return new Promise((resolve) => {
    const startTime = performance.now();
    let firstByteTime = null;
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: CONFIG.timeout || 90000,
    };

    const req = client.request(reqOptions, (res) => {
      let data = '';

      res.once('data', () => {
        firstByteTime = performance.now() - startTime;
      });

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        const latency = performance.now() - startTime;
        resolve({
          success: res.statusCode >= 200 && res.statusCode < 400,
          status: res.statusCode,
          latency,
          firstByteTime,
          body: data,
          error: res.statusCode >= 400 ? `HTTP ${res.statusCode}` : null,
        });
      });
    });

    req.on('error', (err) => {
      const latency = performance.now() - startTime;
      resolve({
        success: false,
        status: 0,
        latency,
        firstByteTime: null,
        body: '',
        error: err.code || err.message,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      const latency = performance.now() - startTime;
      resolve({
        success: false,
        status: 0,
        latency,
        firstByteTime: null,
        body: '',
        error: 'TIMEOUT',
      });
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

// =============================================================================
// Test Scenarios
// =============================================================================

async function chatStreamRequest(vuId, iteration) {
  const query = TEST_QUERIES[Math.floor(Math.random() * TEST_QUERIES.length)];
  const agents = CONFIG.agents || AGENT_TYPES;
  const agentType = agents[Math.floor(Math.random() * agents.length)];

  const payload = JSON.stringify({
    threadId: `stress-${vuId}-${iteration}`,
    userId: `stress-user-${vuId}`,
    agentType,
    messages: [{ role: 'user', content: query }],
  });

  const result = await makeRequest(
    `${CONFIG.target}/api/v1/chat/stream`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-User-Id': `stress-user-${vuId}`,
      },
    },
    payload,
  );

  // Return result with agent type for per-agent metrics
  return { ...result, agentType };
}

async function healthCheckRequest() {
  const result = await makeRequest(`${CONFIG.target}/api/v1/chat/status`, {
    method: 'GET',
  });
  return { ...result, agentType: 'health-check' };
}

// =============================================================================
// Virtual User
// =============================================================================

async function virtualUser(vuId, metrics, stopSignal) {
  let iteration = 0;

  while (!stopSignal.stop) {
    iteration++;

    // 80% chat stream, 20% health check
    const result = Math.random() < 0.8 ? await chatStreamRequest(vuId, iteration) : await healthCheckRequest();

    metrics.recordRequest(result.success, result.latency, result.firstByteTime, result.error, result.agentType);

    // Random think time
    const thinkTime = CONFIG.thinkTime[0] + Math.random() * (CONFIG.thinkTime[1] - CONFIG.thinkTime[0]);
    await new Promise((r) => setTimeout(r, thinkTime * 1000));
  }
}

// =============================================================================
// Test Runner
// =============================================================================

async function runStressTest() {
  console.log('\n🔥 Native Node.js Stress Test');
  console.log('═'.repeat(60));
  console.log(`📍 Target:     ${CONFIG.target}`);
  console.log(`👥 VUs:        ${CONFIG.vus}`);
  console.log(`⏱️  Duration:   ${CONFIG.duration}s`);
  console.log(`📈 Ramp-up:    ${CONFIG.rampUp}s`);
  console.log(`🎯 Scenario:   ${CONFIG.scenario}`);
  console.log(`🤖 Agents:     ${(CONFIG.agents || AGENT_TYPES).join(', ')}`);
  console.log(`⏰ Timeout:    ${CONFIG.timeout}ms`);
  console.log('═'.repeat(60));

  // Health check
  console.log('\n🏥 Running health check...');
  const healthResult = await healthCheckRequest();
  if (!healthResult.success) {
    console.error(`❌ Health check failed: ${healthResult.error}`);
    console.error('   Make sure the server is running!');
    process.exit(1);
  }
  console.log('✅ Health check passed\n');

  const metrics = new MetricsCollector();
  const stopSignal = { stop: false };
  const activeVUs = [];

  // Ramp-up function
  const rampUpDelay = (CONFIG.rampUp * 1000) / CONFIG.vus;

  console.log('🚀 Starting test...\n');

  // Start VUs with ramp-up
  for (let i = 0; i < CONFIG.vus; i++) {
    const vuPromise = virtualUser(i + 1, metrics, stopSignal);
    activeVUs.push(vuPromise);

    // Live stats update
    metrics.printLive(activeVUs.length);

    if (rampUpDelay > 0) {
      await new Promise((r) => setTimeout(r, rampUpDelay));
    }
  }

  // Run for duration with live updates
  const endTime = Date.now() + CONFIG.duration * 1000;

  while (Date.now() < endTime) {
    metrics.printLive(activeVUs.length);
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Stop all VUs
  stopSignal.stop = true;
  console.log('\n\n⏹️  Stopping VUs...');

  // Wait for all VUs to finish (with timeout)
  await Promise.race([Promise.all(activeVUs), new Promise((r) => setTimeout(r, 10000))]);

  // Print results
  const stats = metrics.getStats();

  console.log('\n' + '═'.repeat(60));
  console.log('📊 RESULTS');
  console.log('═'.repeat(60));
  console.log(`
  Duration:        ${stats.duration}s
  Total Requests:  ${stats.requests}
  Requests/sec:    ${stats.rps}

  ✅ Successes:    ${stats.successes}
  ❌ Failures:     ${stats.failures}
  📉 Error Rate:   ${stats.errorRate}%

  ⏱️  Latency (ms):
     Min:          ${stats.latency.min}
     Max:          ${stats.latency.max}
     Avg:          ${stats.latency.avg}
     p50:          ${stats.latency.p50}
     p95:          ${stats.latency.p95}
     p99:          ${stats.latency.p99}

  🚀 First Byte (ms):
     Avg:          ${stats.firstByte.avg}
     p95:          ${stats.firstByte.p95}
  `);

  if (Object.keys(stats.errors).length > 0) {
    console.log('  ⚠️  Errors:');
    for (const [error, count] of Object.entries(stats.errors)) {
      console.log(`     ${error}: ${count}`);
    }
  }

  // Per-agent breakdown
  if (stats.byAgent && stats.byAgent.length > 0) {
    console.log('\n  📊 Per-Agent Breakdown:');
    console.log('  ' + '-'.repeat(56));
    console.log('  Agent            Reqs   OK   Err%     Avg(ms)  p95(ms)');
    console.log('  ' + '-'.repeat(56));

    for (const agent of stats.byAgent) {
      if (agent.requests > 0) {
        console.log(
          `  ${agent.agent.padEnd(16)} ${agent.requests.toString().padStart(4)}  ` +
            `${agent.successes.toString().padStart(4)}  ${agent.errorRate.padStart(5)}%  ` +
            `${agent.latency.avg.padStart(10)}  ${agent.latency.p95.padStart(8)}`,
        );
      }
    }
    console.log('  ' + '-'.repeat(56));
  }

  console.log('═'.repeat(60));

  // Determine pass/fail using configurable thresholds
  const errorRateOk = parseFloat(stats.errorRate) < CONFIG.maxErrorRate;
  const latencyOk = parseFloat(stats.latency.p95) < CONFIG.maxP95;
  const passed = errorRateOk && latencyOk;

  console.log(`\n📋 Thresholds: p95 < ${CONFIG.maxP95}ms, errors < ${CONFIG.maxErrorRate}%`);

  if (passed) {
    console.log('\n✅ TEST PASSED\n');
    process.exit(0);
  } else {
    console.log('\n❌ TEST FAILED\n');
    console.log('   Thresholds exceeded:');
    if (!errorRateOk) {
      console.log(`   - Error rate ${stats.errorRate}% >= ${CONFIG.maxErrorRate}%`);
    }
    if (!latencyOk) {
      console.log(`   - p95 latency ${stats.latency.p95}ms >= ${CONFIG.maxP95}ms`);
    }
    process.exit(1);
  }
}

// =============================================================================
// Entry Point
// =============================================================================

// Print help
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Native Node.js Stress Test

Usage:
  node stress-test.mjs [options]

Options:
  --target <url>      Target URL (default: http://localhost:8083)
  --vus <number>      Virtual users (default: 10)
  --duration <sec>    Test duration in seconds (default: 60)
  --scenario <name>   Preset scenario: smoke|load|stress|spike|soak

Scenarios:
  smoke   - 1 VU, 30s (verify system works)
  load    - 10 VUs, 60s (normal load)
  stress  - 50 VUs, 120s (push limits)
  spike   - 100 VUs, 30s (sudden traffic)
  soak    - 20 VUs, 600s (sustained load)

Examples:
  node stress-test.mjs --scenario smoke
  node stress-test.mjs --vus 20 --duration 120
  node stress-test.mjs --target http://localhost:80 --scenario stress
  `);
  process.exit(0);
}

runStressTest().catch(console.error);
