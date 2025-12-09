# Contributing Guide

Guidelines for contributing to the Document Intelligence & AI Data Extraction project.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Development Setup](#development-setup)
3. [Code Style](#code-style)
4. [Project Structure](#project-structure)
5. [Making Changes](#making-changes)
6. [Testing](#testing)
7. [Pull Request Process](#pull-request-process)
8. [Commit Guidelines](#commit-guidelines)

---

## Getting Started

### Prerequisites

- Node.js 18+ (LTS)
- Yarn package manager
- Git
- Azure subscription (for integration testing)
- VS Code (recommended)

### Fork and Clone

```bash
# Fork the repository on GitHub, then clone
git clone https://github.com/YOUR_USERNAME/extract-data-from-pdf-or-image-with-document-intelligence-and-chatgpt.git
cd extract-data-from-pdf-or-image-with-document-intelligence-and-chatgpt

# Add upstream remote
git remote add upstream https://github.com/211211/extract-data-from-pdf-or-image-with-document-intelligence-and-chatgpt.git
```

---

## Development Setup

### Install Dependencies

```bash
yarn install
```

### Configure Environment

```bash
cp .env.example .env
# Edit .env with your Azure credentials
```

### Start Development Server

```bash
yarn start:dev
```

### Recommended VS Code Extensions

```json
// .vscode/extensions.json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "ms-azuretools.vscode-docker",
    "humao.rest-client",
    "firsttris.vscode-jest-runner"
  ]
}
```

### VS Code Settings

```json
// .vscode/settings.json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.preferences.importModuleSpecifier": "relative"
}
```

---

## Code Style

### TypeScript Guidelines

1. **Use strict TypeScript**
   ```typescript
   // Good
   function processDocument(file: Buffer): Promise<ExtractionResult> {}

   // Avoid
   function processDocument(file: any): any {}
   ```

2. **Prefer interfaces over types for objects**
   ```typescript
   // Good
   interface DocumentDto {
     id: string;
     content: string;
   }

   // Use types for unions/intersections
   type SearchResult = SemanticResult | VectorResult;
   ```

3. **Use meaningful variable names**
   ```typescript
   // Good
   const extractedBiomarkers = await extractBiomarkers(document);

   // Avoid
   const data = await extract(doc);
   ```

4. **Avoid magic numbers**
   ```typescript
   // Good
   const MAX_FILE_SIZE_MB = 50;
   const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

   // Avoid
   if (file.size > 52428800) {}
   ```

### NestJS Conventions

1. **One class per file**
   ```
   pdf-extractor.service.ts    # PdfExtractorService
   pdf-extractor.controller.ts # PdfExtractorController
   pdf-extractor.module.ts     # PdfExtractorModule
   ```

2. **Use dependency injection**
   ```typescript
   @Injectable()
   export class SearchService {
     constructor(
       private readonly embeddingProvider: EmbeddingProvider,
       private readonly configService: ConfigService,
     ) {}
   }
   ```

3. **DTOs for all endpoints**
   ```typescript
   // dto/search-query.dto.ts
   export class SearchQueryDto {
     @IsString()
     @MinLength(1)
     query: string;

     @IsOptional()
     @IsInt()
     @Min(1)
     @Max(100)
     top?: number = 10;
   }
   ```

### File Naming

| Type | Convention | Example |
|------|------------|---------|
| Service | `*.service.ts` | `search.service.ts` |
| Controller | `*.controller.ts` | `search.controller.ts` |
| Module | `*.module.ts` | `search.module.ts` |
| DTO | `*.dto.ts` | `document.dto.ts` |
| Interface | `*.interface.ts` | `completion.interface.ts` |
| Provider | `*.provider.ts` | `openai.provider.ts` |
| Test | `*.spec.ts` | `search.service.spec.ts` |
| E2E Test | `*.e2e-spec.ts` | `app.e2e-spec.ts` |

### ESLint Rules

```javascript
// .eslintrc.js
module.exports = {
  parser: '@typescript-eslint/parser',
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  rules: {
    '@typescript-eslint/explicit-function-return-type': 'warn',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
};
```

### Prettier Configuration

```json
// .prettierrc
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "semi": true
}
```

---

## Project Structure

### Directory Layout

```
src/
├── main.ts                 # Application entry point
├── app.module.ts           # Root module
├── app.controller.ts       # Root controller
├── app.service.ts          # Root service
│
├── config/                 # Configuration
│   ├── app.ts              # App config
│   └── index.ts
│
├── core/                   # Core modules
│   └── public/
│       ├── pdf-extractor/  # PDF extraction feature
│       │   ├── dto/
│       │   ├── interfaces/
│       │   ├── providers/
│       │   ├── services/
│       │   ├── pdf-extractor.module.ts
│       │   ├── pdf-extractor.controller.ts
│       │   ├── pdf-extractor.service.ts
│       │   └── prompt.ts
│       │
│       └── search/         # Search feature
│           ├── dto/
│           ├── search.module.ts
│           ├── search.controller.ts
│           ├── search.service.ts
│           └── indexer.service.ts
│
├── interceptor/            # HTTP interceptors
│   ├── error.interceptor.ts
│   └── parseUser.interceptor.ts
│
├── scripts/                # Maintenance scripts
│   ├── seed-index.ts
│   └── clear-index.ts
│
└── shared/                 # Shared utilities (create as needed)
    ├── types/
    ├── utils/
    └── constants/
```

### Module Structure

Each feature module should follow this structure:

```
feature/
├── dto/                    # Data Transfer Objects
│   └── feature.dto.ts
├── interfaces/             # TypeScript interfaces
│   └── feature.interface.ts
├── providers/              # External service clients
│   └── feature.provider.ts
├── services/               # Business logic
│   └── feature-logic.service.ts
├── feature.module.ts       # Module definition
├── feature.controller.ts   # HTTP endpoints
└── feature.service.ts      # Main service
```

---

## Making Changes

### Branch Naming

```
feature/add-streaming-support
bugfix/fix-file-upload-validation
docs/update-api-documentation
refactor/extract-embedding-service
```

### Development Workflow

1. **Create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make changes**
   - Write code
   - Add tests
   - Update documentation

3. **Lint and format**
   ```bash
   yarn lint
   yarn format
   ```

4. **Run tests**
   ```bash
   yarn test
   yarn test:e2e
   ```

5. **Commit changes**
   ```bash
   git add .
   git commit -m "feat: add streaming support for extraction"
   ```

6. **Push and create PR**
   ```bash
   git push origin feature/your-feature-name
   ```

---

## Testing

### Unit Tests

Location: Same directory as source file with `.spec.ts` extension.

```typescript
// search.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';

describe('SearchService', () => {
  let service: SearchService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        {
          provide: 'EMBEDDING_PROVIDER',
          useValue: {
            embed: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
          },
        },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('semanticSearch', () => {
    it('should return search results', async () => {
      const results = await service.semanticSearch('test query', 10);
      expect(results).toBeInstanceOf(Array);
    });
  });
});
```

### E2E Tests

Location: `test/` directory.

```typescript
// test/search.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('SearchController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/search/semantic (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/v1/search/semantic?query=test')
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('results');
      });
  });
});
```

### Running Tests

```bash
# Run all unit tests
yarn test

# Run tests in watch mode
yarn test:watch

# Run tests with coverage
yarn test:cov

# Run specific test file
yarn test search.service.spec.ts

# Run E2E tests
yarn test:e2e
```

### Test Coverage Requirements

- Minimum 80% coverage for new code
- All public methods should have tests
- Edge cases should be covered

---

## Pull Request Process

### Before Submitting

- [ ] Code follows style guidelines
- [ ] All tests pass
- [ ] New features have tests
- [ ] Documentation is updated
- [ ] No console.log statements
- [ ] No commented-out code
- [ ] Branch is up to date with main

### PR Template

```markdown
## Description
Brief description of changes.

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
Describe testing performed.

## Checklist
- [ ] Tests pass
- [ ] Linting passes
- [ ] Documentation updated
- [ ] No breaking changes (or documented)
```

### Review Process

1. Create PR against `main` branch
2. Automated checks run (lint, test, build)
3. Request review from maintainers
4. Address feedback
5. Squash and merge when approved

---

## Commit Guidelines

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Code style (formatting) |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `test` | Adding missing tests |
| `chore` | Changes to build process or auxiliary tools |

### Examples

```bash
# Feature
feat(search): add hybrid search combining semantic and vector

# Bug fix
fix(extraction): handle empty PDF files gracefully

# Documentation
docs(api): update search endpoint documentation

# Refactoring
refactor(providers): extract embedding logic to separate service

# Performance
perf(indexing): batch document uploads for better throughput
```

### Commit Best Practices

1. **Atomic commits**: One logical change per commit
2. **Present tense**: "Add feature" not "Added feature"
3. **Imperative mood**: "Move cursor to..." not "Moves cursor to..."
4. **No period** at the end of subject line
5. **72 characters** max for subject line

---

## Code Review Checklist

### For Authors

- [ ] Self-reviewed the code
- [ ] Added meaningful tests
- [ ] Updated relevant documentation
- [ ] Checked for security issues
- [ ] Verified no sensitive data in commits

### For Reviewers

- [ ] Code is readable and maintainable
- [ ] Tests are meaningful and pass
- [ ] No obvious security issues
- [ ] Documentation is accurate
- [ ] Changes align with project architecture

---

## Getting Help

- **Questions**: Open a GitHub Discussion
- **Bugs**: Open a GitHub Issue with reproduction steps
- **Features**: Open a GitHub Issue with use case description

Thank you for contributing!
