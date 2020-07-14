import { Runner } from 'analysis/runner';
import { env } from 'process';
import { spawn } from 'child-process-promise';
import { format } from 'util';

export class OctaveAnalysisRunner implements Runner {
  async run(input: string, outputFolder: string, _output: string): Promise<any> {
    
    return new Promise<any>((resolve, reject) => {

      const secondParam = format(env.OCTAVE_PARAM2, input, outputFolder);

      console.log(`Running Octave with arguments: ${env.OCTAVE_PARAM1} and ${secondParam}`);

      spawn(env.OCTAVE_SCRIPT_FILE, [env.OCTAVE_PARAM1, secondParam], { 
        capture: [ 'stdout', 'stderr' ],
        cwd: env.OCTAVE_WORKING_DIR
      })
      .then(function (result) {
        resolve(result.stdout.toString());
      })
      .catch(function (err) {
        reject(err.stderr);
      });
    });
  }
}

