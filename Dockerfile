# =============================================================================
# Multi-stage Dockerfile for NestJS LLM Agent Application
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Base image with dependencies
# -----------------------------------------------------------------------------
FROM node:20-alpine AS base

WORKDIR /app

# Install curl for healthchecks
RUN apk add --no-cache curl

# Copy package files
COPY package.json yarn.lock ./

# -----------------------------------------------------------------------------
# Stage 2: Development (with hot reload)
# -----------------------------------------------------------------------------
FROM base AS development

# Install all dependencies (including devDependencies)
RUN yarn install --frozen-lockfile

# Copy source code
COPY . .

# Expose port
EXPOSE 8083

# Start in development mode with hot reload
CMD ["yarn", "start:dev"]

# -----------------------------------------------------------------------------
# Stage 3: Builder (compile TypeScript)
# -----------------------------------------------------------------------------
FROM base AS builder

# Install all dependencies for building
RUN yarn install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN yarn build

# Remove devDependencies
RUN yarn install --frozen-lockfile --production

# -----------------------------------------------------------------------------
# Stage 4: Production (minimal image)
# -----------------------------------------------------------------------------
FROM node:20-alpine AS production

WORKDIR /app

# Install curl for healthchecks
RUN apk add --no-cache curl

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

# Copy built application and production dependencies
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./

# Create data directory for SQLite
RUN mkdir -p /app/data && chown -R nestjs:nodejs /app/data

# Switch to non-root user
USER nestjs

# Expose port
EXPOSE 8083

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8083/health || exit 1

# Start the application
CMD ["node", "dist/main.js"]
