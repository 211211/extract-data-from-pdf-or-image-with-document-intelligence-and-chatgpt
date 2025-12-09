# Testing Documentation

This folder contains comprehensive testing documentation for the Multi-Turn LLM Chat Application.

## Documents

| Document | Description | Audience |
|----------|-------------|----------|
| [TESTING_GUIDE.md](./TESTING_GUIDE.md) | Complete testing guide with all scenarios | QA Engineers, Developers |
| [TEST_SCENARIOS.md](./TEST_SCENARIOS.md) | Detailed test cases with steps and criteria | QA Engineers |
| [ACCEPTANCE_CRITERIA.md](./ACCEPTANCE_CRITERIA.md) | Release acceptance checklist | Product Owners, QA Leads |
| [QA_QUICK_REFERENCE.md](./QA_QUICK_REFERENCE.md) | Quick reference commands and cheat sheet | QA Engineers |
| [postman-collection.json](./postman-collection.json) | Importable Postman collection | QA Engineers, Developers |

## Quick Start

1. **Start the server**:
   ```bash
   yarn start:dev
   ```

2. **Run a quick sanity test**:
   ```bash
   curl http://localhost:8083/api/v1/chat/agents
   ```

3. **Import Postman collection**:
   - Open Postman
   - Import `postman-collection.json`
   - Set `baseUrl` to `http://localhost:8083/api/v1`

## Test Categories

### 1. Functional Tests
- Basic chat functionality
- Multi-turn conversation context
- Agent selection and routing
- Stream management (stop/resume)

### 2. API Contract Tests
- Request validation
- Response format
- Error handling
- SSE protocol compliance

### 3. Performance Tests
- Time to First Token (TTFT)
- Total response time
- Concurrent user handling
- Load testing

### 4. Security Tests
- Input validation
- Injection prevention
- Data isolation

## Priority Levels

| Priority | Description | Example |
|----------|-------------|---------|
| P0 | Critical - Must work | Basic chat streaming |
| P1 | High - Core functionality | Multi-turn context |
| P2 | Medium - Important features | Conversation styles |
| P3 | Low - Nice to have | Advanced parameters |

## Test Execution

### Manual Testing
Use the commands in [QA_QUICK_REFERENCE.md](./QA_QUICK_REFERENCE.md) for manual testing.

### Postman Testing
1. Import the collection
2. Run individual requests or the entire collection
3. View results in the Postman console

### Automated Testing (Future)
```bash
# Run unit tests
yarn test

# Run e2e tests
yarn test:e2e
```

## Reporting Issues

When reporting issues, include:
- Test case ID (if applicable)
- Steps to reproduce
- Request payload
- Expected vs actual result
- SSE events received
- Screenshots/recordings

## Contact

For questions about testing:
- QA Lead: [Name]
- Tech Lead: [Name]
- Product Owner: [Name]
