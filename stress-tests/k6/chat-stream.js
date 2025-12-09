/**
 * k6 Stress Test - Chat Streaming Endpoint
 *
 * Tests the SSE streaming /chat/stream endpoint with various load patterns.
 *
 * Install k6:
 *   brew install k6
 *
 * Run:
 *   k6 run stress-tests/k6/chat-stream.js
 *   k6 run --vus 10 --duration 30s stress-tests/k6/chat-stream.js
 *   k6 run stress-tests/k6/chat-stream.js --env TARGET_URL=http://localhost:80
 */

import { Counter, Rate, Trend } from 'k6/metrics';
import { check, sleep } from 'k6';
import { randomItem, randomString } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

import http from 'k6/http';

// =============================================================================
// Configuration
// =============================================================================

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:8083';

// Test scenarios - uncomment the one you want to run
export const options = {
  scenarios: {
    // Scenario 1: Smoke test (verify system works)
    smoke: {
      executor: 'constant-vus',
      vus: 1,
      duration: '30s',
      startTime: '0s',
      tags: { test_type: 'smoke' },
    },

    // Scenario 2: Load test (normal expected load)
    load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 10 }, // Ramp up to 10 users
        { duration: '3m', target: 10 }, // Stay at 10 users
        { duration: '1m', target: 0 }, // Ramp down
      ],
      startTime: '30s',
      tags: { test_type: 'load' },
    },

    // Scenario 3: Stress test (push limits)
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 20 }, // Ramp up
        { duration: '5m', target: 20 }, // Stay at peak
        { duration: '2m', target: 50 }, // Push higher
        { duration: '3m', target: 50 }, // Stay at stress
        { duration: '2m', target: 0 }, // Ramp down
      ],
      startTime: '5m30s',
      tags: { test_type: 'stress' },
    },

    // Scenario 4: Spike test (sudden traffic)
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 100 }, // Spike!
        { duration: '1m', target: 100 }, // Stay at spike
        { duration: '10s', target: 0 }, // Drop
      ],
      startTime: '19m30s',
      tags: { test_type: 'spike' },
    },
  },

  // Thresholds (pass/fail criteria)
  thresholds: {
    http_req_duration: ['p(95)<5000'], // 95% of requests under 5s
    http_req_failed: ['rate<0.1'], // Less than 10% failed
    sse_first_byte: ['p(95)<2000'], // First byte under 2s
    sse_message_count: ['avg>1'], // At least 1 message per stream
  },
};

// =============================================================================
// Custom Metrics
// =============================================================================

const sseFirstByte = new Trend('sse_first_byte', true);
const sseMessageCount = new Counter('sse_message_count');
const sseStreamDuration = new Trend('sse_stream_duration', true);
const sseErrors = new Rate('sse_errors');

// =============================================================================
// Test Data
// =============================================================================

const testQueries = [
  'What is the capital of France?',
  'Explain quantum computing in simple terms.',
  'Write a haiku about programming.',
  'What are the benefits of microservices?',
  'How does SSE streaming work?',
  'Explain the difference between REST and GraphQL.',
  'What is a neural network?',
  'Describe the CAP theorem.',
  'What is eventual consistency?',
  'How do load balancers work?',
];

const agentTypes = ['normal', 'rag', 'multi-agent'];

// =============================================================================
// Helper Functions
// =============================================================================

function generateChatPayload(threadId) {
  return JSON.stringify({
    threadId: threadId || `stress-test-${randomString(8)}`,
    userId: `stress-user-${__VU}`,
    agentType: randomItem(agentTypes),
    messages: [{ role: 'user', content: randomItem(testQueries) }],
  });
}

function parseSSEStream(response) {
  const messages = [];
  const body = response.body || '';
  const lines = body.split('\n');

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try {
        const data = JSON.parse(line.slice(6));
        messages.push(data);
      } catch (e) {
        // Skip non-JSON data lines
      }
    }
  }

  return messages;
}

// =============================================================================
// Main Test Function
// =============================================================================

export default function () {
  const threadId = `thread-${__VU}-${__ITER}`;
  const payload = generateChatPayload(threadId);

  const params = {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'X-User-Id': `stress-user-${__VU}`,
    },
    timeout: '60s',
    tags: {
      name: 'chat_stream',
    },
  };

  const startTime = Date.now();

  // Make the streaming request
  const response = http.post(`${BASE_URL}/api/v1/chat/stream`, payload, params);

  const endTime = Date.now();
  const duration = endTime - startTime;

  // Record metrics
  sseStreamDuration.add(duration);

  // Check response
  const isSuccess = check(response, {
    'status is 200': (r) => r.status === 200,
    'content-type is SSE': (r) => r.headers['Content-Type']?.includes('text/event-stream'),
    'body is not empty': (r) => r.body && r.body.length > 0,
  });

  if (!isSuccess) {
    sseErrors.add(1);
    console.error(`Request failed: ${response.status} - ${response.body?.substring(0, 200)}`);
    return;
  }

  sseErrors.add(0);

  // Parse and validate SSE messages
  const messages = parseSSEStream(response);
  sseMessageCount.add(messages.length);

  // Check message structure
  check(messages, {
    'has metadata event': (msgs) => msgs.some((m) => m.event === 'metadata'),
    'has done event': (msgs) => msgs.some((m) => m.event === 'done'),
    'has content': (msgs) => msgs.some((m) => m.event === 'data'),
  });

  // Record first byte time (approximate)
  if (messages.length > 0) {
    // Estimate based on total duration / message count
    sseFirstByte.add(duration / messages.length);
  }

  // Think time between requests (simulate real user)
  sleep(Math.random() * 2 + 1); // 1-3 seconds
}

// =============================================================================
// Setup and Teardown
// =============================================================================

export function setup() {
  // Verify the service is running
  const healthCheck = http.get(`${BASE_URL}/api/v1/chat/status`);

  if (healthCheck.status !== 200) {
    throw new Error(`Service not available: ${healthCheck.status}`);
  }

  console.log(`Starting stress test against ${BASE_URL}`);
  console.log(`Health check passed: ${healthCheck.body}`);

  return { startTime: Date.now() };
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`Stress test completed in ${duration.toFixed(2)}s`);
}
