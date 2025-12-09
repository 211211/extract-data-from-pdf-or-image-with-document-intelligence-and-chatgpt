# Multi-Turn LLM Chat - Detailed Test Scenarios

## Overview

This document provides detailed test scenarios organized by feature area. Each scenario includes:
- **Objective**: What we're testing
- **Preconditions**: Setup required
- **Steps**: Detailed test steps
- **Expected Results**: What should happen
- **Pass/Fail Criteria**: How to determine success

---

## 1. Basic Chat Functionality

### TC-001: Single Message Chat

**Objective**: Verify basic single-turn chat functionality

**Preconditions**:
- Server is running on localhost:8083
- Azure OpenAI credentials are configured

**Test Steps**:
1. Send POST request to `/api/v1/chat/stream`
2. Observe SSE event stream
3. Collect all events until `done` event

**Request**:
```json
{
  "threadId": "TC-001-001",
  "userId": "tester-001",
  "agentType": "normal",
  "messages": [
    {"id": "msg-1", "role": "user", "content": "What is 2+2?"}
  ]
}
```

**Expected Results**:
- HTTP 200 response with `Content-Type: text/event-stream`
- First event is `metadata` with valid `trace_id`
- Second event is `agent_updated` with `answer: "NormalAgent"`
- Multiple `data` events with streamed response
- Final `done` event
- Response content mentions "4" or "four"

**Pass Criteria**:
- [ ] All events received in correct order
- [ ] Response is mathematically correct
- [ ] Total response time < 10 seconds

---

### TC-002: Multi-Turn Conversation Context

**Objective**: Verify the system maintains conversation context across multiple turns

**Preconditions**:
- Server is running

**Test Steps**:

**Turn 1**:
```json
{
  "threadId": "TC-002-001",
  "userId": "tester-001",
  "messages": [
    {"id": "msg-1", "role": "user", "content": "My favorite color is blue. Remember this."}
  ]
}
```
Expected: Acknowledgment of the information

**Turn 2**:
```json
{
  "threadId": "TC-002-001",
  "userId": "tester-001",
  "messages": [
    {"id": "msg-1", "role": "user", "content": "My favorite color is blue. Remember this."},
    {"id": "msg-2", "role": "assistant", "content": "I'll remember that your favorite color is blue!"},
    {"id": "msg-3", "role": "user", "content": "What is my favorite color?"}
  ]
}
```
Expected: Response mentions "blue"

**Pass Criteria**:
- [ ] AI correctly recalls "blue" as the favorite color
- [ ] Response is confident (not guessing)

---

### TC-003: Extended Multi-Turn (5+ turns)

**Objective**: Verify context is maintained through extended conversations

**Test Conversation**:
```
Turn 1: User introduces themselves (name: Alice, job: data scientist)
Turn 2: User asks about ML algorithms
Turn 3: User asks for code example
Turn 4: User asks for modification to the code
Turn 5: User asks AI to recall their name and job
```

**Pass Criteria**:
- [ ] AI remembers name (Alice) at Turn 5
- [ ] AI remembers job (data scientist) at Turn 5
- [ ] Code at Turn 4 builds on Turn 3 code
- [ ] No context loss or confusion

---

## 2. Agent Selection & Routing

### TC-010: Normal Agent Selection

**Objective**: Verify normal agent is selected correctly

```json
{
  "threadId": "TC-010-001",
  "userId": "tester-001",
  "agentType": "normal",
  "messages": [{"id": "1", "role": "user", "content": "Hello"}]
}
```

**Expected**:
- `agent_updated` event shows `"answer": "NormalAgent"`

---

### TC-011: RAG Agent Selection

**Objective**: Verify RAG agent is selected and performs retrieval

**Preconditions**:
- Azure Cognitive Search configured
- Documents indexed

```json
{
  "threadId": "TC-011-001",
  "userId": "tester-001",
  "agentType": "rag",
  "messages": [{"id": "1", "role": "user", "content": "What does the documentation say about X?"}]
}
```

**Expected**:
- `agent_updated` event shows `"answer": "RagAgent"`
- `metadata` event contains `citations` array
- Response references retrieved documents

---

### TC-012: Multi-Agent Orchestration

**Objective**: Verify multi-agent pipeline executes correctly

```json
{
  "threadId": "TC-012-001",
  "userId": "tester-001",
  "agentType": "multi-agent",
  "messages": [{"id": "1", "role": "user", "content": "Research AI trends and write a summary."}]
}
```

**Expected Event Sequence**:
1. `metadata` - Initial event
2. `agent_updated` - PlannerAgent
3. `data` - Planning thoughts
4. `agent_updated` - ResearcherAgent
5. `data` - Research findings
6. `agent_updated` - WriterAgent
7. `data` - Final response
8. `done` - Completion

**Pass Criteria**:
- [ ] All three agents execute
- [ ] Final response is coherent and comprehensive
- [ ] Agent transitions are logged

---

### TC-013: Default Agent (No agentType specified)

**Objective**: Verify default agent is used when not specified

```json
{
  "threadId": "TC-013-001",
  "userId": "tester-001",
  "messages": [{"id": "1", "role": "user", "content": "Hello"}]
}
```

**Expected**:
- Should use "normal" agent as default
- `agent_updated` shows "NormalAgent"

---

## 3. Stream Management

### TC-020: Stream Resumption

**Objective**: Verify interrupted streams can be resumed

**Steps**:
1. Start a long-running stream
2. Cancel after receiving 3 data events
3. Call health endpoint
4. Resume from afterIndex=3

**Commands**:
```bash
# Step 1: Start stream (cancel with Ctrl+C after 3 events)
curl -N -X POST "http://localhost:8083/api/v1/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{"threadId":"TC-020-001","userId":"tester","messages":[{"id":"1","role":"user","content":"Tell me a very long story"}]}'

# Step 2: Check health
curl "http://localhost:8083/api/v1/chat/health/TC-020-001"

# Step 3: Resume
curl -N "http://localhost:8083/api/v1/chat/resume/TC-020-001?afterIndex=3"
```

**Pass Criteria**:
- [ ] Health endpoint returns stream status
- [ ] Resume returns remaining chunks
- [ ] No duplicate data

---

### TC-021: Stop Active Stream

**Objective**: Verify streams can be stopped

**Steps**:
1. Start a stream
2. Send stop request

```bash
# Start stream in background
curl -N POST "http://localhost:8083/api/v1/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{"threadId":"TC-021-001","userId":"tester","messages":[{"id":"1","role":"user","content":"Write a very long essay"}]}' &

# Stop stream
curl -X POST "http://localhost:8083/api/v1/chat/stop" \
  -H "Content-Type: application/json" \
  -d '{"threadId":"TC-021-001"}'
```

**Pass Criteria**:
- [ ] Stop endpoint returns success
- [ ] Stream terminates gracefully

---

### TC-022: Health Check for Non-existent Thread

**Objective**: Verify proper handling of invalid thread IDs

```bash
curl "http://localhost:8083/api/v1/chat/health/non-existent-thread"
```

**Expected**:
- Returns appropriate status (not found or empty session)

---

## 4. Conversation Styles

### TC-030: Creative Style

**Objective**: Verify creative style produces more elaborate responses

```json
{
  "threadId": "TC-030-001",
  "conversationStyle": "creative",
  "messages": [{"id": "1", "role": "user", "content": "Describe rain"}]
}
```

**Expected**:
- Response uses figurative language
- More descriptive and imaginative
- Longer than precise style

---

### TC-031: Precise Style

**Objective**: Verify precise style produces factual, concise responses

```json
{
  "threadId": "TC-031-001",
  "conversationStyle": "precise",
  "messages": [{"id": "1", "role": "user", "content": "Describe rain"}]
}
```

**Expected**:
- Response is factual
- Shorter and more direct
- Scientific terminology preferred

---

### TC-032: Style Comparison Test

**Objective**: Verify different styles produce noticeably different outputs

**Method**: Send identical prompt with all three styles, compare responses

**Pass Criteria**:
- [ ] Creative response is most elaborate
- [ ] Precise response is most concise
- [ ] Balanced response is in between
- [ ] All responses are relevant to the question

---

## 5. Parameter Handling

### TC-040: Custom System Prompt

**Objective**: Verify custom system prompts are applied

```json
{
  "threadId": "TC-040-001",
  "systemPrompt": "You are a helpful assistant who always responds in exactly 3 bullet points.",
  "messages": [{"id": "1", "role": "user", "content": "Tell me about cats"}]
}
```

**Expected**:
- Response formatted as 3 bullet points

---

### TC-041: Temperature = 0 (Deterministic)

**Objective**: Verify low temperature produces consistent responses

**Method**: Send same prompt 3 times with temperature=0

```json
{
  "threadId": "TC-041-{n}",
  "temperature": 0,
  "messages": [{"id": "1", "role": "user", "content": "What is the capital of Japan?"}]
}
```

**Expected**:
- All 3 responses should be identical or nearly identical

---

### TC-042: Max Tokens Limit

**Objective**: Verify maxTokens parameter limits response length

```json
{
  "threadId": "TC-042-001",
  "maxTokens": 20,
  "messages": [{"id": "1", "role": "user", "content": "Write a long essay about technology"}]
}
```

**Expected**:
- Response is truncated to approximately 20 tokens
- Response may end mid-sentence

---

## 6. Error Handling

### TC-050: Missing Required Field (userId)

```json
{
  "threadId": "TC-050-001",
  "messages": [{"id": "1", "role": "user", "content": "Hello"}]
}
```

**Expected**:
- HTTP 400
- Error message mentions "userId"

---

### TC-051: Missing Required Field (messages)

```json
{
  "threadId": "TC-051-001",
  "userId": "tester"
}
```

**Expected**:
- HTTP 400
- Error message mentions "messages"

---

### TC-052: Invalid Message Role

```json
{
  "threadId": "TC-052-001",
  "userId": "tester",
  "messages": [{"id": "1", "role": "invalid", "content": "Hello"}]
}
```

**Expected**:
- HTTP 400
- Error message mentions invalid role

---

### TC-053: Empty Messages Array

```json
{
  "threadId": "TC-053-001",
  "userId": "tester",
  "messages": []
}
```

**Expected**:
- HTTP 400 or graceful handling

---

### TC-054: Invalid JSON Body

```bash
curl -X POST "http://localhost:8083/api/v1/chat/stream" \
  -H "Content-Type: application/json" \
  -d 'not valid json'
```

**Expected**:
- HTTP 400
- JSON parse error

---

### TC-055: Temperature Out of Range

```json
{
  "threadId": "TC-055-001",
  "userId": "tester",
  "temperature": 2.0,
  "messages": [{"id": "1", "role": "user", "content": "Hello"}]
}
```

**Expected**:
- HTTP 400
- Error mentions temperature range (0-1)

---

### TC-056: MaxTokens Out of Range

```json
{
  "threadId": "TC-056-001",
  "userId": "tester",
  "maxTokens": 100000,
  "messages": [{"id": "1", "role": "user", "content": "Hello"}]
}
```

**Expected**:
- HTTP 400
- Error mentions maxTokens range

---

## 7. SSE Protocol Compliance

### TC-060: SSE Headers

**Objective**: Verify correct SSE response headers

```bash
curl -v -X POST "http://localhost:8083/api/v1/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{"threadId":"TC-060","userId":"tester","messages":[{"id":"1","role":"user","content":"Hi"}]}'
```

**Expected Headers**:
- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `Connection: keep-alive`

---

### TC-061: SSE Event Format

**Objective**: Verify events follow SSE specification

**Expected Format**:
```
event: <event_type>
data: <json_data>

```
(Note: Double newline after each event)

---

### TC-062: Event Ordering

**Objective**: Verify events arrive in correct order

**Expected Order**:
1. `metadata` (always first)
2. `agent_updated` (at least once)
3. `data` (zero or more)
4. `done` (always last, unless error)

---

## 8. Performance Tests

### TC-070: Time to First Token (TTFT)

**Objective**: Measure time from request to first data event

**Method**:
1. Record timestamp before request
2. Record timestamp when first `data` event received
3. Calculate difference

**Pass Criteria**:
- TTFT < 2 seconds (typical)
- TTFT < 5 seconds (maximum)

---

### TC-071: Total Response Time

**Objective**: Measure total time for simple query

**Method**:
1. Send simple query "What is 2+2?"
2. Measure time until `done` event

**Pass Criteria**:
- Total time < 10 seconds

---

### TC-072: Concurrent Users

**Objective**: Verify system handles multiple simultaneous streams

**Method**:
```bash
for i in {1..10}; do
  curl -N -X POST "http://localhost:8083/api/v1/chat/stream" \
    -H "Content-Type: application/json" \
    -d "{\"threadId\":\"concurrent-$i\",\"userId\":\"user-$i\",\"messages\":[{\"id\":\"1\",\"role\":\"user\",\"content\":\"Hello $i\"}]}" &
done
wait
```

**Pass Criteria**:
- All 10 streams complete successfully
- No errors or timeouts
- Response times remain reasonable

---

## 9. Special Characters & Edge Cases

### TC-080: Unicode Characters

```json
{
  "threadId": "TC-080-001",
  "userId": "tester",
  "messages": [{"id": "1", "role": "user", "content": "Translate 'hello' to Japanese: こんにちは"}]
}
```

**Expected**:
- Unicode characters handled correctly
- Response may include Japanese characters

---

### TC-081: Emoji Support

```json
{
  "threadId": "TC-081-001",
  "userId": "tester",
  "messages": [{"id": "1", "role": "user", "content": "What does this emoji mean? 🎉"}]
}
```

**Expected**:
- Emoji processed correctly
- Meaningful response about celebration/party

---

### TC-082: Very Long Message

**Objective**: Test handling of messages near context limit

```json
{
  "threadId": "TC-082-001",
  "userId": "tester",
  "messages": [{"id": "1", "role": "user", "content": "<5000+ character message>"}]
}
```

**Expected**:
- Either processes successfully or returns appropriate error

---

### TC-083: HTML/Script Injection Attempt

```json
{
  "threadId": "TC-083-001",
  "userId": "tester",
  "messages": [{"id": "1", "role": "user", "content": "<script>alert('xss')</script>"}]
}
```

**Expected**:
- Script is not executed
- Treated as plain text
- No security vulnerability

---

### TC-084: SQL-like Input

```json
{
  "threadId": "TC-084-001",
  "userId": "tester",
  "messages": [{"id": "1", "role": "user", "content": "'; DROP TABLE users; --"}]
}
```

**Expected**:
- Processed as plain text
- No injection vulnerability

---

## 10. UUID v7 Verification

### TC-090: Trace ID Format

**Objective**: Verify trace_id is UUID v7 format

**Method**:
1. Capture `metadata` event
2. Extract `trace_id`
3. Verify format: `019xxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx`

**UUID v7 Characteristics**:
- Starts with timestamp prefix (e.g., "019")
- Version digit is "7"
- Time-sortable

---

### TC-091: Trace ID Uniqueness

**Objective**: Verify each request gets unique trace_id

**Method**:
1. Send 10 requests
2. Collect all trace_ids
3. Verify all are unique

---

## Test Execution Template

| Test ID | Test Name | Status | Notes | Tester | Date |
|---------|-----------|--------|-------|--------|------|
| TC-001 | Single Message Chat | | | | |
| TC-002 | Multi-Turn Context | | | | |
| TC-003 | Extended Multi-Turn | | | | |
| ... | ... | | | | |

**Status Legend**:
- ✅ Pass
- ❌ Fail
- ⏸️ Blocked
- ⏭️ Skipped
- 🔄 In Progress
