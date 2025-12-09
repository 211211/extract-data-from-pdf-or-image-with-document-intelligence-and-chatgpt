# MarkItDown Service Setup Guide

This guide explains how to set up and use the MarkItDown service, which wraps Microsoft's official [MarkItDown](https://github.com/microsoft/markitdown) Python library for document-to-Markdown conversion.

## Quick Start

```bash
# One-command setup (creates local virtual environment)
yarn setup:python
# or
./scripts/setup-python.sh
```

That's it! The service will automatically use the local `.venv` environment.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Node.js Application                                │
│  ┌────────────────────┐                                                     │
│  │  MarkItDownService │                                                     │
│  │  (TypeScript)      │                                                     │
│  └─────────┬──────────┘                                                     │
│            │                                                                 │
│            │ spawn child process                                            │
│            ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  .venv/bin/python markitdown_converter.py                            │   │
│  │  ┌─────────────────────────────────────────────────────────────┐    │   │
│  │  │  Microsoft MarkItDown (Official Python Library)              │    │   │
│  │  │  (installed in local .venv)                                  │    │   │
│  │  └─────────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Prerequisites

### Python 3.8+

Ensure Python 3 is installed:

```bash
python3 --version
# or
python --version
```

## Installation Options

### Option 1: Local Virtual Environment (Recommended)

This keeps dependencies isolated to the project:

```bash
# Run the setup script
./scripts/setup-python.sh

# This creates:
# - .venv/ directory with Python virtual environment
# - Installs markitdown from requirements.txt
```

The service automatically detects and uses `.venv/bin/python`.

### Option 2: Manual Setup

```bash
# Create virtual environment
python3 -m venv .venv

# Activate it
source .venv/bin/activate  # Linux/macOS
# or
.venv\Scripts\activate     # Windows

# Install dependencies
pip install -r requirements.txt
```

### Option 3: Global Installation (Not Recommended)

```bash
pip install markitdown
```

## Verify Installation

```bash
# Using the converter script
.venv/bin/python scripts/markitdown_converter.py --check

# Expected output:
# {"installed": true}
```

## Supported File Formats

| Category | Formats | Recommendation |
|----------|---------|----------------|
| **Office Documents** | Word (.docx), Excel (.xlsx), PowerPoint (.pptx) | ✅ **Use MarkItDown** |
| **Web/Text** | HTML, TXT, CSV, XML, JSON, Markdown, RST | ✅ **Use MarkItDown** |
| **PDFs** | PDF (.pdf) | ⚠️ **Use Azure Document Intelligence** for best results |
| **Images** | JPEG, PNG, GIF, BMP, TIFF | ⚠️ **Use Azure Document Intelligence** for OCR |
| **Audio** | MP3, WAV, M4A (metadata only) | ✅ **Use MarkItDown** |

> **Best Practice**: Use MarkItDown for Office documents and text files. Use Azure Document Intelligence for PDFs and images requiring OCR.

## Usage

### Basic Usage in NestJS

```typescript
import { MarkItDownService } from './markitdown.service';

@Injectable()
export class DocumentService {
  constructor(private readonly markItDown: MarkItDownService) {}

  async processDocument(filePath: string) {
    // Check if service is available
    if (!this.markItDown.isServiceAvailable()) {
      throw new Error('MarkItDown not installed');
    }

    // Convert file to markdown
    const result = await this.markItDown.convertFile(filePath);

    if (result.success) {
      console.log(result.markdown);
    } else {
      console.error(result.error);
    }
  }
}
```

### Convert from Buffer (e.g., file upload)

```typescript
async handleUpload(file: Express.Multer.File) {
  const result = await this.markItDown.convertMulterFile(file);

  if (result.success) {
    return {
      markdown: result.markdown,
      fileName: result.fileName,
    };
  }
}
```

### Convert from Buffer with Extension

```typescript
const pdfBuffer = fs.readFileSync('document.pdf');
const result = await this.markItDown.convertBuffer(pdfBuffer, '.pdf');
```

## Data Flow

```
                                    Document Conversion Flow
                                    ========================

┌──────────────┐      ┌───────────────────┐      ┌────────────────────┐
│   Input      │      │  MarkItDownService │      │  Python Script     │
│   Document   │      │  (Node.js)         │      │  (markitdown)      │
└──────┬───────┘      └─────────┬─────────┘      └──────────┬─────────┘
       │                        │                           │
       │  1. File/Buffer        │                           │
       │─────────────────────────                           │
       │                        │                           │
       │                        │  2. Write temp file       │
       │                        │     (if buffer)           │
       │                        │                           │
       │                        │  3. Spawn Python process  │
       │                        │─────────────────────────────
       │                        │                           │
       │                        │                           │  4. Load MarkItDown
       │                        │                           │
       │                        │                           │  5. Convert document
       │                        │                           │     - PDF → extract text
       │                        │                           │     - DOCX → parse XML
       │                        │                           │     - XLSX → table→MD
       │                        │                           │     - Images → OCR
       │                        │                           │
       │                        │  6. Return JSON result    │
       │                        │◄────────────────────────────
       │                        │                           │
       │                        │  7. Parse JSON            │
       │                        │                           │
       │  8. MarkItDownResult   │                           │
       │◄────────────────────────                           │
       │                        │                           │
       │  {                     │                           │
       │    success: true,      │                           │
       │    markdown: "# ...",  │                           │
       │    fileName: "doc.pdf" │                           │
       │  }                     │                           │
       │                        │                           │
```

## Integration with Chunking Pipeline

The MarkItDown service integrates with the MarkdownChunker for RAG workflows:

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────────┐
│  DOCX/XLSX/  │     │  MarkItDown     │     │  MarkdownChunker │
│  PPTX Upload │────▶│  Service        │────▶│  Service         │
└──────────────┘     └─────────────────┘     └──────────────────┘
                            │                        │
                            ▼                        ▼
                     ┌─────────────┐          ┌─────────────┐
                     │  Markdown   │          │ Chunks with │
                     │  Content    │          │ Metadata    │
                     └─────────────┘          └─────────────┘
                                                     │
                                                     ▼
                                             ┌─────────────────┐
                                             │  Vector Store   │
                                             │  (Embeddings)   │
                                             └─────────────────┘
```

### Example: Complete Pipeline

```typescript
import { MarkItDownService } from './markitdown.service';
import { chunkDocumentWithMetadata } from './markdown-chunker';
import { indexDocuments } from './azure-cog-vector-store';

async function processAndIndexDocument(file: Express.Multer.File) {
  // Step 1: Convert to Markdown
  const conversion = await markItDownService.convertMulterFile(file);

  if (!conversion.success) {
    throw new Error(`Conversion failed: ${conversion.error}`);
  }

  // Step 2: Chunk the markdown
  const chunking = await chunkDocumentWithMetadata(
    conversion.markdown,
    conversion.fileName
  );

  if (chunking.exceedsLimit) {
    throw new Error('Document too large');
  }

  // Step 3: Index chunks
  const documents = chunking.chunks.map((chunk, idx) => ({
    id: `${file.originalname}-${idx}`,
    pageContent: chunk.content,
    metadata: JSON.stringify(chunk.metadata),
    // ... other fields
  }));

  await indexDocuments(documents);
}
```

## CLI Usage

The Python script can also be used directly from the command line:

```bash
# Convert and print to stdout
python3 scripts/markitdown_converter.py document.pdf

# Convert and save to file
python3 scripts/markitdown_converter.py document.pdf --output result.md

# Get JSON output (for scripting)
python3 scripts/markitdown_converter.py document.pdf --json

# Check if markitdown is installed
python3 scripts/markitdown_converter.py --check
```

## Troubleshooting

### "MarkItDown is not available"

```bash
# Install markitdown
pip install markitdown

# Verify installation
python3 -c "from markitdown import MarkItDown; print('OK')"
```

### "Python not found"

The service tries `python3` first, then `python`. Ensure one is in your PATH:

```bash
which python3
# or
which python
```

### Conversion Timeout

For large files, increase the timeout:

```typescript
const result = await markItDown.convertFile(filePath, {
  timeout: 120000, // 2 minutes
});
```

### OCR Not Working for Images

Install Tesseract for image OCR support:

```bash
# macOS
brew install tesseract

# Ubuntu/Debian
sudo apt-get install tesseract-ocr

# Windows
# Download from: https://github.com/UB-Mannheim/tesseract/wiki
```

## Configuration Options

```typescript
interface MarkItDownOptions {
  /** Python executable path (default: 'python3' or 'python') */
  pythonPath?: string;

  /** Enable MarkItDown plugins */
  enablePlugins?: boolean;

  /** Timeout in milliseconds (default: 60000) */
  timeout?: number;
}
```

## Comparison with Azure Document Intelligence

| Feature | MarkItDown | Azure Document Intelligence |
|---------|------------|----------------------------|
| **Deployment** | Local (Python) | Cloud (Azure) |
| **Cost** | Free | Pay-per-use |
| **Best For** | Office docs (DOCX, XLSX, PPTX) | PDFs, scanned docs, images |
| **OCR Quality** | Good (Tesseract) | Excellent |
| **Table Extraction** | Basic | Advanced |
| **Handwriting** | Limited | Excellent |
| **Speed** | Fast (local) | Network latency |

### Recommendation

- Use **MarkItDown** for: Word (.docx), Excel (.xlsx), PowerPoint (.pptx), HTML, simple text files
- Use **Azure Document Intelligence** for: **All PDFs** (especially complex layouts, scanned documents), images with OCR, handwriting

> **Note**: While MarkItDown supports PDF conversion, Azure Document Intelligence provides significantly better results for PDFs with complex layouts, tables, multi-column text, or scanned content.
