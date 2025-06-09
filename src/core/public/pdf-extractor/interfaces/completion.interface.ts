export interface ICompletionService {
  chatCompletion(analysisResult: any): Promise<string>;
}
