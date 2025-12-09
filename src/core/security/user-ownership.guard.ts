import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Optional,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IChatRepository } from '../../database/types';

/**
 * Decorator to mark routes that require user ownership validation
 *
 * Usage:
 * @RequireOwnership('threadId')  // Check thread ownership
 * @RequireOwnership('messageId', 'message')  // Check message ownership
 */
export const OWNERSHIP_KEY = 'ownership';

export interface OwnershipMetadata {
  paramName: string;
  resourceType: 'thread' | 'message';
}

export const RequireOwnership = (paramName: string, resourceType: 'thread' | 'message' = 'thread') => {
  return (target: any, propertyKey?: string, descriptor?: PropertyDescriptor) => {
    if (propertyKey && descriptor) {
      // Method decorator
      Reflect.defineMetadata(OWNERSHIP_KEY, { paramName, resourceType }, descriptor.value);
    }
    return descriptor;
  };
};

/**
 * UserOwnershipGuard
 *
 * Ensures users can only access their own resources (threads/messages).
 * This prevents cross-user data access.
 *
 * How it works:
 * 1. Extract userId from request (body, query, or authenticated user)
 * 2. Extract resourceId from route params
 * 3. Verify the resource belongs to the user
 *
 * Configuration:
 * - Use @RequireOwnership('threadId') decorator on controller methods
 * - Or apply globally with custom logic
 */
@Injectable()
export class UserOwnershipGuard implements CanActivate {
  private readonly logger = new Logger(UserOwnershipGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Optional() @Inject('IChatRepository') private readonly chatRepository?: IChatRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get ownership metadata from decorator
    const ownership = this.reflector.get<OwnershipMetadata>(OWNERSHIP_KEY, context.getHandler());

    if (!ownership) {
      // No ownership check required for this route
      return true;
    }

    if (!this.chatRepository) {
      // No repository configured, skip ownership check
      return true;
    }

    const request = context.switchToHttp().getRequest();

    // Extract userId from request
    // Priority: 1. Authenticated user (from auth middleware)
    //           2. Query param
    //           3. Body
    const userId = this.extractUserId(request);

    if (!userId) {
      this.logger.warn('No userId found in request');
      throw new ForbiddenException('User identification required');
    }

    // Extract resource ID from route params
    const resourceId = request.params[ownership.paramName];

    if (!resourceId) {
      // No resource ID in params, allow (might be a list operation)
      return true;
    }

    // Verify ownership
    const isOwner = await this.verifyOwnership(userId, resourceId, ownership.resourceType);

    if (!isOwner) {
      this.logger.warn(
        `User ${userId} attempted to access ${ownership.resourceType} ${resourceId} owned by another user`,
      );
      throw new ForbiddenException('You do not have access to this resource');
    }

    return true;
  }

  private extractUserId(request: any): string | undefined {
    // 1. From authenticated user (set by auth middleware)
    if (request.user?.id) {
      return request.user.id;
    }
    if (request.user?.userId) {
      return request.user.userId;
    }

    // 2. From X-User-Id header (for demo/testing)
    if (request.headers['x-user-id']) {
      return request.headers['x-user-id'];
    }

    // 3. From query params
    if (request.query?.userId) {
      return request.query.userId;
    }

    // 4. From body
    if (request.body?.userId) {
      return request.body.userId;
    }

    return undefined;
  }

  private async verifyOwnership(
    userId: string,
    resourceId: string,
    resourceType: 'thread' | 'message',
  ): Promise<boolean> {
    if (!this.chatRepository) {
      return true;
    }

    try {
      if (resourceType === 'thread') {
        const thread = await this.chatRepository.getThread(resourceId, true);
        if (!thread) {
          // Thread not found - let the controller handle 404
          return true;
        }
        return thread.userId === userId;
      } else if (resourceType === 'message') {
        const message = await this.chatRepository.getMessage(resourceId, true);
        if (!message) {
          // Message not found - let the controller handle 404
          return true;
        }
        return message.userId === userId;
      }
    } catch (error) {
      this.logger.error(`Error verifying ownership: ${error}`);
      // On error, deny access for safety
      return false;
    }

    return false;
  }
}

/**
 * Helper to validate userId matches across request components
 * Use in controller to ensure consistency
 */
export function validateUserIdConsistency(requestUserId: string, resourceUserId: string, resourceType: string): void {
  if (requestUserId !== resourceUserId) {
    throw new ForbiddenException(`Cannot access ${resourceType} belonging to another user`);
  }
}
