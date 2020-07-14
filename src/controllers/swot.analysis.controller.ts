import { Request, Response } from 'express'
import { PythonAnalysisRunner } from '../analysis/python/python.runner';
import { OctaveAnalysisRunner } from '../analysis/octave/octave.runner';
import { BlobStorage } from '../storage/blob.service';
import { env } from 'process';
import { join, basename } from 'path';
import { readFileSync, readdir, unlinkSync, existsSync, mkdirSync, unlink  } from 'fs';
import * as mailer from '../utils/mailer';
import * as rimraf from 'rimraf';
import { AnalysisReport } from '../utils/report';
import { MongoClient, ObjectId } from 'mongodb';

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
    res.json({processing: 'true'});

    let octaveOutput = "";
    // download raw data to local folder
    const storage = new BlobStorage();
    await storage.download(process.env.AZURE_DOWNLOAD_CONTAINER, req.query.filename, join(process.env.AZURE_DOWNLOAD_LOCAL_FOLDER, req.query.filename));

    try {
      try {
        // analyze python
        let content = await this.analyzePython(req.query.filename, req.query.country, req.query.project, req.query.fieldsite, req.query.dataset);
       	const reportImage = join(process.env.PYTHON_OUTPUT_FOLDER, req.query.filename.replace('.csv', '.png'));
        // email results to recipient - disabled in favor of consolidated report
        // mailer.mailUser(req.query.recipient, process.env.PYTHON_EMAIL_SUBJECT, content, reportImage);
      } catch (e) {
        // mailer.mailUser(req.query.recipient, process.env.PYTHON_EMAIL_SUBJECT + ' - ERROR', 'There was an error running the python analysis of this data. Please contact the administrator ( admin@safeh2o.app ) for more information.', null);
        mailer.mailAdmin(`Error occurred during Python analysis for : ${JSON.stringify(e)}. Query: ${JSON.stringify(req.query)}`);
      }
      try {
        octaveOutput = await this.analyzeOctave(req.query.filename, req.query.country, req.query.project, req.query.fieldsite, req.query.dataset, req.query.recipient);
      } catch (e) {
        // mailer.mailUser(req.query.recipient, process.env.OCTAVE_EMAIL_SUBJECT + ' - ERROR', 'There was an error running the octave analysis of this data. Please contact the administrator ( admin@safeh2o.app ) for more information.', null);
        mailer.mailAdmin(`Error occurred during Octave analysis for : ${JSON.stringify(e)}. Query: ${JSON.stringify(req.query)}`);
      }

      // for debugging only, uncomment the next line to simulate octave output
      // octaveOutput = 'FRC=1.2';

      try {
        const report = new AnalysisReport();
        const reportDataLines = readFileSync(join(process.env.AZURE_DOWNLOAD_LOCAL_FOLDER, req.query.filename), "utf8").split('\n').length;
        const webSkipped = await this.getSkippedRows(req.query.dataset);
      
        await report.pdf({
          pythonFolder: process.env.PYTHON_OUTPUT_FOLDER,
          octaveFolder: process.env.OCTAVE_OUTPUT_FOLDER,
          outputFolder: process.env.PYTHON_OUTPUT_FOLDER,
          filename: req.query.filename.replace('.csv', ''),
          reportDate: new Date(Date.now()).toLocaleDateString("en-CA"),
          countryName: this.parseBeforeDash(req.query.country),
          projectName: this.parseBeforeDash(req.query.project),
          fieldSiteName: this.parseBeforeDash(req.query.fieldsite),
          datasetName: req.query.filename.split("__")[0],
          numSamples: (reportDataLines - 1).toString(),
          numOptimize: req.query.filename.split("__")[req.query.filename.split("__").length-2],
          confidenceLevel: this.getConfidenceLevel(req.query.filename.split("__")[req.query.filename.split("__").length-1].replace('.csv', '')),
          octaveOutput: octaveOutput,
          webSkipped: webSkipped
        });
        const pdfFilename = req.query.filename.replace('.csv', '.pdf');
        await storage.save(req.query.country, `${req.query.project}/${req.query.fieldsite}/${req.query.dataset}/analysis/${pdfFilename}`, join(process.env.PYTHON_OUTPUT_FOLDER, pdfFilename));
        mailer.mailUser(req.query.recipient, process.env.EMAIL_SUBJECT, process.env.EMAIL_BODY, join(process.env.PYTHON_OUTPUT_FOLDER, pdfFilename));

      } catch (e) {
        console.log("Error while creating and emailing consolidated report", e);
        mailer.mailUser(req.query.recipient, process.env.EMAIL_SUBJECT + ' - ERROR', 'There was an error mailing the analysis of this data. Please contact the administrator ( admin@safeh2o.app ) for more information.', null);
        mailer.mailAdmin(`Error occurred while e-mailing analysis for : ${JSON.stringify(e)}. Query: ${JSON.stringify(req.query)}`);
      }
    } finally {
      this.cleanUpFiles(req.query.filename);
    }
  }

  public async getSkippedRows(datasetId: string) {
    const url = process.env.MONGO_DB_CONNECTION_STRING;
    const client = await MongoClient.connect(url, {useUnifiedTopology: true});
    
    const db = await client.db();
    const collection = await db.collection('datasets')
    const query = {'_id': ObjectId(datasetId)}

    const dataset = await collection.findOne(query);

    client.close();

    return dataset.skippedRows;
  }

  private parseBeforeDash(str: string) {
    if (str.indexOf('-') != -1) {
      return str.split('-')[0];
    } else return str;
  }

  private getConfidenceLevel(level) {
    if (level == 'minDecay') return 'Minimum Decay Scenario';
    if (level == 'optimumDecay') return 'Optimum/Balanced Decay Scenario';
    if (level == 'maxDecay') return 'Maximum Decay Scenario';
    return 'Unknown';
  }
  public cleanUpFiles(filename) {
    this.tryDelete(join(process.env.AZURE_DOWNLOAD_LOCAL_FOLDER, filename));
    this.tryDelete(join(process.env.PYTHON_OUTPUT_FOLDER, filename));
    this.tryDelete(join(process.env.PYTHON_OUTPUT_FOLDER, filename.replace('.csv', '.html')));
    this.tryDelete(join(process.env.PYTHON_OUTPUT_FOLDER, filename.replace('.csv', '.png')));
    this.tryDelete(join(process.env.PYTHON_OUTPUT_FOLDER, filename.replace('.csv', '-frc.jpg')));
    this.tryDelete(join(process.env.PYTHON_OUTPUT_FOLDER, filename.replace('.csv', '.pdf')));
    rimraf.sync(join(env.OCTAVE_OUTPUT_FOLDER, filename));
  }

  private tryDelete(filename) {
    try {
      unlinkSync(filename);
    } catch(e) {
      console.log(`Error deleting file ${filename}`, e);
    }
  }

  public async analyzePython(name: string, country, project, fieldsite, dataset): Promise<string> {
    return new Promise<any>(async (resolve, reject) => {
      const storage = new BlobStorage();
      const runner = new PythonAnalysisRunner();
      const nameHTML = name.replace('.csv', '.html');
      const nameHTMLInFolder = join(process.env.PYTHON_OUTPUT_FOLDER, nameHTML);
      const reportImage = name.replace('.csv', '.png');
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
      let octaveOutput = "";
      const outputFolder = join(env.OCTAVE_OUTPUT_FOLDER, name);
      if (!existsSync(outputFolder)) {
        mkdirSync(outputFolder);
      }

      try {
        octaveOutput = await runner.run(join(process.env.AZURE_DOWNLOAD_LOCAL_FOLDER, name), outputFolder, name);

        readdir(outputFolder, function (err, files) {
          if (err) {
              return ('Unable to scan directory: ' + err);
          }
          files.forEach(async function (file) {
            await storage.save(country, `${project}/${fieldsite}/${dataset}/analysis/octave/${basename(file)}`, join(outputFolder, file));
          });
        });
        // disabled in favor of consolidated report
        //await mailer.mailAllFilesInFolder(outputFolder, recipient, process.env.FROM_ADDRESS, process.env.OCTAVE_EMAIL_SUBJECT, 'Please find analysis results attached.');
      } catch (e) {
        reject(e);
      }
      resolve(octaveOutput);
    });
  }
}

export const swotAnalysisController = new SwotAnalysisController()
