# Multi-Agent Architecture Implementation Guide

This guide provides a roadmap for evolving the current single-service architecture into a multi-agent system with parallel processing capabilities, based on best practices from production systems.

## Table of Contents

1. [Overview](#overview)
2. [Agent Architecture](#agent-architecture)
3. [Implementation Steps](#implementation-steps)
4. [Agent Definitions](#agent-definitions)
5. [Orchestration Patterns](#orchestration-patterns)
6. [Event Streaming](#event-streaming)
7. [Parallel Processing](#parallel-processing)
8. [Code Examples](#code-examples)
9. [Migration Path](#migration-path)

---

## Overview

### Current Architecture vs Multi-Agent

**Current (Single-Service):**
```
Request → Controller → Service → Azure APIs → Response
```

**Multi-Agent Architecture:**
```
Request → Controller → Orchestrator → [Agent1, Agent2, ...] → Aggregated Response
                                            ↓
                                    Parallel Execution
                                    Event Streaming
                                    Self-Correction
```

### Benefits of Multi-Agent Architecture

| Benefit | Description |
|---------|-------------|
| **Specialization** | Each agent handles a specific task optimally |
| **Parallelization** | Independent tasks run concurrently |
| **Resilience** | Failures in one agent don't crash the system |
| **Scalability** | Agents can be scaled independently |
| **Observability** | Fine-grained tracing per agent |
| **Flexibility** | Easy to add/remove agents for new capabilities |

---

## Agent Architecture

### Proposed Agent Structure

```
src/
├── agents/
│   ├── base/
│   │   ├── base.agent.ts              # Abstract base class
│   │   ├── agent.interface.ts         # Agent contracts
│   │   └── agent.factory.ts           # Agent instantiation
│   │
│   ├── document-analyzer/
│   │   ├── document-analyzer.agent.ts # Azure Doc Intel wrapper
│   │   └── document-analyzer.prompts.ts
│   │
│   ├── data-extractor/
│   │   ├── data-extractor.agent.ts    # LLM-based extraction
│   │   └── data-extractor.prompts.ts
│   │
│   ├── validator/
│   │   ├── validator.agent.ts         # Schema validation
│   │   └── validation.rules.ts
│   │
│   ├── formatter/
│   │   ├── formatter.agent.ts         # Output formatting
│   │   └── format.templates.ts
│   │
│   ├── search/
│   │   ├── query-planner.agent.ts     # Query decomposition
│   │   ├── retriever.agent.ts         # Document retrieval
│   │   └── ranker.agent.ts            # Result ranking
│   │
│   └── orchestrator/
│       ├── orchestrator.service.ts    # Agent coordination
│       ├── orchestrator.module.ts
│       └── modes/
│           ├── extraction.mode.ts     # Document extraction flow
│           ├── search.mode.ts         # Search flow
│           └── qa.mode.ts             # Question-answering flow
```

### Agent Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                      Agent Lifecycle                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐ │
│   │  INIT    │───▶│  READY   │───▶│ RUNNING  │───▶│COMPLETED │ │
│   └──────────┘    └──────────┘    └────┬─────┘    └──────────┘ │
│                                        │                        │
│                                        ▼                        │
│                                   ┌──────────┐                  │
│                                   │  ERROR   │                  │
│                                   └────┬─────┘                  │
│                                        │                        │
│                                        ▼                        │
│                                   ┌──────────┐                  │
│                                   │  RETRY   │──────────────────│
│                                   └──────────┘                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Steps

### Phase 1: Base Infrastructure

1. **Create Agent Base Classes**
   - `IAgent` interface
   - `BaseAgent` abstract class
   - `AgentState` type definitions
   - `AgentResult` type definitions

2. **Implement Event Streaming**
   - `EventType` enum
   - `EventStreamOutput` class
   - SSE service for streaming responses

3. **Set Up Observability**
   - Langfuse integration for tracing
   - Structured logging with request context
   - Metrics collection

### Phase 2: Core Agents

1. **DocumentAnalyzerAgent**
   - Wraps existing `DocumentAnalysisService`
   - Adds observability hooks
   - Implements streaming output

2. **DataExtractorAgent**
   - Wraps existing `CompletionService`
   - Adds prompt management
   - Implements structured output parsing

3. **ValidatorAgent**
   - JSON schema validation
   - Business rule validation
   - Error correction suggestions

### Phase 3: Orchestration

1. **ExtractionMode**
   - Sequential: Analyze → Extract → Validate → Format
   - Handles agent handoffs
   - Manages shared state

2. **SearchMode**
   - Parallel: Query planning + Retrieval
   - Result aggregation and ranking

### Phase 4: Advanced Features

1. **Parallel Execution**
   - Worker-based sharding for batch processing
   - BullMQ for background jobs
   - Rate limiting and backoff

2. **Self-Correction**
   - Retry loops with debug agents
   - Automatic error recovery
   - Fallback strategies

---

## Agent Definitions

### Base Agent Interface

```typescript
// src/agents/base/agent.interface.ts

export interface AgentConfig {
  name: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  retries?: number;
}

export interface AgentState {
  traceId: string;
  sessionId: string;
  input: any;
  context: Record<string, any>;
  history: AgentHistoryEntry[];
}

export interface AgentHistoryEntry {
  agent: string;
  timestamp: Date;
  input: any;
  output: any;
  duration: number;
}

export interface AgentResult<T = any> {
  success: boolean;
  output?: T;
  error?: string;
  metadata?: {
    duration: number;
    tokensUsed?: number;
    model?: string;
  };
}

export interface IAgent<TInput = any, TOutput = any> {
  readonly name: string;
  readonly config: AgentConfig;

  run(state: AgentState, input: TInput): Promise<AgentResult<TOutput>>;
  runStream?(state: AgentState, input: TInput): AsyncGenerator<EventStreamOutput>;
  validate?(input: TInput): boolean;
}
```

### Base Agent Implementation

```typescript
// src/agents/base/base.agent.ts

import { Injectable, Logger } from '@nestjs/common';
import { IAgent, AgentConfig, AgentState, AgentResult } from './agent.interface';
import { LangfuseService } from '../../core/observability/langfuse.service';
import { EventStreamOutput, EventType } from '../../core/events/event-types';

@Injectable()
export abstract class BaseAgent<TInput = any, TOutput = any>
  implements IAgent<TInput, TOutput> {

  protected readonly logger = new Logger(this.constructor.name);

  abstract readonly name: string;
  abstract readonly config: AgentConfig;

  constructor(protected readonly langfuse?: LangfuseService) {}

  abstract run(state: AgentState, input: TInput): Promise<AgentResult<TOutput>>;

  async *runStream(
    state: AgentState,
    input: TInput
  ): AsyncGenerator<EventStreamOutput> {
    // Default: run non-streaming and yield final result
    yield {
      event: EventType.AGENT_UPDATED,
      data: { agent: this.name, status: 'started' },
    };

    const startTime = Date.now();
    const result = await this.run(state, input);
    const duration = Date.now() - startTime;

    if (result.success) {
      yield {
        event: EventType.DATA,
        data: {
          content: result.output,
          agent: this.name,
          duration,
        },
      };
    } else {
      yield {
        event: EventType.ERROR,
        data: {
          error: result.error,
          agent: this.name,
        },
      };
    }

    yield {
      event: EventType.AGENT_UPDATED,
      data: { agent: this.name, status: 'completed', duration },
    };
  }

  protected createSpan(state: AgentState) {
    if (!this.langfuse) return null;

    return this.langfuse.createGeneration({
      traceId: state.traceId,
      name: this.name,
      model: this.config.model,
      modelParameters: {
        temperature: this.config.temperature,
        maxTokens: this.config.maxTokens,
      },
    });
  }

  protected async withRetry<T>(
    fn: () => Promise<T>,
    retries = this.config.retries ?? 3
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `${this.name} attempt ${attempt}/${retries} failed: ${error.message}`
        );

        if (attempt < retries) {
          await this.sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }

    throw lastError;
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

---

## Orchestration Patterns

### Pattern 1: Sequential Chain

Agents execute one after another, passing state.

```typescript
// src/agents/orchestrator/modes/extraction.mode.ts

@Injectable()
export class ExtractionMode {
  constructor(
    private readonly documentAnalyzer: DocumentAnalyzerAgent,
    private readonly dataExtractor: DataExtractorAgent,
    private readonly validator: ValidatorAgent,
    private readonly formatter: FormatterAgent,
  ) {}

  async *run(file: Buffer, options: ExtractionOptions): AsyncGenerator<EventStreamOutput> {
    const state: AgentState = {
      traceId: generateTraceId(),
      sessionId: options.sessionId,
      input: { file },
      context: {},
      history: [],
    };

    // Step 1: Analyze document
    yield* this.emitAgentStart('document-analyzer');
    const analysisResult = await this.documentAnalyzer.run(state, { file });
    state.context.analysis = analysisResult.output;
    yield* this.emitAgentOutput(analysisResult);

    if (!analysisResult.success) {
      yield* this.emitError('Document analysis failed');
      return;
    }

    // Step 2: Extract structured data
    yield* this.emitAgentStart('data-extractor');
    const extractionResult = await this.dataExtractor.run(state, {
      text: analysisResult.output.text,
      schema: options.schema,
    });
    state.context.extracted = extractionResult.output;
    yield* this.emitAgentOutput(extractionResult);

    // Step 3: Validate extracted data
    yield* this.emitAgentStart('validator');
    const validationResult = await this.validator.run(state, {
      data: extractionResult.output,
      rules: options.validationRules,
    });

    if (!validationResult.success) {
      // Retry extraction with validation feedback
      yield* this.emitAgentStart('data-extractor');
      const retryResult = await this.dataExtractor.run(state, {
        text: analysisResult.output.text,
        schema: options.schema,
        feedback: validationResult.output.errors,
      });
      state.context.extracted = retryResult.output;
    }

    // Step 4: Format output
    yield* this.emitAgentStart('formatter');
    const formattedResult = await this.formatter.run(state, {
      data: state.context.extracted,
      format: options.outputFormat,
    });

    yield {
      event: EventType.DONE,
      data: {
        result: formattedResult.output,
        traceId: state.traceId,
      },
    };
  }
}
```

### Pattern 2: Parallel Execution

Multiple agents run simultaneously for independent tasks.

```typescript
// src/agents/orchestrator/modes/parallel-extraction.mode.ts

@Injectable()
export class ParallelExtractionMode {
  constructor(
    private readonly textExtractor: TextExtractorAgent,
    private readonly tableExtractor: TableExtractorAgent,
    private readonly imageAnalyzer: ImageAnalyzerAgent,
    private readonly aggregator: AggregatorAgent,
  ) {}

  async *run(file: Buffer): AsyncGenerator<EventStreamOutput> {
    const state = this.createState();

    // Run extractors in parallel
    yield { event: EventType.METADATA, data: { phase: 'parallel-extraction' } };

    const [textResult, tableResult, imageResult] = await Promise.all([
      this.textExtractor.run(state, { file }),
      this.tableExtractor.run(state, { file }),
      this.imageAnalyzer.run(state, { file }),
    ]);

    yield* this.emitParallelResults([textResult, tableResult, imageResult]);

    // Aggregate results
    yield* this.emitAgentStart('aggregator');
    const aggregatedResult = await this.aggregator.run(state, {
      text: textResult.output,
      tables: tableResult.output,
      images: imageResult.output,
    });

    yield {
      event: EventType.DONE,
      data: { result: aggregatedResult.output },
    };
  }
}
```

### Pattern 3: Conditional Routing (Handoff)

Agents decide which agent to invoke next.

```typescript
// src/agents/orchestrator/modes/smart-extraction.mode.ts

@Injectable()
export class SmartExtractionMode {
  constructor(
    private readonly coordinator: CoordinatorAgent,
    private readonly simpleExtractor: SimpleExtractorAgent,
    private readonly complexExtractor: ComplexExtractorAgent,
    private readonly tableExtractor: TableExtractorAgent,
  ) {}

  async *run(file: Buffer): AsyncGenerator<EventStreamOutput> {
    const state = this.createState();

    // Coordinator analyzes document and decides routing
    const decision = await this.coordinator.run(state, { file });

    // Route based on coordinator decision
    switch (decision.output.route) {
      case 'simple':
        yield* this.simpleExtractor.runStream(state, { file });
        break;

      case 'complex':
        yield* this.complexExtractor.runStream(state, { file });
        break;

      case 'table-heavy':
        yield* this.tableExtractor.runStream(state, { file });
        break;

      default:
        // Fallback to complex extractor
        yield* this.complexExtractor.runStream(state, { file });
    }
  }
}
```

### Pattern 4: Retry Loop with Self-Correction

```typescript
// src/agents/orchestrator/modes/self-correcting.mode.ts

const MAX_RETRIES = 3;

@Injectable()
export class SelfCorrectingMode {
  async *run(input: ExtractionInput): AsyncGenerator<EventStreamOutput> {
    const state = this.createState();
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      yield {
        event: EventType.METADATA,
        data: { attempt, maxAttempts: MAX_RETRIES }
      };

      // Extract with optional error context
      const extractionResult = await this.dataExtractor.run(state, {
        ...input,
        previousError: lastError,
      });

      if (!extractionResult.success) {
        lastError = extractionResult.error;
        continue;
      }

      // Validate
      const validationResult = await this.validator.run(state, {
        data: extractionResult.output,
      });

      if (validationResult.success) {
        yield {
          event: EventType.DONE,
          data: {
            result: extractionResult.output,
            attempts: attempt,
          },
        };
        return;
      }

      // Use debug agent to analyze failure
      const debugResult = await this.debugAgent.run(state, {
        extraction: extractionResult.output,
        validationErrors: validationResult.output.errors,
      });

      lastError = debugResult.output.suggestion;
    }

    yield {
      event: EventType.ERROR,
      data: { error: `Failed after ${MAX_RETRIES} attempts`, lastError },
    };
  }
}
```

---

## Event Streaming

### Event Types

```typescript
// src/core/events/event-types.ts

export enum EventType {
  // Lifecycle events
  METADATA = 'metadata',
  AGENT_UPDATED = 'agent_updated',
  DONE = 'done',
  ERROR = 'error',

  // Data events
  DATA = 'data',
  CHUNK = 'chunk',           // Streaming text chunks
  PROGRESS = 'progress',     // Progress updates

  // Debug events
  DEBUG = 'debug',
  TRACE = 'trace',
}

export interface EventData {
  // Common fields
  traceId?: string;
  timestamp?: string;

  // Agent fields
  agent?: string;
  status?: 'started' | 'running' | 'completed' | 'failed';
  duration?: number;

  // Content fields
  content?: any;
  chunk?: string;
  progress?: number;

  // Error fields
  error?: string;
  errorCode?: string;
}

export interface EventStreamOutput {
  event: EventType;
  data: EventData;
}
```

### SSE Controller

```typescript
// src/api/controllers/extraction.controller.ts

import { Controller, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ExtractionMode } from '../../agents/orchestrator/modes/extraction.mode';

@Controller('extraction')
export class ExtractionController {
  constructor(private readonly extractionMode: ExtractionMode) {}

  @Post('stream')
  @UseInterceptors(FileInterceptor('file'))
  async streamExtraction(
    @UploadedFile() file: Express.Multer.File,
    @Res() res: Response,
  ): Promise<void> {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      for await (const event of this.extractionMode.run(file.buffer, {})) {
        const eventString = `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
        res.write(eventString);
      }
    } catch (error) {
      const errorEvent = `event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`;
      res.write(errorEvent);
    } finally {
      res.end();
    }
  }
}
```

### Client-Side SSE Handling

```typescript
// Example: Frontend SSE client

class ExtractionClient {
  async extractWithStreaming(file: File): Promise<ExtractionResult> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/v1/extraction/stream', {
      method: 'POST',
      body: formData,
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          const [eventLine, dataLine] = line.split('\n');
          const event = eventLine.replace('event: ', '');
          const data = JSON.parse(dataLine.replace('data: ', ''));

          this.handleEvent(event, data);
        }
      }
    }
  }

  private handleEvent(event: string, data: any): void {
    switch (event) {
      case 'agent_updated':
        console.log(`Agent ${data.agent}: ${data.status}`);
        break;
      case 'data':
        console.log('Received data:', data.content);
        break;
      case 'progress':
        console.log(`Progress: ${data.progress}%`);
        break;
      case 'done':
        console.log('Extraction complete:', data.result);
        break;
      case 'error':
        console.error('Error:', data.error);
        break;
    }
  }
}
```

---

## Parallel Processing

### Worker-Based Sharding

For processing large document batches across multiple workers.

```typescript
// src/queues/processors/document.processor.ts

import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { ConfigService } from '@nestjs/config';

@Processor('document-processing')
export class DocumentProcessor {
  private readonly shardIndex: number;
  private readonly totalWorkers: number;

  constructor(private readonly configService: ConfigService) {
    this.shardIndex = this.configService.get<number>('SHARD_INDEX', 0);
    this.totalWorkers = this.configService.get<number>('TOTAL_WORKERS', 1);
  }

  @Process('batch-extract')
  async handleBatchExtraction(job: Job<{ documentIds: string[] }>) {
    const { documentIds } = job.data;

    // Filter documents for this worker using modulo sharding
    const myDocuments = documentIds.filter((id) => {
      const hash = this.hashString(id);
      return hash % this.totalWorkers === this.shardIndex;
    });

    let processed = 0;
    for (const docId of myDocuments) {
      await this.processDocument(docId);
      processed++;
      await job.progress((processed / myDocuments.length) * 100);
    }

    return { processed, total: myDocuments.length };
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  private async processDocument(docId: string): Promise<void> {
    // Document processing logic
  }
}
```

### Queue Configuration

```typescript
// src/queues/queues.module.ts

import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { DocumentProcessor } from './processors/document.processor';

@Module({
  imports: [
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    BullModule.registerQueue(
      { name: 'document-processing' },
      { name: 'embedding-generation' },
      { name: 'index-update' },
    ),
  ],
  providers: [DocumentProcessor],
  exports: [BullModule],
})
export class QueuesModule {}
```

### Batch Processing Service

```typescript
// src/services/batch/batch-extraction.service.ts

import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Injectable()
export class BatchExtractionService {
  constructor(
    @InjectQueue('document-processing')
    private readonly documentQueue: Queue,
  ) {}

  async scheduleBatchExtraction(documentIds: string[]): Promise<string> {
    const job = await this.documentQueue.add(
      'batch-extract',
      { documentIds },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );

    return job.id.toString();
  }

  async getJobStatus(jobId: string): Promise<JobStatus> {
    const job = await this.documentQueue.getJob(jobId);

    if (!job) {
      return { status: 'not_found' };
    }

    const state = await job.getState();
    const progress = job.progress();

    return {
      status: state,
      progress: typeof progress === 'number' ? progress : 0,
      result: job.returnvalue,
      failedReason: job.failedReason,
    };
  }
}
```

---

## Code Examples

### Complete Agent Implementation

```typescript
// src/agents/data-extractor/data-extractor.agent.ts

import { Injectable } from '@nestjs/common';
import { BaseAgent } from '../base/base.agent';
import { AgentConfig, AgentState, AgentResult } from '../base/agent.interface';
import { LlmService } from '../../services/llm/llm.service';
import { LangfuseService } from '../../core/observability/langfuse.service';
import { EXTRACTION_PROMPT } from './data-extractor.prompts';

interface ExtractionInput {
  text: string;
  schema?: object;
  feedback?: string[];
}

interface ExtractionOutput {
  data: any;
  confidence: number;
}

@Injectable()
export class DataExtractorAgent extends BaseAgent<ExtractionInput, ExtractionOutput> {
  readonly name = 'DataExtractorAgent';
  readonly config: AgentConfig = {
    name: 'Data Extractor',
    model: 'gpt-4o',
    temperature: 0.1,
    maxTokens: 4096,
    retries: 2,
  };

  constructor(
    private readonly llmService: LlmService,
    langfuse: LangfuseService,
  ) {
    super(langfuse);
  }

  async run(
    state: AgentState,
    input: ExtractionInput,
  ): Promise<AgentResult<ExtractionOutput>> {
    const span = this.createSpan(state);
    const startTime = Date.now();

    try {
      const prompt = this.buildPrompt(input);

      const response = await this.withRetry(async () => {
        return this.llmService.complete({
          model: this.config.model,
          messages: [
            { role: 'system', content: EXTRACTION_PROMPT },
            { role: 'user', content: prompt },
          ],
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
          response_format: { type: 'json_object' },
        });
      });

      const parsed = JSON.parse(response.content);
      const duration = Date.now() - startTime;

      span?.end({
        output: parsed,
        usage: response.usage,
      });

      return {
        success: true,
        output: {
          data: parsed.data,
          confidence: parsed.confidence ?? 1.0,
        },
        metadata: {
          duration,
          tokensUsed: response.usage?.totalTokens,
          model: this.config.model,
        },
      };
    } catch (error) {
      span?.end({ error: error.message });

      return {
        success: false,
        error: error.message,
        metadata: {
          duration: Date.now() - startTime,
        },
      };
    }
  }

  private buildPrompt(input: ExtractionInput): string {
    let prompt = `Extract structured data from the following text:\n\n${input.text}`;

    if (input.schema) {
      prompt += `\n\nExpected schema:\n${JSON.stringify(input.schema, null, 2)}`;
    }

    if (input.feedback?.length) {
      prompt += `\n\nPrevious extraction had these issues:\n${input.feedback.join('\n')}`;
      prompt += '\n\nPlease correct these issues in your extraction.';
    }

    return prompt;
  }
}
```

### Orchestrator Service

```typescript
// src/agents/orchestrator/orchestrator.service.ts

import { Injectable } from '@nestjs/common';
import { ExtractionMode } from './modes/extraction.mode';
import { SearchMode } from './modes/search.mode';
import { EventStreamOutput } from '../../core/events/event-types';

@Injectable()
export class OrchestratorService {
  constructor(
    private readonly extractionMode: ExtractionMode,
    private readonly searchMode: SearchMode,
  ) {}

  async *runExtraction(
    file: Buffer,
    options: ExtractionOptions,
  ): AsyncGenerator<EventStreamOutput> {
    yield* this.extractionMode.run(file, options);
  }

  async *runSearch(
    query: string,
    options: SearchOptions,
  ): AsyncGenerator<EventStreamOutput> {
    yield* this.searchMode.run(query, options);
  }

  async *runQA(
    question: string,
    context: QAContext,
  ): AsyncGenerator<EventStreamOutput> {
    // First search for relevant documents
    const searchResults = [];
    for await (const event of this.searchMode.run(question, {})) {
      if (event.event === 'done') {
        searchResults.push(...event.data.results);
      }
      yield event;
    }

    // Then use extraction to answer the question
    yield* this.extractionMode.runQA(question, searchResults);
  }
}
```

---

## Migration Path

### Step 1: Add Base Infrastructure (Week 1)

1. Create `src/agents/base/` directory
2. Implement `agent.interface.ts`
3. Implement `base.agent.ts`
4. Add `src/core/events/` for event streaming
5. Set up Langfuse for observability

### Step 2: Wrap Existing Services (Week 2)

1. Create `DocumentAnalyzerAgent` wrapping `DocumentAnalysisService`
2. Create `DataExtractorAgent` wrapping `CompletionService`
3. Add observability to wrapped agents
4. Write unit tests for agents

### Step 3: Implement Orchestration (Week 3)

1. Create `src/agents/orchestrator/` directory
2. Implement `ExtractionMode`
3. Add SSE streaming controller
4. Integration tests for full flow

### Step 4: Add Advanced Features (Week 4+)

1. Implement parallel extraction mode
2. Add BullMQ for background processing
3. Implement self-correction with retry loops
4. Add worker sharding for batch processing

### Checklist

- [ ] Base agent interface and abstract class
- [ ] Event types and streaming infrastructure
- [ ] DocumentAnalyzerAgent implementation
- [ ] DataExtractorAgent implementation
- [ ] ValidatorAgent implementation
- [ ] FormatterAgent implementation
- [ ] ExtractionMode orchestrator
- [ ] SSE streaming controller
- [ ] Langfuse observability integration
- [ ] BullMQ queue setup
- [ ] Worker sharding for batch processing
- [ ] Unit tests for all agents
- [ ] Integration tests for orchestration modes
- [ ] Documentation updates

---

## References

- [sensei-server Architecture](../MULTI_AGENT_ARCHITECTURE_GUIDE.md) - Production patterns from sensei-server
- [NestJS Documentation](https://docs.nestjs.com/)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [Langfuse Documentation](https://langfuse.com/docs)
- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)
