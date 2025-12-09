import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsNumber, IsObject, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

import { Type } from 'class-transformer';

/**
 * Chat Message DTO
 */
export class ChatMessageDto {
  @ApiPropertyOptional({ description: 'Unique message identifier (auto-generated if not provided)' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({
    enum: ['user', 'assistant', 'system'],
    description: 'Message role',
  })
  @IsEnum(['user', 'assistant', 'system'])
  role: 'user' | 'assistant' | 'system';

  @ApiProperty({ description: 'Message content' })
  @IsString()
  content: string;

  @ApiPropertyOptional({ description: 'Additional message metadata' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/**
 * Chat Request DTO
 *
 * Request body for POST /chat/stream endpoint
 */
export class ChatRequestDto {
  @ApiProperty({ description: 'Thread/conversation ID' })
  @IsString()
  threadId: string;

  @ApiProperty({ description: 'User ID for tracking' })
  @IsString()
  userId: string;

  @ApiProperty({
    enum: ['normal', 'rag', 'multi-agent'],
    description: 'Agent type to use',
    default: 'normal',
  })
  @IsOptional()
  @IsString()
  agentType?: string = 'normal';

  @ApiProperty({
    type: [ChatMessageDto],
    description: 'Message history including the current user message',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages: ChatMessageDto[];

  @ApiPropertyOptional({
    enum: ['balanced', 'creative', 'precise'],
    description: 'Conversation style',
    default: 'balanced',
  })
  @IsOptional()
  @IsEnum(['balanced', 'creative', 'precise'])
  conversationStyle?: 'balanced' | 'creative' | 'precise' = 'balanced';

  @ApiPropertyOptional({
    description: 'Maximum tokens for response',
    minimum: 1,
    maximum: 8192,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(8192)
  maxTokens?: number;

  @ApiPropertyOptional({
    description: 'Temperature for generation (0-1)',
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  temperature?: number;

  @ApiPropertyOptional({
    description: 'Custom system prompt',
  })
  @IsOptional()
  @IsString()
  systemPrompt?: string;
}

/**
 * Stop Stream Request DTO
 */
export class StopStreamDto {
  @ApiProperty({ description: 'Thread ID to stop streaming for' })
  @IsString()
  threadId: string;
}
