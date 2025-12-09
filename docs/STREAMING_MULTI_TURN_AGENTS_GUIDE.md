# Streaming Multi-Turn Agents Architecture Guide

> A comprehensive implementation guide for building high-end streaming multi-turn AI agent systems, based on production patterns from MODEC Sensei (FE: Next.js) and Sensei-Server (BE: FastAPI + LangChain).

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [SSE Protocol Specification](#2-sse-protocol-specification)
3. [Backend Implementation (NestJS)](#3-backend-implementation-nestjs)
4. [Frontend Implementation](#4-frontend-implementation)
5. [Multi-Agent Orchestration](#5-multi-agent-orchestration)
6. [Chat History & Multi-Turn Context](#6-chat-history--multi-turn-context)
7. [Stream Resumption & Fault Tolerance](#7-stream-resumption--fault-tolerance)
8. [Testing Strategy](#8-testing-strategy)
9. [Production Checklist](#9-production-checklist)

---

## 1. Architecture Overview

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (Browser)                                │
│  ┌─────────────┐    ┌──────────────────┐    ┌─────────────────────────────┐ │
│  │ ChatContext │───▶│ fetch() + Reader │───▶│ SSE Parser (manual)         │ │
│  │ (React)     │◀───│ ReadableStream   │◀───│ event: data, agent_updated  │ │
│  └─────────────┘    └──────────────────┘    └─────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ POST /api/chat (JSON)
                                    │ Response: text/event-stream
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           API GATEWAY (NestJS/Next.js)                       │
│  ┌─────────────────┐    ┌──────────────────┐    ┌───────────────────────┐   │
│  │ Auth Middleware │───▶│ Chat Controller  │───▶│ SSE Stream Factory    │   │
│  │ (JWT/Session)   │    │ (Route Handler)  │    │ createSSEStream()     │   │
│  └─────────────────┘    └──────────────────┘    └───────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ SSE (Upstream)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AGENT SERVER (FastAPI + LangChain)                   │
│  ┌─────────────────┐    ┌──────────────────┐    ┌───────────────────────┐   │
│  │ Agent Factory   │───▶│ ChatInterface    │───▶│ AsyncGenerator        │   │
│  │ (get_*_agent)   │    │ process_stream() │    │ yield SSE events      │   │
│  └─────────────────┘    └──────────────────┘    └───────────────────────┘   │
│           │                      │                         │                 │
│           ▼                      ▼                         ▼                 │
│  ┌─────────────────┐    ┌──────────────────┐    ┌───────────────────────┐   │
│  │ Azure OpenAI    │    │ Langfuse Trace   │    │ Vector Store (Search) │   │
│  └─────────────────┘    └──────────────────┘    └───────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Design Principles

1. **Independent Abort Controllers**: Browser disconnect ≠ upstream abort
2. **Event-Driven Streaming**: SSE with typed events (metadata, data, agent_updated, done)
3. **Optimistic UI**: Client renders immediately, reconciles with server state
4. **Resumable Streams**: Redis/memory store for reconnection support
5. **Multi-Agent Composition**: Sequential and conditional agent chaining

---

## 2. SSE Protocol Specification

### Event Types

| Event | Purpose | Payload Example |
|-------|---------|-----------------|
| `metadata` | Trace IDs, citations, filter hints | `{"trace_id": "xxx", "citations": [...]}` |
| `agent_updated` | Agent status changes | `{"answer": "AgentName", "content_type": "thoughts"}` |
| `data` | Streaming content chunks | `{"answer": "partial response..."}` |
| `done` | Stream completion | `{"message_id": "cosmos-id", "stream_id": "xxx"}` |
| `error` | Error information | `{"error": "message", "code": "ERROR_CODE"}` |

### Wire Format (RFC 6202 Compliant)

```
event: metadata
data: {"trace_id":"trace-123","citations":[]}

event: agent_updated
data: {"answer":"PlannerAgent","content_type":"thoughts"}

event: data
data: {"answer":"Here is the first chunk"}

event: data
data: {"answer":" of the response..."}

event: done
data: {"message_id":"msg-456","stream_id":"stream-789"}

```

### TypeScript Interfaces

```typescript
// src/core/streaming/types.ts

export type SSEEventType = 'metadata' | 'agent_updated' | 'data' | 'done' | 'error';

export interface SSEEvent<T = unknown> {
  event: SSEEventType;
  data: T;
}

export interface MetadataPayload {
  trace_id: string;
  citations?: Citation[];
  filter_hint?: FilterHint;
  run_id?: string;      // For async jobs
  thread_id?: string;   // For async jobs
}

export interface AgentUpdatedPayload {
  answer: string;       // Agent name or status
  content_type: 'thoughts' | 'final_answer';
  job_description?: string;
}

export interface DataPayload {
  answer: string;       // Content chunk
}

export interface DonePayload {
  message_id?: string;  // Persisted message ID
  stream_id?: string;   // Stream store ID
  answer?: string;      // Final status message
}

export interface ErrorPayload {
  error: string;
  code?: string;
  details?: unknown;
}
```

---

## 3. Backend Implementation (NestJS)

### Step 3.1: Project Structure

```
src/
├── core/
│   └── streaming/
│       ├── types.ts              # SSE type definitions
│       ├── sse.service.ts        # SSE formatting utilities
│       ├── stream-store.ts       # Redis/memory stream storage
│       └── stream-store.interface.ts
├── agents/
│   ├── agent.interface.ts        # Base agent contract
│   ├── agent.factory.ts          # Agent factory
│   ├── normal/
│   │   └── normal.agent.ts
│   ├── rag/
│   │   └── rag.agent.ts
│   └── orchestrator/
│       └── multi-agent.orchestrator.ts
├── chat/
│   ├── chat.module.ts
│   ├── chat.controller.ts
│   ├── chat.service.ts
│   ├── dto/
│   │   ├── chat-request.dto.ts
│   │   └── chat-message.dto.ts
│   └── interfaces/
│       └── chat-thread.interface.ts
└── main.ts
```

### Step 3.2: SSE Service

```typescript
// src/core/streaming/sse.service.ts

import { Injectable } from '@nestjs/common';
import { Response } from 'express';
import { SSEEvent, SSEEventType } from './types';

@Injectable()
export class SSEService {
  /**
   * Format an SSE event according to RFC 6202
   * Handles multiline data by prefixing each line with "data: "
   */
  formatSSE<T>(event: SSEEventType, data: T): string {
    const jsonData = JSON.stringify(data);
    const lines = jsonData.split('\n');
    const formattedData = lines.map(line => `data: ${line}`).join('\n');
    return `event: ${event}\n${formattedData}\n\n`;
  }

  /**
   * Initialize SSE response headers
   */
  initSSEHeaders(res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();
  }

  /**
   * Create an async generator that yields SSE-formatted strings
   */
  async *createSSEStream<T>(
    source: AsyncIterable<SSEEvent<T>>,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    try {
      for await (const event of source) {
        if (signal?.aborted) break;
        yield this.formatSSE(event.event, event.data);
      }
    } finally {
      // Cleanup logic here
    }
  }
}
```

### Step 3.3: Stream Store (for Resumption)

```typescript
// src/core/streaming/stream-store.interface.ts

export interface StreamSession {
  threadId: string;
  streamId: string;
  chunks: StreamChunk[];
  isDone: boolean;
  createdAt: Date;
}

export interface StreamChunk {
  agent: string;
  content: string;
  contentType: 'thoughts' | 'final_answer';
  timestamp: Date;
}

export interface IStreamStore {
  initSession(threadId: string): Promise<string>; // returns streamId
  appendChunk(threadId: string, chunk: StreamChunk): Promise<void>;
  markDone(threadId: string): Promise<void>;
  getSession(threadId: string): Promise<StreamSession | null>;
  cleanup(threadId: string): Promise<void>;
}
```

```typescript
// src/core/streaming/stream-store.ts

import { Injectable } from '@nestjs/common';
import { IStreamStore, StreamSession, StreamChunk } from './stream-store.interface';
import { nanoid } from 'nanoid';

@Injectable()
export class InMemoryStreamStore implements IStreamStore {
  private sessions = new Map<string, StreamSession>();
  private ttlTimers = new Map<string, NodeJS.Timeout>();
  private readonly TTL_MS = 3600000; // 1 hour

  async initSession(threadId: string): Promise<string> {
    const streamId = nanoid();
    const session: StreamSession = {
      threadId,
      streamId,
      chunks: [],
      isDone: false,
      createdAt: new Date(),
    };
    this.sessions.set(threadId, session);
    this.scheduleTTL(threadId);
    return streamId;
  }

  async appendChunk(threadId: string, chunk: StreamChunk): Promise<void> {
    const session = this.sessions.get(threadId);
    if (!session) return;

    // Merge consecutive chunks from same agent
    const lastChunk = session.chunks[session.chunks.length - 1];
    if (lastChunk?.agent === chunk.agent && lastChunk?.contentType === chunk.contentType) {
      lastChunk.content += chunk.content;
    } else {
      session.chunks.push(chunk);
    }
  }

  async markDone(threadId: string): Promise<void> {
    const session = this.sessions.get(threadId);
    if (session) {
      session.isDone = true;
    }
  }

  async getSession(threadId: string): Promise<StreamSession | null> {
    return this.sessions.get(threadId) || null;
  }

  async cleanup(threadId: string): Promise<void> {
    this.sessions.delete(threadId);
    const timer = this.ttlTimers.get(threadId);
    if (timer) {
      clearTimeout(timer);
      this.ttlTimers.delete(threadId);
    }
  }

  private scheduleTTL(threadId: string): void {
    const timer = setTimeout(() => {
      this.cleanup(threadId);
    }, this.TTL_MS);
    timer.unref(); // Don't prevent process exit
    this.ttlTimers.set(threadId, timer);
  }
}
```

### Step 3.4: Agent Interface & Factory

```typescript
// src/agents/agent.interface.ts

import { SSEEvent } from '../core/streaming/types';

export interface AgentContext {
  traceId: string;
  userId: string;
  sessionId: string;
  messageHistory: ChatMessage[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
}

export interface IAgent {
  name: string;
  run(context: AgentContext): AsyncGenerator<SSEEvent>;
}
```

```typescript
// src/agents/agent.factory.ts

import { Injectable } from '@nestjs/common';
import { IAgent } from './agent.interface';
import { NormalAgent } from './normal/normal.agent';
import { RAGAgent } from './rag/rag.agent';
import { MultiAgentOrchestrator } from './orchestrator/multi-agent.orchestrator';

export type AgentType = 'normal' | 'rag' | 'multi-agent';

@Injectable()
export class AgentFactory {
  constructor(
    private readonly normalAgent: NormalAgent,
    private readonly ragAgent: RAGAgent,
    private readonly multiAgentOrchestrator: MultiAgentOrchestrator,
  ) {}

  getAgent(type: AgentType): IAgent {
    const agents: Record<AgentType, IAgent> = {
      'normal': this.normalAgent,
      'rag': this.ragAgent,
      'multi-agent': this.multiAgentOrchestrator,
    };

    const agent = agents[type];
    if (!agent) {
      throw new Error(`Unknown agent type: ${type}`);
    }
    return agent;
  }
}
```

### Step 3.5: Normal Agent Implementation

> **Note:** This project uses the Azure OpenAI **Responses API** (`/openai/responses`) instead of the traditional Chat Completions API. The Responses API requires API version `2025-04-01-preview` or later.

```typescript
// src/agents/normal/normal.agent.ts

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IAgent, AgentContext } from '../agent.interface';
import { SSEEvent, MetadataPayload, AgentUpdatedPayload, DataPayload, DonePayload } from '../../core/streaming/types';

interface ResponseInputMessage {
  type: 'message';
  role: 'system' | 'user' | 'assistant';
  content: string;
}

@Injectable()
export class NormalAgent implements IAgent {
  name = 'NormalAgent';
  private baseUrl: string;
  private apiKey: string;
  private apiVersion: string;
  private modelName: string;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get('AZURE_OPENAI_API_KEY');
    const endpoint = this.configService.get('AZURE_OPENAI_API_INSTANCE_NAME');
    this.apiVersion = this.configService.get('AZURE_OPENAI_API_VERSION', '2025-04-01-preview');
    this.modelName = this.configService.get('AZURE_OPENAI_API_DEPLOYMENT_NAME', 'gpt-5.1');
    this.baseUrl = `https://${endpoint}.openai.azure.com/openai/responses`;
  }

  async *run(context: AgentContext): AsyncGenerator<SSEEvent> {
    // 1. Emit metadata
    yield {
      event: 'metadata',
      data: {
        trace_id: context.traceId,
        citations: [],
      } as MetadataPayload,
    };

    // 2. Emit agent status
    yield {
      event: 'agent_updated',
      data: {
        answer: this.name,
        content_type: 'final_answer',
      } as AgentUpdatedPayload,
    };

    // 3. Build input for Responses API
    const input: ResponseInputMessage[] = context.messageHistory.map(m => ({
      type: 'message',
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));

    // 4. Stream from Azure OpenAI Responses API
    const response = await fetch(`${this.baseUrl}?api-version=${this.apiVersion}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.apiKey,
      },
      body: JSON.stringify({
        model: this.modelName,
        input,
        stream: true,
        max_output_tokens: 4096,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error(`Azure OpenAI API error: ${response.status}`);
    }

    // 5. Process SSE stream from Responses API
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const event = JSON.parse(data);
            // Responses API uses 'response.output_text.delta' event type
            if (event.type === 'response.output_text.delta' && event.delta) {
              yield {
                event: 'data',
                data: { answer: event.delta } as DataPayload,
              };
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }

    // 6. Emit done
    yield {
      event: 'done',
      data: { answer: 'Stream completed' } as DonePayload,
    };
  }
}
```

### Step 3.6: Chat Controller

```typescript
// src/chat/chat.controller.ts

import { Controller, Post, Body, Res, HttpStatus, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import { SSEService } from '../core/streaming/sse.service';
import { AuthGuard } from '../auth/auth.guard';

@ApiTags('Chat')
@Controller('chat')
@UseGuards(AuthGuard)
export class ChatController {
  // Store active abort controllers by threadId
  private abortControllers = new Map<string, AbortController>();

  constructor(
    private readonly chatService: ChatService,
    private readonly sseService: SSEService,
  ) {}

  @Post('stream')
  @ApiOperation({ summary: 'Stream chat response' })
  @ApiResponse({ status: 200, description: 'SSE stream' })
  async streamChat(
    @Body() request: ChatRequestDto,
    @Res() res: Response,
  ): Promise<void> {
    // Initialize SSE headers
    this.sseService.initSSEHeaders(res);

    // Create independent abort controller (not tied to browser)
    const abortController = new AbortController();
    this.abortControllers.set(request.threadId, abortController);

    try {
      const stream = this.chatService.processChat(request, abortController.signal);

      for await (const event of stream) {
        if (abortController.signal.aborted) break;

        const sseData = this.sseService.formatSSE(event.event, event.data);
        res.write(sseData);

        // Flush to ensure immediate delivery
        if (typeof res.flush === 'function') {
          res.flush();
        }
      }
    } catch (error) {
      // Send error event
      const errorEvent = this.sseService.formatSSE('error', {
        error: error.message,
        code: 'STREAM_ERROR',
      });
      res.write(errorEvent);
    } finally {
      this.abortControllers.delete(request.threadId);
      res.end();
    }
  }

  @Post('stop')
  @ApiOperation({ summary: 'Stop active stream' })
  async stopStream(@Body('threadId') threadId: string): Promise<{ success: boolean }> {
    const controller = this.abortControllers.get(threadId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(threadId);
      return { success: true };
    }
    return { success: false };
  }
}
```

### Step 3.7: Chat Service

```typescript
// src/chat/chat.service.ts

import { Injectable } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { AgentFactory, AgentType } from '../agents/agent.factory';
import { InMemoryStreamStore } from '../core/streaming/stream-store';
import { SSEEvent } from '../core/streaming/types';
import { ChatRequestDto } from './dto/chat-request.dto';
import { AgentContext } from '../agents/agent.interface';

@Injectable()
export class ChatService {
  constructor(
    private readonly agentFactory: AgentFactory,
    private readonly streamStore: InMemoryStreamStore,
  ) {}

  async *processChat(
    request: ChatRequestDto,
    signal: AbortSignal,
  ): AsyncGenerator<SSEEvent> {
    const traceId = nanoid();
    const streamId = await this.streamStore.initSession(request.threadId);

    const context: AgentContext = {
      traceId,
      userId: request.userId,
      sessionId: request.threadId,
      messageHistory: request.messages,
    };

    const agent = this.agentFactory.getAgent(request.agentType as AgentType);

    try {
      for await (const event of agent.run(context)) {
        if (signal.aborted) break;

        // Store chunks for resumption
        if (event.event === 'data' || event.event === 'agent_updated') {
          await this.streamStore.appendChunk(request.threadId, {
            agent: agent.name,
            content: (event.data as any).answer || '',
            contentType: (event.data as any).content_type || 'final_answer',
            timestamp: new Date(),
          });
        }

        yield event;
      }
    } finally {
      await this.streamStore.markDone(request.threadId);
    }
  }
}
```

### Step 3.8: DTOs

```typescript
// src/chat/dto/chat-request.dto.ts

import { IsString, IsArray, IsOptional, ValidateNested, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ChatMessageDto {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty({ enum: ['user', 'assistant', 'system'] })
  @IsEnum(['user', 'assistant', 'system'])
  role: 'user' | 'assistant' | 'system';

  @ApiProperty()
  @IsString()
  content: string;

  @ApiProperty({ required: false })
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class ChatRequestDto {
  @ApiProperty()
  @IsString()
  threadId: string;

  @ApiProperty()
  @IsString()
  userId: string;

  @ApiProperty({ enum: ['normal', 'rag', 'multi-agent'] })
  @IsString()
  agentType: string;

  @ApiProperty({ type: [ChatMessageDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages: ChatMessageDto[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  conversationStyle?: 'balanced' | 'creative' | 'precise';
}
```

---

## 4. Frontend Implementation

### Step 4.1: Types

```typescript
// types/chat.ts

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  traceId?: string;
  citations?: Citation[];
  intermediateSteps?: IntermediateStep[];
  metadata?: MessageMetadata;
  status?: 'pending' | 'streaming' | 'complete' | 'error';
}

export interface IntermediateStep {
  agent: string;
  content: string;
  contentType: 'thoughts' | 'final_answer';
}

export interface MessageMetadata {
  tool?: string;
  runId?: string;
  threadId?: string;
  streamId?: string;
}

export interface Citation {
  title: string;
  url?: string;
  snippet?: string;
}

export interface ChatThread {
  id: string;
  name: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}
```

### Step 4.2: SSE Parser Hook

```typescript
// hooks/useSSEParser.ts

import { useCallback, useRef } from 'react';

export type SSEEventType = 'metadata' | 'agent_updated' | 'data' | 'done' | 'error';

export interface ParsedSSEEvent {
  event: SSEEventType;
  data: unknown;
}

export function useSSEParser() {
  const bufferRef = useRef('');

  const parse = useCallback((chunk: string): ParsedSSEEvent[] => {
    bufferRef.current += chunk;
    const events: ParsedSSEEvent[] = [];

    // Split by double newline (SSE event delimiter)
    const parts = bufferRef.current.split('\n\n');

    // Keep incomplete last part in buffer
    bufferRef.current = parts.pop() || '';

    for (const part of parts) {
      if (!part.trim()) continue;

      const lines = part.split('\n');
      let eventType: SSEEventType = 'data';
      let dataLines: string[] = [];

      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventType = line.slice(6).trim() as SSEEventType;
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trim());
        }
      }

      if (dataLines.length > 0) {
        try {
          const jsonStr = dataLines.join('\n');
          const data = JSON.parse(jsonStr);
          events.push({ event: eventType, data });
        } catch (e) {
          console.warn('Failed to parse SSE data:', e);
        }
      }
    }

    return events;
  }, []);

  const reset = useCallback(() => {
    bufferRef.current = '';
  }, []);

  return { parse, reset };
}
```

### Step 4.3: Chat Hook with Streaming

```typescript
// hooks/useChat.ts

import { useState, useCallback, useRef } from 'react';
import { ChatMessage, IntermediateStep } from '../types/chat';
import { useSSEParser, ParsedSSEEvent } from './useSSEParser';
import { nanoid } from 'nanoid';

interface UseChatOptions {
  threadId: string;
  userId: string;
  agentType: string;
  onError?: (error: Error) => void;
}

interface AgentState {
  [agentName: string]: {
    content: string;
    contentType: 'thoughts' | 'final_answer';
  };
}

export function useChat(options: UseChatOptions) {
  const { threadId, userId, agentType, onError } = options;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentTraceId, setCurrentTraceId] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const agentMapRef = useRef<AgentState>({});
  const seqRef = useRef(0);
  const { parse, reset } = useSSEParser();

  const sendMessage = useCallback(async (content: string) => {
    // Increment sequence to ignore stale responses
    const currentSeq = ++seqRef.current;

    // Create user message
    const userMessage: ChatMessage = {
      id: nanoid(),
      role: 'user',
      content,
      status: 'complete',
    };

    // Create placeholder assistant message
    const assistantMessage: ChatMessage = {
      id: nanoid(),
      role: 'assistant',
      content: '',
      status: 'pending',
      intermediateSteps: [],
    };

    setMessages(prev => [...prev, userMessage, assistantMessage]);
    setIsStreaming(true);
    reset();
    agentMapRef.current = {};

    // Create abort controller
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId,
          userId,
          agentType,
          messages: [...messages, userMessage].map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            metadata: m.metadata,
          })),
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();

      while (true) {
        // Check for stale sequence
        if (currentSeq !== seqRef.current) break;
        if (abortControllerRef.current?.signal.aborted) break;

        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const events = parse(chunk);

        for (const event of events) {
          handleSSEEvent(event, assistantMessage.id, currentSeq);
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        onError?.(error);
        updateAssistantMessage(assistantMessage.id, { status: 'error' });
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [threadId, userId, agentType, messages, parse, reset, onError]);

  const handleSSEEvent = useCallback((
    event: ParsedSSEEvent,
    assistantId: string,
    seq: number,
  ) => {
    if (seq !== seqRef.current) return;

    switch (event.event) {
      case 'metadata': {
        const { trace_id, citations } = event.data as any;
        setCurrentTraceId(trace_id);
        if (citations) {
          updateAssistantMessage(assistantId, { citations });
        }
        break;
      }

      case 'agent_updated': {
        const { answer: agentName, content_type } = event.data as any;
        agentMapRef.current[agentName] = {
          content: '',
          contentType: content_type,
        };

        // Update intermediate steps
        const steps = Object.entries(agentMapRef.current).map(([agent, state]) => ({
          agent,
          content: state.content,
          contentType: state.contentType,
        }));
        updateAssistantMessage(assistantId, {
          intermediateSteps: steps,
          status: 'streaming',
        });
        break;
      }

      case 'data': {
        const { answer } = event.data as any;
        // Find last agent and append content
        const agents = Object.keys(agentMapRef.current);
        const lastAgent = agents[agents.length - 1];
        if (lastAgent) {
          agentMapRef.current[lastAgent].content += answer;
        }

        // Update message content (from final_answer agents)
        const finalContent = Object.entries(agentMapRef.current)
          .filter(([_, state]) => state.contentType === 'final_answer')
          .map(([_, state]) => state.content)
          .join('');

        const steps = Object.entries(agentMapRef.current).map(([agent, state]) => ({
          agent,
          content: state.content,
          contentType: state.contentType,
        }));

        updateAssistantMessage(assistantId, {
          content: finalContent,
          intermediateSteps: steps,
        });
        break;
      }

      case 'done': {
        const { message_id, stream_id } = event.data as any;
        updateAssistantMessage(assistantId, {
          status: 'complete',
          metadata: { streamId: stream_id },
        });
        // Optionally re-key to server ID
        if (message_id) {
          reassignMessageId(assistantId, message_id);
        }
        break;
      }

      case 'error': {
        const { error } = event.data as any;
        updateAssistantMessage(assistantId, {
          status: 'error',
          content: `Error: ${error}`,
        });
        break;
      }
    }
  }, []);

  const updateAssistantMessage = useCallback((id: string, updates: Partial<ChatMessage>) => {
    setMessages(prev => prev.map(msg =>
      msg.id === id ? { ...msg, ...updates } : msg
    ));
  }, []);

  const reassignMessageId = useCallback((oldId: string, newId: string) => {
    setMessages(prev => prev.map(msg =>
      msg.id === oldId ? { ...msg, id: newId } : msg
    ));
  }, []);

  const stopGeneration = useCallback(async () => {
    abortControllerRef.current?.abort();

    // Notify server to stop upstream
    try {
      await fetch('/api/chat/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId }),
      });
    } catch (e) {
      console.warn('Failed to notify server of stop:', e);
    }
  }, [threadId]);

  return {
    messages,
    isStreaming,
    currentTraceId,
    sendMessage,
    stopGeneration,
    setMessages,
  };
}
```

### Step 4.4: Chat UI Component

```typescript
// components/Chat.tsx

import React, { useState, useRef, useEffect } from 'react';
import { useChat } from '../hooks/useChat';
import { ChatMessage as ChatMessageType } from '../types/chat';

interface ChatProps {
  threadId: string;
  userId: string;
  agentType: string;
}

export function Chat({ threadId, userId, agentType }: ChatProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    isStreaming,
    sendMessage,
    stopGeneration
  } = useChat({
    threadId,
    userId,
    agentType,
    onError: (error) => console.error('Chat error:', error),
  });

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    const message = input.trim();
    setInput('');
    await sendMessage(message);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <ChatMessageBubble key={message.id} message={message} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 px-4 py-2 border rounded-lg"
            disabled={isStreaming}
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={stopGeneration}
              className="px-4 py-2 bg-red-500 text-white rounded-lg"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg disabled:opacity-50"
            >
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function ChatMessageBubble({ message }: { message: ChatMessageType }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] rounded-lg p-4 ${
        isUser ? 'bg-blue-500 text-white' : 'bg-gray-100'
      }`}>
        {/* Show agent thinking steps */}
        {message.intermediateSteps?.map((step, i) => (
          step.contentType === 'thoughts' && (
            <div key={i} className="text-sm text-gray-500 mb-2 italic">
              <span className="font-medium">{step.agent}:</span> {step.content}
            </div>
          )
        ))}

        {/* Main content */}
        <div className="whitespace-pre-wrap">{message.content}</div>

        {/* Status indicator */}
        {message.status === 'streaming' && (
          <span className="inline-block w-2 h-4 bg-current animate-pulse ml-1" />
        )}

        {/* Citations */}
        {message.citations && message.citations.length > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-200">
            <div className="text-xs text-gray-500">Sources:</div>
            {message.citations.map((citation, i) => (
              <a
                key={i}
                href={citation.url}
                className="text-xs text-blue-600 hover:underline block"
                target="_blank"
                rel="noopener noreferrer"
              >
                {citation.title}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## 5. Multi-Agent Orchestration

### Step 5.1: Orchestrator Pattern

```typescript
// src/agents/orchestrator/multi-agent.orchestrator.ts

import { Injectable } from '@nestjs/common';
import { IAgent, AgentContext } from '../agent.interface';
import { SSEEvent, AgentUpdatedPayload, DataPayload } from '../../core/streaming/types';
import { PlannerAgent } from './planner.agent';
import { ResearcherAgent } from './researcher.agent';
import { WriterAgent } from './writer.agent';

@Injectable()
export class MultiAgentOrchestrator implements IAgent {
  name = 'MultiAgentOrchestrator';

  constructor(
    private readonly plannerAgent: PlannerAgent,
    private readonly researcherAgent: ResearcherAgent,
    private readonly writerAgent: WriterAgent,
  ) {}

  async *run(context: AgentContext): AsyncGenerator<SSEEvent> {
    // 1. Emit metadata
    yield {
      event: 'metadata',
      data: { trace_id: context.traceId, citations: [] },
    };

    // 2. Run Planner Agent
    yield {
      event: 'agent_updated',
      data: {
        answer: 'PlannerAgent',
        content_type: 'thoughts',
        job_description: 'Creating execution plan...',
      } as AgentUpdatedPayload,
    };

    const plan = await this.plannerAgent.createPlan(context);

    yield {
      event: 'data',
      data: { answer: `Plan: ${plan.summary}\n` } as DataPayload,
    };

    // 3. Conditional: Run Researcher if plan requires research
    if (plan.requiresResearch) {
      yield {
        event: 'agent_updated',
        data: {
          answer: 'ResearcherAgent',
          content_type: 'thoughts',
          job_description: 'Gathering information...',
        } as AgentUpdatedPayload,
      };

      for await (const finding of this.researcherAgent.research(context, plan)) {
        yield {
          event: 'data',
          data: { answer: finding } as DataPayload,
        };
      }
    }

    // 4. Run Writer Agent (final answer)
    yield {
      event: 'agent_updated',
      data: {
        answer: 'WriterAgent',
        content_type: 'final_answer',
      } as AgentUpdatedPayload,
    };

    for await (const chunk of this.writerAgent.write(context, plan)) {
      yield {
        event: 'data',
        data: { answer: chunk } as DataPayload,
      };
    }

    // 5. Done
    yield {
      event: 'done',
      data: { answer: 'Stream completed' },
    };
  }
}
```

### Step 5.2: Handoff Pattern

```typescript
// src/agents/orchestrator/handoff.orchestrator.ts

import { Injectable } from '@nestjs/common';
import { IAgent, AgentContext } from '../agent.interface';
import { SSEEvent } from '../../core/streaming/types';

interface AgentResult {
  content: string;
  handoffTo?: string;
  handoffReason?: string;
}

@Injectable()
export class HandoffOrchestrator implements IAgent {
  name = 'HandoffOrchestrator';

  private agents: Map<string, IAgent> = new Map();

  registerAgent(name: string, agent: IAgent): void {
    this.agents.set(name, agent);
  }

  async *run(context: AgentContext): AsyncGenerator<SSEEvent> {
    yield {
      event: 'metadata',
      data: { trace_id: context.traceId },
    };

    let currentAgent = 'CoordinatorAgent';
    let iteration = 0;
    const maxIterations = 5; // Prevent infinite loops

    while (currentAgent && iteration < maxIterations) {
      const agent = this.agents.get(currentAgent);
      if (!agent) break;

      yield {
        event: 'agent_updated',
        data: {
          answer: currentAgent,
          content_type: 'thoughts',
        },
      };

      let result: AgentResult | null = null;

      for await (const event of agent.run(context)) {
        // Check for handoff decision in the event
        if (event.event === 'data') {
          yield event;
        }

        // Capture final result for handoff decision
        if (event.event === 'done' && (event.data as any).handoffTo) {
          result = event.data as AgentResult;
        }
      }

      if (result?.handoffTo) {
        currentAgent = result.handoffTo;
        iteration++;
      } else {
        break;
      }
    }

    yield {
      event: 'done',
      data: { answer: 'Stream completed' },
    };
  }
}
```

### Step 5.3: Parallel Agent Execution

```typescript
// src/agents/orchestrator/parallel.orchestrator.ts

import { Injectable } from '@nestjs/common';
import { IAgent, AgentContext } from '../agent.interface';
import { SSEEvent } from '../../core/streaming/types';

@Injectable()
export class ParallelOrchestrator implements IAgent {
  name = 'ParallelOrchestrator';

  constructor(
    private readonly queryAgent: IAgent,
    private readonly searchAgent: IAgent,
  ) {}

  async *run(context: AgentContext): AsyncGenerator<SSEEvent> {
    yield {
      event: 'metadata',
      data: { trace_id: context.traceId },
    };

    // Run agents in parallel
    const results = await Promise.all([
      this.collectAgentResults(this.queryAgent, context),
      this.collectAgentResults(this.searchAgent, context),
    ]);

    // Yield results sequentially for SSE
    for (const agentResults of results) {
      for (const event of agentResults) {
        yield event;
      }
    }

    yield {
      event: 'done',
      data: { answer: 'Stream completed' },
    };
  }

  private async collectAgentResults(
    agent: IAgent,
    context: AgentContext,
  ): Promise<SSEEvent[]> {
    const results: SSEEvent[] = [];
    for await (const event of agent.run(context)) {
      if (event.event !== 'done' && event.event !== 'metadata') {
        results.push(event);
      }
    }
    return results;
  }
}
```

---

## 6. Chat History & Multi-Turn Context

### Step 6.1: Message History Service

```typescript
// src/chat/services/message-history.service.ts

import { Injectable } from '@nestjs/common';
import { ChatMessage } from '../interfaces/chat-message.interface';

export interface MessageHistoryConfig {
  maxMessages: number;
  maxTokens: number;
  preserveSystemMessages: boolean;
}

@Injectable()
export class MessageHistoryService {
  private defaultConfig: MessageHistoryConfig = {
    maxMessages: 30,
    maxTokens: 8000,
    preserveSystemMessages: true,
  };

  /**
   * Prepare message history for agent consumption
   * Handles truncation, token limits, and format conversion
   */
  prepareHistory(
    messages: ChatMessage[],
    config?: Partial<MessageHistoryConfig>,
  ): Array<{ role: string; content: string }> {
    const cfg = { ...this.defaultConfig, ...config };

    // Separate system messages
    const systemMessages = messages.filter(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    // Truncate conversation if needed
    let truncated = conversationMessages;
    if (truncated.length > cfg.maxMessages) {
      truncated = truncated.slice(-cfg.maxMessages);
    }

    // Estimate tokens and further truncate if needed
    truncated = this.truncateByTokens(truncated, cfg.maxTokens);

    // Combine: system messages first, then conversation
    const result = cfg.preserveSystemMessages
      ? [...systemMessages, ...truncated]
      : truncated;

    return result.map(m => ({
      role: m.role,
      content: m.content,
    }));
  }

  /**
   * Format history as a single string for context injection
   */
  formatAsContext(messages: ChatMessage[]): string {
    return messages
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');
  }

  /**
   * Extract messages by role
   */
  filterByRole(messages: ChatMessage[], role: string): ChatMessage[] {
    return messages.filter(m => m.role === role);
  }

  /**
   * Get the most recent user message
   */
  getLastUserMessage(messages: ChatMessage[]): ChatMessage | undefined {
    return [...messages].reverse().find(m => m.role === 'user');
  }

  private truncateByTokens(
    messages: ChatMessage[],
    maxTokens: number,
  ): ChatMessage[] {
    // Simple estimation: ~4 chars per token
    const estimateTokens = (text: string) => Math.ceil(text.length / 4);

    let totalTokens = 0;
    const result: ChatMessage[] = [];

    // Process from newest to oldest
    for (let i = messages.length - 1; i >= 0; i--) {
      const tokens = estimateTokens(messages[i].content);
      if (totalTokens + tokens > maxTokens) break;
      totalTokens += tokens;
      result.unshift(messages[i]);
    }

    return result;
  }
}
```

### Step 6.2: Conversation State Management

```typescript
// src/chat/services/conversation-state.service.ts

import { Injectable } from '@nestjs/common';

export interface ConversationState {
  threadId: string;
  userId: string;
  currentTurn: number;
  context: Record<string, unknown>;
  previousQueries: string[];
  previousResults: Array<{
    query: string;
    result: string;
    success: boolean;
  }>;
}

@Injectable()
export class ConversationStateService {
  private states = new Map<string, ConversationState>();

  initState(threadId: string, userId: string): ConversationState {
    const state: ConversationState = {
      threadId,
      userId,
      currentTurn: 0,
      context: {},
      previousQueries: [],
      previousResults: [],
    };
    this.states.set(threadId, state);
    return state;
  }

  getState(threadId: string): ConversationState | undefined {
    return this.states.get(threadId);
  }

  updateState(
    threadId: string,
    updates: Partial<ConversationState>,
  ): ConversationState | undefined {
    const state = this.states.get(threadId);
    if (!state) return undefined;

    Object.assign(state, updates);
    return state;
  }

  addTurnResult(
    threadId: string,
    query: string,
    result: string,
    success: boolean,
  ): void {
    const state = this.states.get(threadId);
    if (!state) return;

    state.currentTurn++;
    state.previousQueries.push(query);
    state.previousResults.push({ query, result, success });

    // Keep only last 10 results
    if (state.previousResults.length > 10) {
      state.previousResults = state.previousResults.slice(-10);
      state.previousQueries = state.previousQueries.slice(-10);
    }
  }

  clearState(threadId: string): void {
    this.states.delete(threadId);
  }
}
```

### Step 6.3: Context-Aware Agent

```typescript
// src/agents/context-aware/context-aware.agent.ts

import { Injectable } from '@nestjs/common';
import { IAgent, AgentContext } from '../agent.interface';
import { SSEEvent } from '../../core/streaming/types';
import { MessageHistoryService } from '../../chat/services/message-history.service';
import { ConversationStateService } from '../../chat/services/conversation-state.service';

@Injectable()
export class ContextAwareAgent implements IAgent {
  name = 'ContextAwareAgent';

  constructor(
    private readonly historyService: MessageHistoryService,
    private readonly stateService: ConversationStateService,
    private readonly llmService: any, // Your LLM service
  ) {}

  async *run(context: AgentContext): AsyncGenerator<SSEEvent> {
    yield {
      event: 'metadata',
      data: { trace_id: context.traceId },
    };

    // Get or initialize conversation state
    let state = this.stateService.getState(context.sessionId);
    if (!state) {
      state = this.stateService.initState(context.sessionId, context.userId);
    }

    // Prepare context-aware prompt
    const lastUserMessage = this.historyService.getLastUserMessage(
      context.messageHistory,
    );

    const historyContext = this.historyService.formatAsContext(
      context.messageHistory.slice(-6), // Last 3 turns
    );

    const systemPrompt = this.buildSystemPrompt(state, historyContext);

    yield {
      event: 'agent_updated',
      data: { answer: this.name, content_type: 'final_answer' },
    };

    // Stream response
    const prepared = this.historyService.prepareHistory(context.messageHistory);
    const messagesWithSystem = [
      { role: 'system', content: systemPrompt },
      ...prepared,
    ];

    let fullResponse = '';
    for await (const chunk of this.llmService.streamChat(messagesWithSystem)) {
      fullResponse += chunk;
      yield {
        event: 'data',
        data: { answer: chunk },
      };
    }

    // Update state with this turn
    this.stateService.addTurnResult(
      context.sessionId,
      lastUserMessage?.content || '',
      fullResponse,
      true,
    );

    yield {
      event: 'done',
      data: { answer: 'Stream completed' },
    };
  }

  private buildSystemPrompt(
    state: any,
    historyContext: string,
  ): string {
    return `You are a helpful assistant engaged in a multi-turn conversation.

Current conversation turn: ${state.currentTurn + 1}

Recent conversation context:
${historyContext}

Previous queries in this session:
${state.previousQueries.slice(-3).map((q, i) => `${i + 1}. ${q}`).join('\n')}

Instructions:
- Maintain context from previous turns
- Reference earlier parts of the conversation when relevant
- Be concise but thorough
- If the user refers to "it" or "that", infer from context`;
  }
}
```

---

## 7. Stream Resumption & Fault Tolerance

### Step 7.1: Resume Endpoint

```typescript
// src/chat/chat.controller.ts (additional method)

@Get('resume/:threadId')
@ApiOperation({ summary: 'Resume interrupted stream' })
async resumeStream(
  @Param('threadId') threadId: string,
  @Res() res: Response,
): Promise<void> {
  this.sseService.initSSEHeaders(res);

  const session = await this.streamStore.getSession(threadId);

  if (!session) {
    res.write(this.sseService.formatSSE('error', {
      error: 'Session not found or expired',
      code: 'SESSION_NOT_FOUND',
    }));
    res.end();
    return;
  }

  // Replay stored chunks
  for (const chunk of session.chunks) {
    const event: SSEEvent = {
      event: chunk.contentType === 'thoughts' ? 'agent_updated' : 'data',
      data: {
        answer: chunk.content,
        content_type: chunk.contentType,
      },
    };
    res.write(this.sseService.formatSSE(event.event, event.data));
  }

  if (session.isDone) {
    res.write(this.sseService.formatSSE('done', {
      message_id: session.streamId,
      answer: 'Resumed and completed',
    }));
    res.end();
  } else {
    // Stream is still active, poll for new chunks
    await this.pollForNewChunks(threadId, session.chunks.length, res);
  }
}

private async pollForNewChunks(
  threadId: string,
  startIndex: number,
  res: Response,
): Promise<void> {
  const pollInterval = 250; // ms
  const maxPollTime = 300000; // 5 minutes
  const startTime = Date.now();

  while (Date.now() - startTime < maxPollTime) {
    const session = await this.streamStore.getSession(threadId);
    if (!session) break;

    // Send new chunks
    for (let i = startIndex; i < session.chunks.length; i++) {
      const chunk = session.chunks[i];
      const event: SSEEvent = {
        event: chunk.contentType === 'thoughts' ? 'agent_updated' : 'data',
        data: {
          answer: chunk.content,
          content_type: chunk.contentType,
        },
      };
      res.write(this.sseService.formatSSE(event.event, event.data));
    }
    startIndex = session.chunks.length;

    if (session.isDone) {
      res.write(this.sseService.formatSSE('done', {
        answer: 'Stream completed',
      }));
      break;
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  res.end();
}
```

### Step 7.2: Client-Side Reconnection

```typescript
// hooks/useStreamReconnection.ts

import { useCallback, useRef, useEffect } from 'react';

interface ReconnectionOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
}

export function useStreamReconnection(
  threadId: string,
  onReconnect: (events: any[]) => void,
  options: Partial<ReconnectionOptions> = {},
) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 30000,
  } = options;

  const retriesRef = useRef(0);
  const isReconnectingRef = useRef(false);

  const calculateDelay = useCallback((attempt: number) => {
    // Exponential backoff with jitter
    const exponentialDelay = baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 1000;
    return Math.min(exponentialDelay + jitter, maxDelay);
  }, [baseDelay, maxDelay]);

  const attemptReconnection = useCallback(async () => {
    if (isReconnectingRef.current) return;
    if (retriesRef.current >= maxRetries) {
      console.warn('Max reconnection attempts reached');
      return;
    }

    isReconnectingRef.current = true;
    retriesRef.current++;

    const delay = calculateDelay(retriesRef.current);
    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      const response = await fetch(`/api/chat/resume/${threadId}`);
      if (!response.ok) throw new Error('Resume failed');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      const events: any[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Parse SSE events (simplified)
        const text = decoder.decode(value);
        // ... parse events
        events.push(/* parsed events */);
      }

      onReconnect(events);
      retriesRef.current = 0; // Reset on success
    } catch (error) {
      console.error('Reconnection attempt failed:', error);
      // Will retry on next call
    } finally {
      isReconnectingRef.current = false;
    }
  }, [threadId, maxRetries, calculateDelay, onReconnect]);

  const resetRetries = useCallback(() => {
    retriesRef.current = 0;
  }, []);

  return {
    attemptReconnection,
    resetRetries,
    currentRetries: retriesRef.current,
  };
}
```

### Step 7.3: Heartbeat & Connection Health

```typescript
// src/chat/chat.controller.ts (heartbeat support)

@Get('health/:threadId')
@ApiOperation({ summary: 'Check stream health' })
async checkStreamHealth(
  @Param('threadId') threadId: string,
): Promise<{ active: boolean; chunkCount: number; isDone: boolean }> {
  const session = await this.streamStore.getSession(threadId);

  if (!session) {
    return { active: false, chunkCount: 0, isDone: true };
  }

  return {
    active: !session.isDone,
    chunkCount: session.chunks.length,
    isDone: session.isDone,
  };
}
```

```typescript
// hooks/useStreamHealth.ts

import { useEffect, useRef, useState } from 'react';

export function useStreamHealth(
  threadId: string | null,
  isStreaming: boolean,
  onDisconnect: () => void,
) {
  const [isHealthy, setIsHealthy] = useState(true);
  const lastChunkTimeRef = useRef<number>(Date.now());
  const healthCheckIntervalRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    if (!isStreaming || !threadId) {
      if (healthCheckIntervalRef.current) {
        clearInterval(healthCheckIntervalRef.current);
      }
      return;
    }

    const checkHealth = async () => {
      const timeSinceLastChunk = Date.now() - lastChunkTimeRef.current;

      // If no chunk received in 30 seconds during streaming, check server
      if (timeSinceLastChunk > 30000) {
        try {
          const response = await fetch(`/api/chat/health/${threadId}`);
          const data = await response.json();

          if (!data.active && !data.isDone) {
            setIsHealthy(false);
            onDisconnect();
          }
        } catch {
          setIsHealthy(false);
          onDisconnect();
        }
      }
    };

    healthCheckIntervalRef.current = setInterval(checkHealth, 10000);

    return () => {
      if (healthCheckIntervalRef.current) {
        clearInterval(healthCheckIntervalRef.current);
      }
    };
  }, [threadId, isStreaming, onDisconnect]);

  const recordChunk = () => {
    lastChunkTimeRef.current = Date.now();
    setIsHealthy(true);
  };

  return { isHealthy, recordChunk };
}
```

---

## 8. Testing Strategy

### Step 8.1: SSE Stream Testing

```typescript
// test/streaming/sse.service.spec.ts

import { Test } from '@nestjs/testing';
import { SSEService } from '../../src/core/streaming/sse.service';

describe('SSEService', () => {
  let service: SSEService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [SSEService],
    }).compile();

    service = module.get<SSEService>(SSEService);
  });

  describe('formatSSE', () => {
    it('should format single-line data correctly', () => {
      const result = service.formatSSE('data', { answer: 'hello' });
      expect(result).toBe('event: data\ndata: {"answer":"hello"}\n\n');
    });

    it('should format multi-line data correctly', () => {
      const result = service.formatSSE('data', { answer: 'line1\nline2' });
      expect(result).toContain('data: ');
      expect(result).toEndWith('\n\n');
    });

    it('should handle special characters in JSON', () => {
      const result = service.formatSSE('data', { answer: 'test "quotes"' });
      expect(result).toContain('\\"quotes\\"');
    });
  });

  describe('createSSEStream', () => {
    it('should yield formatted SSE strings', async () => {
      async function* source() {
        yield { event: 'data' as const, data: { answer: 'chunk1' } };
        yield { event: 'data' as const, data: { answer: 'chunk2' } };
        yield { event: 'done' as const, data: { answer: 'complete' } };
      }

      const results: string[] = [];
      for await (const chunk of service.createSSEStream(source())) {
        results.push(chunk);
      }

      expect(results).toHaveLength(3);
      expect(results[0]).toContain('chunk1');
      expect(results[2]).toContain('done');
    });

    it('should respect abort signal', async () => {
      const controller = new AbortController();

      async function* infiniteSource() {
        let i = 0;
        while (true) {
          yield { event: 'data' as const, data: { answer: `chunk${i++}` } };
        }
      }

      const results: string[] = [];
      setTimeout(() => controller.abort(), 50);

      for await (const chunk of service.createSSEStream(
        infiniteSource(),
        controller.signal,
      )) {
        results.push(chunk);
        if (results.length > 100) break; // Safety limit
      }

      expect(results.length).toBeLessThan(100);
    });
  });
});
```

### Step 8.2: Agent Testing

```typescript
// test/agents/normal.agent.spec.ts

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NormalAgent } from '../../src/agents/normal/normal.agent';
import { AgentContext } from '../../src/agents/agent.interface';

// Mock OpenAI
jest.mock('openai', () => ({
  default: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  })),
}));

describe('NormalAgent', () => {
  let agent: NormalAgent;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        NormalAgent,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string> = {
                AZURE_OPENAI_API_KEY: 'test-key',
                AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
                AZURE_OPENAI_DEPLOYMENT: 'gpt-4',
                AZURE_OPENAI_API_VERSION: '2024-02-15-preview',
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    agent = module.get<NormalAgent>(NormalAgent);
  });

  describe('run', () => {
    it('should emit metadata as first event', async () => {
      const context: AgentContext = {
        traceId: 'test-trace',
        userId: 'user-1',
        sessionId: 'session-1',
        messageHistory: [{ id: '1', role: 'user', content: 'Hello' }],
      };

      // Mock streaming response
      const mockStream = (async function* () {
        yield { choices: [{ delta: { content: 'Hello' } }] };
        yield { choices: [{ delta: { content: ' world' } }] };
      })();

      jest.spyOn(agent['openai'].chat.completions, 'create')
        .mockResolvedValue(mockStream as any);

      const events: any[] = [];
      for await (const event of agent.run(context)) {
        events.push(event);
      }

      expect(events[0].event).toBe('metadata');
      expect(events[0].data.trace_id).toBe('test-trace');
    });

    it('should emit agent_updated before streaming', async () => {
      const context: AgentContext = {
        traceId: 'test-trace',
        userId: 'user-1',
        sessionId: 'session-1',
        messageHistory: [{ id: '1', role: 'user', content: 'Hello' }],
      };

      const mockStream = (async function* () {
        yield { choices: [{ delta: { content: 'Test' } }] };
      })();

      jest.spyOn(agent['openai'].chat.completions, 'create')
        .mockResolvedValue(mockStream as any);

      const events: any[] = [];
      for await (const event of agent.run(context)) {
        events.push(event);
      }

      expect(events[1].event).toBe('agent_updated');
      expect(events[1].data.answer).toBe('NormalAgent');
    });

    it('should emit done as last event', async () => {
      const context: AgentContext = {
        traceId: 'test-trace',
        userId: 'user-1',
        sessionId: 'session-1',
        messageHistory: [{ id: '1', role: 'user', content: 'Hello' }],
      };

      const mockStream = (async function* () {
        yield { choices: [{ delta: { content: 'Test' } }] };
      })();

      jest.spyOn(agent['openai'].chat.completions, 'create')
        .mockResolvedValue(mockStream as any);

      const events: any[] = [];
      for await (const event of agent.run(context)) {
        events.push(event);
      }

      const lastEvent = events[events.length - 1];
      expect(lastEvent.event).toBe('done');
    });
  });
});
```

### Step 8.3: E2E Streaming Test

```typescript
// test/e2e/chat-stream.e2e-spec.ts

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';

describe('Chat Stream (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/chat/stream (POST) should stream SSE events', async () => {
    const response = await request(app.getHttpServer())
      .post('/chat/stream')
      .send({
        threadId: 'test-thread',
        userId: 'test-user',
        agentType: 'normal',
        messages: [
          { id: '1', role: 'user', content: 'Hello' },
        ],
      })
      .expect(200)
      .expect('Content-Type', /text\/event-stream/);

    // Parse SSE events from response
    const events = parseSSEResponse(response.text);

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].event).toBe('metadata');
    expect(events[events.length - 1].event).toBe('done');
  });

  it('/chat/stop (POST) should abort active stream', async () => {
    // Start a stream
    const streamPromise = request(app.getHttpServer())
      .post('/chat/stream')
      .send({
        threadId: 'stop-test-thread',
        userId: 'test-user',
        agentType: 'normal',
        messages: [
          { id: '1', role: 'user', content: 'Write a very long story' },
        ],
      });

    // Wait a bit, then stop
    await new Promise(resolve => setTimeout(resolve, 100));

    const stopResponse = await request(app.getHttpServer())
      .post('/chat/stop')
      .send({ threadId: 'stop-test-thread' })
      .expect(201);

    expect(stopResponse.body.success).toBe(true);

    // The stream should end gracefully
    const streamResponse = await streamPromise;
    expect(streamResponse.status).toBe(200);
  });
});

function parseSSEResponse(text: string): Array<{ event: string; data: any }> {
  const events: Array<{ event: string; data: any }> = [];
  const parts = text.split('\n\n');

  for (const part of parts) {
    if (!part.trim()) continue;

    const lines = part.split('\n');
    let event = 'message';
    let data = '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data += line.slice(5).trim();
      }
    }

    if (data) {
      try {
        events.push({ event, data: JSON.parse(data) });
      } catch {
        events.push({ event, data });
      }
    }
  }

  return events;
}
```

---

## 9. Production Checklist

### Infrastructure

- [ ] **Redis cluster** for stream storage (HA mode)
- [ ] **Load balancer** configured for SSE (sticky sessions or proper routing)
- [ ] **Timeouts** configured appropriately
  - Nginx: `proxy_read_timeout 300s`
  - ALB: Idle timeout > expected stream duration
- [ ] **Buffering disabled** at all proxy layers
  - Nginx: `proxy_buffering off`
  - CloudFront/CDN: Bypass for streaming endpoints

### Observability

- [ ] **Trace IDs** propagated through entire flow
- [ ] **Langfuse/LangSmith** integration for LLM observability
- [ ] **Metrics** for:
  - Stream duration
  - Chunks per stream
  - Error rates by type
  - Reconnection attempts
- [ ] **Alerts** for:
  - High error rates
  - Stream timeouts
  - Redis connection failures

### Security

- [ ] **Authentication** on all endpoints
- [ ] **Rate limiting** per user/session
- [ ] **Input validation** (message length, history size)
- [ ] **Output sanitization** (XSS prevention in streamed content)
- [ ] **CORS** properly configured

### Performance

- [ ] **Connection pooling** for upstream services
- [ ] **Backpressure handling** in stream processing
- [ ] **Memory limits** for stream buffers
- [ ] **Graceful shutdown** (drain existing streams)

### Error Handling

- [ ] **Retry logic** with exponential backoff
- [ ] **Circuit breakers** for external services
- [ ] **Partial response persistence** on failures
- [ ] **User-friendly error messages** via SSE error events

### Testing

- [ ] **Unit tests** for SSE formatting
- [ ] **Integration tests** for full stream flow
- [ ] **Load tests** for concurrent streams
- [ ] **Chaos tests** for failure scenarios

---

## Quick Reference

### Event Flow Sequence

```
1. POST /chat/stream (request)
2. → metadata (trace_id, citations)
3. → agent_updated (AgentName, thoughts)
4. → data (streaming chunks...)
5. → agent_updated (NextAgent, final_answer)
6. → data (more chunks...)
7. → done (message_id, stream_id)
```

### Key Files to Create

| File | Purpose |
|------|---------|
| `src/core/streaming/types.ts` | TypeScript interfaces |
| `src/core/streaming/sse.service.ts` | SSE formatting |
| `src/core/streaming/stream-store.ts` | Resumption storage |
| `src/agents/agent.interface.ts` | Agent contract |
| `src/agents/agent.factory.ts` | Agent instantiation |
| `src/chat/chat.controller.ts` | HTTP endpoints |
| `src/chat/chat.service.ts` | Business logic |
| `hooks/useSSEParser.ts` | Client SSE parsing |
| `hooks/useChat.ts` | React chat hook |

### Environment Variables

```bash
# Azure OpenAI
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_KEY=your-api-key
AZURE_OPENAI_DEPLOYMENT=gpt-4
AZURE_OPENAI_API_VERSION=2024-02-15-preview

# Stream Store
SSE_STREAM_STORE_PROVIDER=redis  # or "memory"
SSE_REDIS_URL=redis://localhost:6379
SSE_REDIS_EXPIRE_SECONDS=3600

# Observability
LANGFUSE_PUBLIC_KEY=pk-xxx
LANGFUSE_SECRET_KEY=sk-xxx
LANGFUSE_HOST=https://cloud.langfuse.com
```

---

## Next Steps

1. **Copy the code templates** from this guide into your NestJS project
2. **Implement the basic NormalAgent** first
3. **Add the frontend hooks** and test end-to-end
4. **Implement multi-agent orchestration** once basic flow works
5. **Add stream resumption** for production resilience
6. **Set up observability** with Langfuse

For questions or issues, refer to:
- FE Reference: `modec-azure-chatgpt/src/features/chat/`
- BE Reference: `sensei-server/app/biz/agent/`
