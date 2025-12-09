#!/usr/bin/env node
/**
 * SSE Streaming Specific Stress Test
 *
 * Tests SSE streaming behavior specifically:
 * - Measures time to first token
 * - Counts streamed messages
 * - Validates SSE event format
 * - Tests concurrent streams
 *
 * Usage:
 *   node stress-tests/native/sse-test.mjs
 *   node stress-tests/native/sse-test.mjs --streams 20
 */

import { URL } from 'url';
import http from 'http';
import { performance } from 'perf_hooks';

const TARGET = process.env.TARGET_URL || 'http://localhost:8083';
const CONCURRENT_STREAMS = parseInt(process.argv.find((_, i, arr) => arr[i - 1] === '--streams') || '5');

// =============================================================================
// SSE Stream Handler
// =============================================================================

function createSSEStream(streamId) {
  return new Promise((resolve) => {
    const startTime = performance.now();
    const result = {
      streamId,
      success: false,
      timeToFirstToken: null,
      timeToComplete: null,
      tokenCount: 0,
      messageCount: 0,
      events: {
        metadata: false,
        data: 0,
        done: false,
        error: null,
      },
      error: null,
    };

    const parsedUrl = new URL(`${TARGET}/api/v1/chat/stream`);

    const payload = JSON.stringify({
      threadId: `sse-test-${streamId}-${Date.now()}`,
      userId: `sse-tester-${streamId}`,
      agentType: 'normal',
      messages: [{ role: 'user', content: 'Count from 1 to 5' }],
    });

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 80,
      path: parsedUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-User-Id': `sse-tester-${streamId}`,
      },
      timeout: 60000,
    };

    const req = http.request(options, (res) => {
      let buffer = '';
      let firstTokenReceived = false;

      if (res.statusCode !== 200) {
        result.error = `HTTP ${res.statusCode}`;
        resolve(result);
        return;
      }

      res.on('data', (chunk) => {
        const data = chunk.toString();

        // Time to first token
        if (!firstTokenReceived) {
          result.timeToFirstToken = performance.now() - startTime;
          firstTokenReceived = true;
        }

        buffer += data;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            const eventType = line.slice(7).trim();
            if (eventType === 'metadata') result.events.metadata = true;
            if (eventType === 'done') result.events.done = true;
            if (eventType === 'error') result.events.error = true;
          }

          if (line.startsWith('data: ')) {
            result.messageCount++;
            try {
              const json = JSON.parse(line.slice(6));
              if (json.event === 'data' && json.data) {
                result.events.data++;
                result.tokenCount += (json.data.match(/\s+/g) || []).length + 1;
              }
            } catch {
              // Not JSON, raw data
              result.events.data++;
            }
          }
        }
      });

      res.on('end', () => {
        result.timeToComplete = performance.now() - startTime;
        result.success = result.events.done || result.messageCount > 0;
        resolve(result);
      });

      res.on('error', (err) => {
        result.error = err.message;
        resolve(result);
      });
    });

    req.on('error', (err) => {
      result.error = err.code || err.message;
      resolve(result);
    });

    req.on('timeout', () => {
      result.error = 'TIMEOUT';
      req.destroy();
      resolve(result);
    });

    req.write(payload);
    req.end();
  });
}

// =============================================================================
// Test Runner
// =============================================================================

async function runSSETest() {
  console.log('\n🌊 SSE Streaming Stress Test');
  console.log('═'.repeat(50));
  console.log(`📍 Target:            ${TARGET}`);
  console.log(`🔄 Concurrent Streams: ${CONCURRENT_STREAMS}`);
  console.log('═'.repeat(50));

  // Health check
  console.log('\n🏥 Checking health...');
  try {
    const health = await fetch(`${TARGET}/health`);
    if (!health.ok) throw new Error(`Status ${health.status}`);
    console.log('✅ Server is healthy\n');
  } catch (err) {
    console.error(`❌ Health check failed: ${err.message}`);
    process.exit(1);
  }

  // Run concurrent streams
  console.log(`🚀 Starting ${CONCURRENT_STREAMS} concurrent SSE streams...\n`);

  const streamPromises = [];
  for (let i = 0; i < CONCURRENT_STREAMS; i++) {
    streamPromises.push(createSSEStream(i + 1));
  }

  const results = await Promise.all(streamPromises);

  // Analyze results
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  const avgTimeToFirstToken =
    successful.length > 0 ? successful.reduce((sum, r) => sum + (r.timeToFirstToken || 0), 0) / successful.length : 0;

  const avgTimeToComplete =
    successful.length > 0 ? successful.reduce((sum, r) => sum + (r.timeToComplete || 0), 0) / successful.length : 0;

  const avgMessages =
    successful.length > 0 ? successful.reduce((sum, r) => sum + r.messageCount, 0) / successful.length : 0;

  // Print results
  console.log('═'.repeat(50));
  console.log('📊 RESULTS');
  console.log('═'.repeat(50));

  console.log(`
  Streams:
    ✅ Successful:     ${successful.length}
    ❌ Failed:         ${failed.length}

  Timing (ms):
    ⏱️  Time to First Token (avg): ${avgTimeToFirstToken.toFixed(2)}
    ⏱️  Time to Complete (avg):    ${avgTimeToComplete.toFixed(2)}

  Messages:
    📨 Average per stream:  ${avgMessages.toFixed(1)}
  `);

  // Detailed stream results
  console.log('  Stream Details:');
  console.log('  ' + '-'.repeat(46));
  console.log('  ID   Status   TTFT(ms)   Complete(ms)   Msgs');
  console.log('  ' + '-'.repeat(46));

  for (const r of results) {
    const status = r.success ? '✅' : '❌';
    const ttft = r.timeToFirstToken?.toFixed(0) || '-';
    const complete = r.timeToComplete?.toFixed(0) || '-';
    console.log(
      `  ${r.streamId.toString().padStart(3)}  ${status}      ${ttft.padStart(6)}     ${complete.padStart(8)}      ${
        r.messageCount
      }`,
    );
    if (r.error) {
      console.log(`       └─ Error: ${r.error}`);
    }
  }

  console.log('  ' + '-'.repeat(46));
  console.log('═'.repeat(50));

  // Pass/fail
  const errorRate = (failed.length / results.length) * 100;
  const passed = errorRate < 20 && avgTimeToFirstToken < 3000;

  if (passed) {
    console.log('\n✅ SSE TEST PASSED\n');
  } else {
    console.log('\n❌ SSE TEST FAILED');
    if (errorRate >= 20) console.log(`   - Error rate ${errorRate.toFixed(1)}% >= 20%`);
    if (avgTimeToFirstToken >= 3000) console.log(`   - TTFT ${avgTimeToFirstToken.toFixed(0)}ms >= 3000ms`);
    console.log('');
  }

  process.exit(passed ? 0 : 1);
}

runSSETest().catch(console.error);
