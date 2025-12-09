# QA Quick Reference Guide

## Quick Start

### 1. Start the Server
```bash
cd extract-data-from-pdf-or-image-with-document-intelligence-and-chatgpt
yarn install
yarn start:dev
```

### 2. Verify Server is Running
```bash
curl http://localhost:8083/api/v1
# Expected: {"message": "Welcome to the API"}

curl http://localhost:8083/api/v1/chat/agents
# Expected: {"agents": ["normal", "rag", "multi-agent"]}
```

---

## Essential Test Commands

### Basic Chat Test
```bash
curl -N -X POST "http://localhost:8083/api/v1/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{
    "threadId": "test-001",
    "userId": "qa-tester",
    "agentType": "normal",
    "messages": [{"id": "1", "role": "user", "content": "Hello, how are you?"}]
  }'
```

### Multi-Turn Test
```bash
# Turn 1
curl -N -X POST "http://localhost:8083/api/v1/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{
    "threadId": "multi-001",
    "userId": "qa-tester",
    "messages": [{"id": "1", "role": "user", "content": "My name is Alice."}]
  }'

# Turn 2 (include previous messages)
curl -N -X POST "http://localhost:8083/api/v1/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{
    "threadId": "multi-001",
    "userId": "qa-tester",
    "messages": [
      {"id": "1", "role": "user", "content": "My name is Alice."},
      {"id": "2", "role": "assistant", "content": "Nice to meet you, Alice!"},
      {"id": "3", "role": "user", "content": "What is my name?"}
    ]
  }'
```

### RAG Agent Test
```bash
curl -N -X POST "http://localhost:8083/api/v1/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{
    "threadId": "rag-001",
    "userId": "qa-tester",
    "agentType": "rag",
    "messages": [{"id": "1", "role": "user", "content": "What is in the documentation?"}]
  }'
```

### Multi-Agent Test
```bash
curl -N -X POST "http://localhost:8083/api/v1/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{
    "threadId": "multi-agent-001",
    "userId": "qa-tester",
    "agentType": "multi-agent",
    "messages": [{"id": "1", "role": "user", "content": "Research and summarize AI trends."}]
  }'
```

---

## Expected SSE Event Sequence

```
event: metadata
data: {"trace_id": "019xxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx", "citations": []}

event: agent_updated
data: {"answer": "NormalAgent", "content_type": "final_answer"}

event: data
data: {"answer": "Hello"}

event: data
data: {"answer": "! How"}

event: data
data: {"answer": " can I help?"}

event: done
data: {"answer": "Stream completed"}
```

---

## Validation Cheat Sheet

### Required Fields
| Field | Type | Required |
|-------|------|----------|
| threadId | string | Yes |
| userId | string | Yes |
| messages | array | Yes |
| messages[].id | string | Yes |
| messages[].role | string | Yes |
| messages[].content | string | Yes |

### Optional Fields
| Field | Type | Default | Valid Values |
|-------|------|---------|--------------|
| agentType | string | "normal" | normal, rag, multi-agent |
| conversationStyle | string | "balanced" | balanced, creative, precise |
| maxTokens | number | (model default) | 1-8192 |
| temperature | number | (model default) | 0-1 |
| systemPrompt | string | null | any string |

### Valid Roles
- `user` - User message
- `assistant` - AI response
- `system` - System instruction

---

## Error Testing

### Missing threadId
```bash
curl -X POST "http://localhost:8083/api/v1/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{"userId": "test", "messages": [{"id": "1", "role": "user", "content": "Hi"}]}'
```
Expected: 400 Bad Request

### Invalid Role
```bash
curl -X POST "http://localhost:8083/api/v1/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{"threadId": "t", "userId": "u", "messages": [{"id": "1", "role": "invalid", "content": "Hi"}]}'
```
Expected: 400 Bad Request

### Temperature Out of Range
```bash
curl -X POST "http://localhost:8083/api/v1/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{"threadId": "t", "userId": "u", "temperature": 5, "messages": [{"id": "1", "role": "user", "content": "Hi"}]}'
```
Expected: 400 Bad Request

---

## Stream Management

### Stop a Stream
```bash
curl -X POST "http://localhost:8083/api/v1/chat/stop" \
  -H "Content-Type: application/json" \
  -d '{"threadId": "test-001"}'
```

### Check Stream Health
```bash
curl "http://localhost:8083/api/v1/chat/health/test-001"
```

### Resume Stream
```bash
curl -N "http://localhost:8083/api/v1/chat/resume/test-001?afterIndex=0"
```

---

## Conversation Style Comparison

Test the same prompt with different styles:

```bash
# Creative
curl -N -X POST "http://localhost:8083/api/v1/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{"threadId": "style-c", "userId": "qa", "conversationStyle": "creative", "messages": [{"id": "1", "role": "user", "content": "Describe the ocean"}]}'

# Precise
curl -N -X POST "http://localhost:8083/api/v1/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{"threadId": "style-p", "userId": "qa", "conversationStyle": "precise", "messages": [{"id": "1", "role": "user", "content": "Describe the ocean"}]}'

# Balanced (default)
curl -N -X POST "http://localhost:8083/api/v1/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{"threadId": "style-b", "userId": "qa", "conversationStyle": "balanced", "messages": [{"id": "1", "role": "user", "content": "Describe the ocean"}]}'
```

**Expected**:
- Creative: More elaborate, figurative language
- Precise: Factual, concise
- Balanced: Middle ground

---

## UUID v7 Verification

The `trace_id` should be UUID v7 format:
- Format: `019xxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx`
- Starts with timestamp (e.g., "019")
- Version digit is "7" (4th section starts with 7)
- Time-sortable: Later traces have higher values

Example valid trace_id: `019ae6f9-9e31-7ddf-aef8-70ff1f286ee6`

---

## Common Issues & Solutions

| Issue | Possible Cause | Solution |
|-------|----------------|----------|
| 404 Resource not found | Wrong API endpoint or missing credentials | Verify `AZURE_OPENAI_API_INSTANCE_NAME` is correct. This project uses the **Responses API** (`/openai/responses`), not Chat Completions API |
| 404 Resource not found | Wrong API version | Ensure `AZURE_OPENAI_API_VERSION=2025-04-01-preview` or later |
| 404 Resource not found | Model deployment not found | Verify `AZURE_OPENAI_API_DEPLOYMENT_NAME` matches your Azure deployment |
| Connection refused | Server not running | Run `yarn start:dev` |
| 400 Bad Request | Invalid request body | Check required fields |
| Stream hangs | Long response | Wait or check network |
| Empty response | No messages array | Include messages |
| Config not updated | NestJS caches env at startup | Restart server after `.env` changes |

### Azure OpenAI Responses API Notes

This project uses the **Azure OpenAI Responses API** instead of the traditional Chat Completions API:

- **Endpoint**: `/openai/responses` (not `/openai/deployments/{model}/chat/completions`)
- **API Version**: `2025-04-01-preview` or later required
- **Streaming Events**: Look for `response.output_text.delta` events with `delta` field
- **Input Format**: Messages use `{ type: 'message', role: string, content: string }` format

---

## Performance Targets

| Metric | Target | Maximum |
|--------|--------|---------|
| Time to First Token | < 2s | 5s |
| Simple query total | < 10s | 30s |
| Complex query total | < 30s | 60s |
| Concurrent users | 50+ | - |

---

## Quick Bug Report Template

```
**Test Case**: TC-XXX
**Environment**: Local / Staging / Production
**Date/Time**:

**Steps to Reproduce**:
1.
2.
3.

**Request**:
```json
{paste request here}
```

**Expected Result**:

**Actual Result**:

**SSE Events Received**:
- [ ] metadata
- [ ] agent_updated
- [ ] data
- [ ] done
- [ ] error

**Screenshot/Recording**:

**Priority**: P0 / P1 / P2
```

---

## Testing Tools

### Postman
1. Import `postman-collection.json` from docs/testing/
2. Set `baseUrl` variable to `http://localhost:8083/api/v1`
3. Run collection

### Browser DevTools
1. Open Network tab
2. Send request via fetch
3. View EventStream in Preview tab

### Command Line
```bash
# With timing
time curl -N -X POST "http://localhost:8083/api/v1/chat/stream" ...

# Save to file
curl -N -X POST "http://localhost:8083/api/v1/chat/stream" ... > response.txt

# With verbose headers
curl -v -N -X POST "http://localhost:8083/api/v1/chat/stream" ...
```
