export interface IGptCompletionService {
  completeWithGPT(analysisResult: any): Promise<string>;
}
