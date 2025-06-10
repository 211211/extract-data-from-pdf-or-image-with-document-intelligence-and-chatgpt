export interface DocumentAnalysisConfig {
  modelId: 'prebuilt-layout' | 'prebuilt-read';
  outputContentFormat: 'markdown' | 'text'; // Output format for content
  features?: string[]; // Optional features like 'ocr.highResolution'
  apiVersion?: string; // Optional API version, e.g., '2024-11-30'
}
