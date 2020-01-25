import { Request, Response } from 'express'
import { PythonAnalysisRunner } from '../analysis/python/python.runner';
import { OctaveAnalysisRunner } from '../analysis/octave/octave.runner';
import { BlobStorage } from '../storage/blob.service';
import { env } from 'process';
import { join, basename } from 'path';
import { readFileSync, readdir, unlinkSync } from 'fs';
import * as mailer from '../utils/mailer';
import { existsSync, mkdirSync } from 'fs';
import * as rimraf from 'rimraf';

export default class SwotAnalysisController {

  public async index(req: Request, res: Response, next: Function): Promise<void> {

    console.log(`Received a request with parameters: ${JSON.stringify(req.query)}`);

    // Request parameters:
    // filename=${filename}&recipient=${recipientEmail}&country=${country}&project=${project}&fieldsite=${fieldsite}&dataset=${datasetId}

    if (!req.query.filename || !req.query.recipient || !req.query.dataset ||
        !req.query.country || !req.query.project || !req.query.fieldsite) {
      res.status(400).send('Missing one of the parameters: filename, recipient, country, project, fieldsite, dataset');
      return;
    }

    // download raw data to local folder
    const storage = new BlobStorage();
    await storage.download(process.env.AZURE_DOWNLOAD_CONTAINER, req.query.filename, join(process.env.AZURE_DOWNLOAD_LOCAL_FOLDER, req.query.filename));

    try {
      try {
        // analyze python
        let content = await this.analyzePython(req.query.filename, req.query.country, req.query.project, req.query.fieldsite, req.query.dataset);
	       const reportImage = join(process.env.PYTHON_OUTPUT_FOLDER, req.query.filename.replace('.csv', '.jpg'));
        // email results to recipient
        mailer.mailUser(req.query.recipient, process.env.PYTHON_EMAIL_SUBJECT, content, reportImage);
      } catch (e) {
        mailer.mailUser(req.query.recipient, process.env.PYTHON_EMAIL_SUBJECT + ' - ERROR', 'There was an error running the python analysis of this data. Please contact the administrator ( admin@safeh2o.app ) for more information.', null);
        mailer.mailAdmin(`Error occurred during Python analysis for : ${JSON.stringify(e)}. Query: ${JSON.stringify(req.query)}`);
      }
      try {
        await this.analyzeOctave(req.query.filename, req.query.country, req.query.project, req.query.fieldsite, req.query.dataset, req.query.recipient);
      } catch (e) {
        mailer.mailUser(req.query.recipient, process.env.OCTAVE_EMAIL_SUBJECT + ' - ERROR', 'There was an error running the octave analysis of this data. Please contact the administrator ( admin@safeh2o.app ) for more information.', null);
        mailer.mailAdmin(`Error occurred during Octave analysis for : ${JSON.stringify(e)}. Query: ${JSON.stringify(req.query)}`);
      }
    } finally {
      this.cleanUpFiles(req.query.filename);
    }

    res.json({processing: 'true'});
  }

  public cleanUpFiles(filename) {
    unlinkSync(join(process.env.AZURE_DOWNLOAD_LOCAL_FOLDER, filename));
    unlinkSync(join(process.env.PYTHON_OUTPUT_FOLDER, filename));
    unlinkSync(join(process.env.PYTHON_OUTPUT_FOLDER, filename.replace('.csv', '.html')));
    unlinkSync(join(process.env.PYTHON_OUTPUT_FOLDER, filename.replace('.csv', '.jpg')));
    rimraf.sync(join(env.OCTAVE_OUTPUT_FOLDER, filename));
  }

  public async analyzePython(name: string, country, project, fieldsite, dataset): Promise<string> {
    return new Promise<any>(async (resolve, reject) => {
      const storage = new BlobStorage();
      const runner = new PythonAnalysisRunner();
      const nameHTML = name.replace('.csv', '.html');
      const nameHTMLInFolder = join(process.env.PYTHON_OUTPUT_FOLDER, nameHTML);
      const reportImage = name.replace('.csv', '.jpg');
      const reportImageInFolder = join(process.env.PYTHON_OUTPUT_FOLDER, reportImage);
      try {
        await runner.run(join(process.env.AZURE_DOWNLOAD_LOCAL_FOLDER, name), process.env.PYTHON_OUTPUT_FOLDER, name);
        // const storageResultCSV = await storage.save("swot-analysis-python", nameCSV, join(env.PYTHON_WORKING_DIR, nameCSV));
        // save in country/project/fieldsite/dataset_id/analysis/python
        const pythonResults = await storage.save(country, `${project}/${fieldsite}/${dataset}/analysis/python/${nameHTML}`, nameHTMLInFolder);
        await storage.save(country, `${project}/${fieldsite}/${dataset}/analysis/python/${reportImage}`, reportImageInFolder);
      } catch (e) {
        reject(e);
      }
      // console.log(`Python results are : ${pythonResults}`);
      let content = readFileSync(nameHTMLInFolder, {encoding: 'utf8'});
      resolve(content);
    });
  }

  public async analyzeOctave(name: string, country, project, fieldsite, dataset, recipient): Promise<any> {
    return new Promise<any>(async (resolve, reject) => {
      const storage = new BlobStorage();
      const runner = new OctaveAnalysisRunner();

      const outputFolder = join(env.OCTAVE_OUTPUT_FOLDER, name);
      if (!existsSync(outputFolder)) {
        mkdirSync(outputFolder);
      }

      try {
        await runner.run(join(process.env.AZURE_DOWNLOAD_LOCAL_FOLDER, name), outputFolder, name);

        readdir(outputFolder, function (err, files) {
          if (err) {
              return ('Unable to scan directory: ' + err);
          }
          files.forEach(async function (file) {
            await storage.save(country, `${project}/${fieldsite}/${dataset}/analysis/octave/${basename(file)}`, join(outputFolder, file));
          });
        });

        await mailer.mailAllFilesInFolder(outputFolder, recipient, process.env.FROM_ADDRESS, process.env.OCTAVE_EMAIL_SUBJECT, 'Please find analysis results attached.');
      } catch (e) {
        reject(e);
      }
      resolve(outputFolder);
    });
  }
}

export const swotAnalysisController = new SwotAnalysisController()
