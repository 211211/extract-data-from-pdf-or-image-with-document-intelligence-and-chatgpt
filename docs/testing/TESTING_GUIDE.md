# Multi-Turn LLM Chat Application - Testing Guide

## Table of Contents

1. [Overview](#overview)
2. [Test Environment Setup](#test-environment-setup)
3. [Business Test Scenarios](#business-test-scenarios)
4. [API Testing with Postman/cURL](#api-testing-with-postmancurl)
5. [SSE Stream Testing](#sse-stream-testing)
6. [Multi-Turn Conversation Testing](#multi-turn-conversation-testing)
7. [Agent-Specific Testing](#agent-specific-testing)
8. [Error Handling & Edge Cases](#error-handling--edge-cases)
9. [Performance Testing](#performance-testing)
10. [Acceptance Criteria Checklist](#acceptance-criteria-checklist)

---

## Overview

This guide provides comprehensive testing strategies for the Multi-Turn LLM Chat Application. It covers both technical API testing and business-focused validation scenarios.

### Key Components Under Test

| Component | Description | Test Focus |
|-----------|-------------|------------|
| Chat Streaming API | SSE-based real-time responses | Latency, format, reliability |
| Multi-Turn Context | Conversation history management | Context retention, coherence |
| Agent Selection | Normal, RAG, Multi-Agent | Correct routing, handoffs |
| Stream Resumption | Reconnection support | Data integrity, seamless recovery |
| Error Handling | Graceful degradation | User experience, error messages |

---

## Test Environment Setup

### Prerequisites

```bash
# 1. Start the NestJS server
yarn start:dev

# 2. Verify server is running
curl http://localhost:8083/api/v1

# 3. Check available agents
curl http://localhost:8083/api/v1/chat/agents
```

### Environment Variables Required

```env
# .env file
AZURE_OPENAI_API_INSTANCE_NAME=your-instance
AZURE_OPENAI_API_KEY=your-key
AZURE_OPENAI_API_DEPLOYMENT_NAME=gpt-4
AZURE_OPENAI_API_VERSION=2024-02-15-preview

# For RAG agent
AZURE_SEARCH_API_KEY=your-search-key
AZURE_SEARCH_NAME=your-search-name
AZURE_SEARCH_INDEX_NAME=your-index

# Stream store (memory for local, redis for production)
SSE_STREAM_STORE_PROVIDER=memory
```

---

## Business Test Scenarios

### Scenario 1: First-Time User Greeting

**User Story**: As a new user, I want to start a conversation and receive a friendly, contextual response.

**Test Steps**:
1. Send initial greeting message
2. Verify response is received via SSE
3. Confirm response is coherent and welcoming

**Expected Behavior**:
- Response streams in real-time (token by token)
- Response is contextually appropriate
- Metadata includes trace_id for debugging

```bash
curl -N -X POST "http://localhost:8083/api/v1/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{
    "threadId": "user-greeting-test-001",
    "userId": "test-user-001",
    "agentType": "normal",
    "messages": [
      {"id": "msg-1", "role": "user", "content": "Hello! This is my first time using this chat."}
    ]
  }'
```

**Acceptance Criteria**:
- [ ] SSE stream starts within 2 seconds
- [ ] `metadata` event received first with valid `trace_id`
- [ ] `agent_updated` event shows correct agent name
- [ ] `data` events contain streamed response tokens
- [ ] `done` event received at completion
- [ ] Response acknowledges first-time user context

---

### Scenario 2: Multi-Turn Context Retention

**User Story**: As a returning user, I want the AI to remember our previous conversation within the same session.

**Test Steps**:
1. Send first message introducing a topic
2. Send follow-up message referencing the topic without restating it
3. Verify AI maintains context from previous messages

**Turn 1 - Establish Context**:
```bash
curl -N -X POST "http://localhost:8083/api/v1/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{
    "threadId": "context-test-001",
    "userId": "test-user-002",
    "agentType": "normal",
    "messages": [
      {"id": "msg-1", "role": "user", "content": "My name is John and I work as a software engineer at TechCorp."}
    ]
  }'
```

**Turn 2 - Test Context Retention**:
```bash
curl -N -X POST "http://localhost:8083/api/v1/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{
    "threadId": "context-test-001",
    "userId": "test-user-002",
    "agentType": "normal",
    "messages": [
      {"id": "msg-1", "role": "user", "content": "My name is John and I work as a software engineer at TechCorp."},
      {"id": "msg-2", "role": "assistant", "content": "Hello John! Nice to meet you. How can I help you today with your work at TechCorp?"},
      {"id": "msg-3", "role": "user", "content": "What did I say my job was?"}
    ]
  }'
```

**Acceptance Criteria**:
- [ ] AI correctly recalls user's name (John)
- [ ] AI correctly recalls user's job (software engineer)
- [ ] AI correctly recalls company name (TechCorp)
- [ ] Response is coherent with conversation history

---

### Scenario 3: Complex Multi-Turn Technical Discussion

**User Story**: As a developer, I want to have a technical discussion that builds on previous context.

**Test Conversation Flow**:

```json
// Turn 1: Set the technical context
{
  "messages": [
    {"id": "1", "role": "user", "content": "I'm building a React application with TypeScript. I'm having issues with state management."}
  ]
}

// Turn 2: Follow-up question
{
  "messages": [
    {"id": "1", "role": "user", "content": "I'm building a React application with TypeScript. I'm having issues with state management."},
    {"id": "2", "role": "assistant", "content": "I understand you're working with React and TypeScript. State management can be challenging. Could you tell me more about the specific issues you're facing? Are you using a state management library like Redux, Zustand, or React Context?"},
    {"id": "3", "role": "user", "content": "I'm using Redux Toolkit but the async actions are confusing me."}
  ]
}

// Turn 3: Deep dive
{
  "messages": [
    // ... previous messages ...
    {"id": "4", "role": "assistant", "content": "Redux Toolkit simplifies async actions with createAsyncThunk..."},
    {"id": "5", "role": "user", "content": "Can you show me an example with error handling?"}
  ]
}
```

**Acceptance Criteria**:
- [ ] Each response builds on previous context
- [ ] Technical terminology is consistent throughout
- [ ] Code examples (if provided) match the technology stack discussed
- [ ] No context loss between turns

---

### Scenario 4: RAG Agent - Document-Based Q&A

**User Story**: As a user, I want to ask questions and get answers grounded in company documents.

**Prerequisites**:
- Documents indexed in Azure Cognitive Search
- RAG agent configured with search credentials

```bash
curl -N -X POST "http://localhost:8083/api/v1/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{
    "threadId": "rag-test-001",
    "userId": "test-user-003",
    "agentType": "rag",
    "messages": [
      {"id": "msg-1", "role": "user", "content": "What is our company policy on remote work?"}
    ]
  }'
```

**Acceptance Criteria**:
- [ ] Response includes citations from source documents
- [ ] `metadata` event contains `citations` array
- [ ] Response is grounded in retrieved documents
- [ ] Citations include document title and source reference
- [ ] Fallback message if no relevant documents found

---

### Scenario 5: Multi-Agent Orchestration

**User Story**: As a user asking a complex question, I want multiple specialized agents to collaborate on my answer.

```bash
curl -N -X POST "http://localhost:8083/api/v1/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{
    "threadId": "multi-agent-test-001",
    "userId": "test-user-004",
    "agentType": "multi-agent",
    "messages": [
      {"id": "msg-1", "role": "user", "content": "Research the latest trends in AI and write me a comprehensive summary with recommendations for our company."}
    ]
  }'
```

**Expected Event Flow**:
```
event: metadata
data: {"trace_id": "...", "citations": []}

event: agent_updated
data: {"answer": "PlannerAgent", "content_type": "thoughts"}

event: data
data: {"answer": "Analyzing your request..."}

event: agent_updated
data: {"answer": "ResearcherAgent", "content_type": "thoughts"}

event: data
data: {"answer": "Gathering information..."}

event: agent_updated
data: {"answer": "WriterAgent", "content_type": "final_answer"}

event: data
data: {"answer": "Based on my research..."}

event: done
data: {"answer": "Stream completed"}
```

**Acceptance Criteria**:
- [ ] `agent_updated` events show agent transitions
- [ ] Planner agent creates execution plan
- [ ] Researcher agent gathers relevant information
- [ ] Writer agent produces final coherent response
- [ ] Handoffs are logged with reasons
- [ ] Total response time is reasonable (< 60 seconds)

---

### Scenario 6: Stream Interruption and Resumption

**User Story**: As a user with unstable internet, I want to resume my chat stream if disconnected.

**Test Steps**:

1. Start a chat stream
2. Note the `threadId`
3. Simulate disconnection (close the connection)
4. Resume stream using the resume endpoint

```bash
# Step 1: Start stream (note the threadId)
curl -N -X POST "http://localhost:8083/api/v1/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{
    "threadId": "resume-test-001",
    "userId": "test-user-005",
    "agentType": "normal",
    "messages": [{"id": "msg-1", "role": "user", "content": "Tell me a long story about a brave knight."}]
  }'
# Ctrl+C to disconnect mid-stream

# Step 2: Check stream health
curl "http://localhost:8083/api/v1/chat/health/resume-test-001"

# Step 3: Resume from where you left off (e.g., after chunk 5)
curl -N "http://localhost:8083/api/v1/chat/resume/resume-test-001?afterIndex=5"
```

**Acceptance Criteria**:
- [ ] Health endpoint returns stream status
- [ ] Resume endpoint returns remaining chunks
- [ ] No data duplication on resume
- [ ] Complete story can be reconstructed from all chunks

---

### Scenario 7: Conversation Style Variations

**User Story**: As a user, I want to control the AI's response style (creative, balanced, precise).

**Test Creative Style**:
```bash
curl -N -X POST "http://localhost:8083/api/v1/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{
    "threadId": "style-creative-001",
    "userId": "test-user-006",
    "agentType": "normal",
    "conversationStyle": "creative",
    "messages": [{"id": "msg-1", "role": "user", "content": "Describe a sunset"}]
  }'
```

**Test Precise Style**:
```bash
curl -N -X POST "http://localhost:8083/api/v1/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{
    "threadId": "style-precise-001",
    "userId": "test-user-006",
    "agentType": "normal",
    "conversationStyle": "precise",
    "messages": [{"id": "msg-1", "role": "user", "content": "Describe a sunset"}]
  }'
```

**Acceptance Criteria**:
- [ ] Creative style produces more elaborate, imaginative responses
- [ ] Precise style produces factual, concise responses
- [ ] Balanced style is the default middle-ground
- [ ] Style setting persists across multi-turn conversation

---

## API Testing with Postman/cURL

### Request/Response Format Reference

**Request Body Schema**:
```json
{
  "threadId": "string (required) - Unique conversation identifier",
  "userId": "string (required) - User identifier for tracking",
  "agentType": "string (optional) - 'normal' | 'rag' | 'multi-agent'",
  "messages": [
    {
      "id": "string (required) - Unique message ID",
      "role": "string (required) - 'user' | 'assistant' | 'system'",
      "content": "string (required) - Message content",
      "metadata": "object (optional) - Additional metadata"
    }
  ],
  "conversationStyle": "string (optional) - 'balanced' | 'creative' | 'precise'",
  "maxTokens": "number (optional) - Max response tokens (1-8192)",
  "temperature": "number (optional) - Generation temperature (0-1)",
  "systemPrompt": "string (optional) - Custom system prompt"
}
```

**SSE Event Types**:

| Event | Description | Data Structure |
|-------|-------------|----------------|
| `metadata` | Stream initialization | `{trace_id, citations[]}` |
| `agent_updated` | Agent change notification | `{answer, content_type}` |
| `data` | Streamed content chunk | `{answer}` |
| `done` | Stream completion | `{answer}` |
| `error` | Error occurred | `{error, code}` |

---

## SSE Stream Testing

### Validating SSE Format

Each SSE event must follow this format:
```
event: <event_type>
data: <json_payload>

```
(Note: Two newlines after each event)

### Test SSE Compliance

```bash
# Use curl with verbose output to verify headers
curl -v -N -X POST "http://localhost:8083/api/v1/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{"threadId":"sse-test","userId":"user","messages":[{"id":"1","role":"user","content":"Hi"}]}'
```

**Expected Headers**:
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

---

## Multi-Turn Conversation Testing

### Testing Context Window Limits

Send progressively longer conversation histories to test context handling:

```bash
# Generate a conversation with 20 turns
# Test that the system handles long histories gracefully
```

### Testing Message Ordering

Verify messages are processed in correct order:
```json
{
  "messages": [
    {"id": "1", "role": "system", "content": "You are a helpful assistant"},
    {"id": "2", "role": "user", "content": "First question"},
    {"id": "3", "role": "assistant", "content": "First answer"},
    {"id": "4", "role": "user", "content": "Follow-up question"}
  ]
}
```

---

## Agent-Specific Testing

### Normal Agent Tests

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| Simple greeting | "Hello" | Friendly greeting response |
| Code question | "Write a Python hello world" | Python code snippet |
| Factual question | "What is the capital of France?" | "Paris" in response |
| Opinion question | "What's the best programming language?" | Balanced perspective |

### RAG Agent Tests

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| Document query | "What is in document X?" | Response with citations |
| No results | Query with no matching docs | Graceful fallback message |
| Multiple sources | Query matching multiple docs | Combined answer with all citations |

### Multi-Agent Tests

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| Research task | "Research topic X" | Planner → Researcher → Writer flow |
| Simple question | "What time is it?" | May skip some agents |
| Complex analysis | "Analyze and recommend" | Full agent pipeline |

---

## Error Handling & Edge Cases

### Test Cases

| Scenario | Test Input | Expected Behavior |
|----------|------------|-------------------|
| Empty message | `{"messages": []}` | 400 Bad Request |
| Missing required fields | `{"userId": "test"}` | 400 with validation errors |
| Invalid agent type | `{"agentType": "invalid"}` | Fallback to default or error |
| Very long message | 10000+ character message | Truncation or error handling |
| Special characters | Unicode, emojis, HTML | Proper encoding/escaping |
| Concurrent requests | Multiple simultaneous | All handled independently |
| Invalid threadId | Non-string threadId | 400 Bad Request |
| Azure API down | N/A (mock) | Graceful error with code |

### Error Response Format

```json
{
  "message": ["error details"],
  "error": "Bad Request",
  "statusCode": 400
}
```

### SSE Error Event

```
event: error
data: {"error": "Error message", "code": "ERROR_CODE"}
```

**Error Codes**:
- `AGENT_ERROR` - Agent execution failed
- `TIMEOUT` - Request timed out
- `RATE_LIMIT` - Too many requests
- `INVALID_REQUEST` - Malformed request

---

## Performance Testing

### Metrics to Measure

1. **Time to First Token (TTFT)**: Time from request to first `data` event
2. **Total Response Time**: Time from request to `done` event
3. **Tokens per Second**: Streaming throughput
4. **Concurrent Users**: Max simultaneous streams

### Load Testing Script

```bash
# Simple load test with 10 concurrent users
for i in {1..10}; do
  curl -N -X POST "http://localhost:8083/api/v1/chat/stream" \
    -H "Content-Type: application/json" \
    -d "{\"threadId\":\"load-test-$i\",\"userId\":\"user-$i\",\"messages\":[{\"id\":\"1\",\"role\":\"user\",\"content\":\"Hello\"}]}" &
done
wait
```

### Performance Targets

| Metric | Target | Critical |
|--------|--------|----------|
| TTFT | < 2s | < 5s |
| Total Response (simple) | < 10s | < 30s |
| Total Response (complex) | < 30s | < 60s |
| Concurrent Users | 50+ | 20+ |
| Error Rate | < 1% | < 5% |

---

## Acceptance Criteria Checklist

### Functional Requirements

- [ ] **F1**: User can start a new conversation
- [ ] **F2**: User can continue an existing conversation
- [ ] **F3**: System maintains context across multiple turns
- [ ] **F4**: User can select different agent types
- [ ] **F5**: RAG agent returns relevant citations
- [ ] **F6**: Multi-agent orchestrator coordinates multiple agents
- [ ] **F7**: User can resume interrupted streams
- [ ] **F8**: User can stop active streams
- [ ] **F9**: Different conversation styles produce different outputs

### Non-Functional Requirements

- [ ] **NF1**: Responses stream in real-time (not batched)
- [ ] **NF2**: System handles concurrent users
- [ ] **NF3**: Errors are handled gracefully with user-friendly messages
- [ ] **NF4**: System is stateless (can scale horizontally)
- [ ] **NF5**: Stream store persists data for resumption
- [ ] **NF6**: UUID v7 provides time-sortable identifiers

### API Contract

- [ ] **API1**: All endpoints return proper HTTP status codes
- [ ] **API2**: SSE format complies with RFC 6202
- [ ] **API3**: Request validation returns helpful error messages
- [ ] **API4**: Response headers are correctly set

### Security

- [ ] **S1**: No sensitive data in error messages
- [ ] **S2**: User isolation (users can't access other users' threads)
- [ ] **S3**: Input validation prevents injection attacks
- [ ] **S4**: API keys are not exposed in responses

---

## Appendix: Quick Reference Commands

```bash
# Health check
curl http://localhost:8083/api/v1

# List agents
curl http://localhost:8083/api/v1/chat/agents

# Simple chat
curl -N -X POST "http://localhost:8083/api/v1/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{"threadId":"test","userId":"user","messages":[{"id":"1","role":"user","content":"Hi"}]}'

# Stop stream
curl -X POST "http://localhost:8083/api/v1/chat/stop" \
  -H "Content-Type: application/json" \
  -d '{"threadId":"test"}'

# Check health
curl "http://localhost:8083/api/v1/chat/health/test"

# Resume stream
curl -N "http://localhost:8083/api/v1/chat/resume/test?afterIndex=0"
```
