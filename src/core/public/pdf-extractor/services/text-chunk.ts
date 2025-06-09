import { LatexTextSplitter, MarkdownTextSplitter, RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
const chunkSize = 2500; // Adjusted to a higher value with buffer for token limit
const chunkOverlap = 300; // Increased overlap to preserve context with larger chunks

// Function to detect content type (simplified, you can expand this logic)
function detectContentType(document: string): string {
  if (document.includes('# ') || document.includes('- ')) return 'markdown';
  if (document.includes('\\begin{') || document.includes('$')) return 'latex';
  return 'plain';
}

// Choose splitter based on content type
function getTextSplitter(contentType: string, chunkSize: number, chunkOverlap: number) {
  switch (contentType) {
    case 'markdown':
      return new MarkdownTextSplitter({ chunkSize, chunkOverlap });
    case 'latex':
      return new LatexTextSplitter({ chunkSize, chunkOverlap });
    default:
      return new RecursiveCharacterTextSplitter({ chunkSize, chunkOverlap });
  }
}

// Function to chunk document with overlap
export async function chunkDocumentWithOverlap(document: string): Promise<string[]> {
  // Detect content type and choose splitter
  const contentType = detectContentType(document);

  // Use appropriate text splitter based on content type
  const chunks = await getTextSplitter(contentType, chunkSize, chunkOverlap).splitText(document);

  return chunks;
}
