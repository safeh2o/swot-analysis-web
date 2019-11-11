export interface Runner {
  run(input: string, outputFolder: string, output: string): Promise<any>;
}