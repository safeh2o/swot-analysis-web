import { PythonShell, Options } from 'python-shell';
import { Runner } from 'analysis/runner';
import { env } from 'process';
import { join } from 'path';

export class PythonAnalysisRunner implements Runner {
  async run(inputFile: string, outputFolder: string, outputFile: string): Promise<any> {
    const options: Options = {
      mode: "text",
      pythonPath: env.PYTHON_PATH,
      pythonOptions: ['-u'],
      scriptPath: env.PYTHON_WORKING_DIR,
      cwd: env.PYTHON_WORKING_DIR,
      args: [inputFile, env.PYTHON_SCRIPT_ARG2, join(outputFolder, outputFile),  join(outputFolder, outputFile.replace(".csv", ".html"))],
    };
    
    console.log("Running Python with arguments: ", options.args);

    return new Promise<any[]>((resolve, reject) => {
      PythonShell.run(env.PYTHON_SCRIPT_FILE, options, (err, results) => {
        if (err) {
          console.error('Error occurred while running Python script', err.stack);
          reject(err.stack);
        } else {
          resolve(results);
        }
      });  
    });
  }
}

