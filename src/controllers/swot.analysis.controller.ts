import { Request, Response } from 'express'
import { PythonAnalysisRunner } from '../analysis/python/python.runner'
import { OctaveAnalysisRunner } from '../analysis/octave/octave.runner'
import { BlobStorage } from '../storage/blob.service'
import { env } from 'process'
import { join, basename } from 'path'
import {
  readFileSync,
  readdir,
  unlinkSync,
  existsSync,
  mkdirSync,
  unlink,
  readFile,
} from 'fs'
import * as mailer from '../utils/mailer'
import * as rimraf from 'rimraf'
import { AnalysisReport } from '../utils/report'
import { MongoClient, ObjectId } from 'mongodb'

export default class SwotAnalysisController {
  public async index(
    req: Request,
    res: Response,
    next: Function
  ): Promise<void> {
    const debug = env.DEBUG?.toUpperCase() != 'FALSE'

    console.log(
      `Received a request with parameters: ${JSON.stringify(req.query)}`
    )

    // Request parameters:
    // filename=${filename}&recipient=${recipientEmail}&country=${country}&project=${project}&fieldsite=${fieldsite}&dataset=${datasetId}

    if (
      !req.query.filename ||
      !req.query.recipient ||
      !req.query.dataset ||
      !req.query.country ||
      !req.query.project ||
      !req.query.fieldsite
    ) {
      res
        .status(400)
        .send(
          'Missing one of the parameters: filename, recipient, country, project, fieldsite, dataset'
        )
      return
    }
    res.json({ processing: 'true' })

    let pythonRun: Promise<string>, octaveRun: Promise<string>
    // download raw data to local folder
    const storage = new BlobStorage()
    // allow prefixes to saved file name for debugging purposes
    const prefix = req.query.prefix ? req.query.prefix + '-' : ''
    const filename = prefix + req.query.filename
    await storage.download(
      process.env.AZURE_DOWNLOAD_CONTAINER,
      req.query.filename.toString(),
      join(process.env.AZURE_DOWNLOAD_LOCAL_FOLDER, filename)
    )

    let currDate: number
    currDate = new Date().getTime()

    // analyze python
    pythonRun = this.analyzePython(
      filename,
      req.query.country.toString(),
      req.query.project.toString(),
      req.query.fieldsite.toString(),
      req.query.dataset.toString()
    ).catch(err => {
      console.error(
        `Error occurred during Python analysis for: ${JSON.stringify(
          err
        )}. Query: ${JSON.stringify(req.query)}`
      )
      mailer.mailAdmin(
        `Error occurred during Python analysis for : ${JSON.stringify(
          err
        )}. Query: ${JSON.stringify(req.query)}`
      )
      return ''
    })

    // analyze octave
    octaveRun = this.analyzeOctave(
      filename,
      req.query.country.toString(),
      req.query.project.toString(),
      req.query.fieldsite.toString(),
      req.query.dataset.toString(),
      req.query.recipient.toString()
    ).catch(err => {
      console.error(
        `Error occurred during Octave analysis for: ${JSON.stringify(
          err
        )}. Query: ${JSON.stringify(req.query)}`
      )
      mailer.mailAdmin(
        `Error occurred during Octave analysis for: ${JSON.stringify(
          err
        )}. Query: ${JSON.stringify(req.query)}`
      )
      return '0.0'
    })

    Promise.all([pythonRun, octaveRun])
      .then(async ([_, octaveOutput]) => {
        try {
          // for debugging only, uncomment the next line to simulate octave output if needed
          if (debug && !octaveRun) {
            octaveOutput = 'FRC=1.2'
          }
          const report = new AnalysisReport()
          const reportDataLines = readFileSync(
            join(process.env.AZURE_DOWNLOAD_LOCAL_FOLDER, filename),
            'utf8'
          ).split('\n').length
          const webSkipped = await this.getSkippedRows(
            req.query.dataset.toString()
          )

          const pdfData = {
            pythonFolder: process.env.PYTHON_OUTPUT_FOLDER,
            octaveFolder: process.env.OCTAVE_OUTPUT_FOLDER,
            outputFolder: process.env.PYTHON_OUTPUT_FOLDER,
            filename: filename.replace('.csv', ''),
            reportDate: new Date(Date.now()).toLocaleDateString('en-CA'),
            countryName: this.parseBeforeDash(req.query.country.toString()),
            projectName: this.parseBeforeDash(req.query.project.toString()),
            fieldSiteName: this.parseBeforeDash(req.query.fieldsite.toString()),
            datasetName: filename.split('__')[0],
            numSamples: (reportDataLines - 2).toString(),
            numOptimize: filename.split('__')[filename.split('__').length - 2],
            confidenceLevel: this.getConfidenceLevel(
              filename
                .split('__')
                [filename.split('__').length - 1].replace('.csv', '')
            ),
            octaveOutput: octaveOutput,
            webSkipped: webSkipped,
          }

          await report.pdf(pdfData)
          const pdfFilename = filename.replace('.csv', '.pdf')
          const containerName =req.query.country.toString();
          const blobName = `${req.query.project.toString()}/${req.query.fieldsite.toString()}/${req.query.dataset.toString()}/analysis/${pdfFilename}`;
          await storage.save(
            containerName,
            blobName,
            join(process.env.PYTHON_OUTPUT_FOLDER, pdfFilename)
          )
          await updateDatabase(req.query.dataset, containerName, blobName);
          mailer.mailUser(
            req.query.recipient.toString(),
            process.env.EMAIL_SUBJECT,
            process.env.EMAIL_BODY,
            join(process.env.PYTHON_OUTPUT_FOLDER, pdfFilename)
          )
        } catch (e) {
          console.log(
            'Error while creating and emailing consolidated report',
            e
          )
          mailer.mailUser(
            req.query.recipient.toString(),
            process.env.EMAIL_SUBJECT + ' - ERROR',
            `There was an error with the analysis of a dataset you recently uploaded (${filename}). Please contact the administrator (admin@safeh2o.app) for more information.`,
            null
          )
          mailer.mailAdmin(
            `Error occurred while e-mailing analysis for: ${JSON.stringify(
              e
            )}. Query: ${JSON.stringify(req.query)}`
          )
        } finally {
          const delta = new Date().getTime() - currDate
          if (debug) {
            console.log(delta)
          } else {
            this.cleanUpFiles(filename)
          }
        }
      })
      .catch(error => {
        console.error(
          `Error occurred during analysis for: ${JSON.stringify(
            error
          )}. Query: ${JSON.stringify(req.query)}`
        )
        mailer.mailAdmin(
          `Error occurred during analysis for: ${JSON.stringify(
            error
          )}. Query: ${JSON.stringify(req.query)}`
        )
      })

    next()
  }

  public async getSkippedRows(datasetId: string) {
    const url = process.env.MONGO_DB_CONNECTION_STRING
    const client = await MongoClient.connect(url, { useUnifiedTopology: true })

    const db = await client.db()
    const collection = await db.collection('datasets')
    const query = { _id: new ObjectId(datasetId) }

    const dataset = await collection.findOne(query)

    client.close()

    return dataset.skippedRows
  }

  private parseBeforeDash(str: string) {
    if (str.indexOf('-') != -1) {
      return str.split('-')[0]
    } else return str
  }

  private getConfidenceLevel(level) {
    if (level == 'minDecay') return 'Minimum Decay Scenario'
    if (level == 'optimumDecay') return 'Optimum/Balanced Decay Scenario'
    if (level == 'maxDecay') return 'Maximum Decay Scenario'
    return 'Unknown'
  }
  public cleanUpFiles(filename: string) {
    this.tryDelete(join(process.env.AZURE_DOWNLOAD_LOCAL_FOLDER, filename))
    this.tryDelete(join(process.env.PYTHON_OUTPUT_FOLDER, filename))
    this.tryDelete(
      join(process.env.PYTHON_OUTPUT_FOLDER, filename.replace('.csv', '.html'))
    )
    this.tryDelete(
      join(process.env.PYTHON_OUTPUT_FOLDER, filename.replace('.csv', '.png'))
    )
    this.tryDelete(
      join(
        process.env.PYTHON_OUTPUT_FOLDER,
        filename.replace('.csv', '-frc.jpg')
      )
    )
    this.tryDelete(
      join(process.env.PYTHON_OUTPUT_FOLDER, filename.replace('.csv', '.pdf'))
    )
    rimraf.sync(join(env.OCTAVE_OUTPUT_FOLDER, filename))
  }

  private tryDelete(filename) {
    try {
      unlinkSync(filename)
    } catch (e) {
      console.log(`Error deleting file ${filename}`, e)
    }
  }

  public async analyzePython(
    name: string,
    country: string,
    project: string,
    fieldsite: string,
    dataset: string
  ): Promise<string> {
    return new Promise<any>(async (resolve, reject) => {
      const storage = new BlobStorage()
      const runner = new PythonAnalysisRunner()
      const nameHTML = name.replace('.csv', '.html')
      const nameHTMLInFolder = join(process.env.PYTHON_OUTPUT_FOLDER, nameHTML)
      const reportImage = name.replace('.csv', '.png')
      const reportImageInFolder = join(
        process.env.PYTHON_OUTPUT_FOLDER,
        reportImage
      )

      runner
        .run(
          join(process.env.AZURE_DOWNLOAD_LOCAL_FOLDER, name),
          process.env.PYTHON_OUTPUT_FOLDER,
          name
        )
        .then(() => {
          // save in country/project/fieldsite/dataset_id/analysis/python
          storage.save(
            country,
            `${project}/${fieldsite}/${dataset}/analysis/python/${nameHTML}`,
            nameHTMLInFolder
          )
          storage.save(
            country,
            `${project}/${fieldsite}/${dataset}/analysis/python/${reportImage}`,
            reportImageInFolder
          )

          readFile(nameHTMLInFolder, { encoding: 'utf-8' }, content => {
            resolve(content)
          })
        })
        .catch(err => {
          reject(err)
        })

      // console.log(`Python results are : ${pythonResults}`);
      // let content = readFileSync(nameHTMLInFolder, {encoding: 'utf8'});
    })
  }

  public async analyzeOctave(
    name: string,
    country: string,
    project: string,
    fieldsite: string,
    dataset: string,
    recipient: string
  ): Promise<any> {
    return new Promise<any>(async (resolve, reject) => {
      const storage = new BlobStorage()
      const runner = new OctaveAnalysisRunner()
      const outputFolder = join(env.OCTAVE_OUTPUT_FOLDER, name)
      if (!existsSync(outputFolder)) {
        mkdirSync(outputFolder)
      }

      // octaveOutput = await runner.run(join(process.env.AZURE_DOWNLOAD_LOCAL_FOLDER, name), outputFolder, name);
      runner
        .run(
          join(process.env.AZURE_DOWNLOAD_LOCAL_FOLDER, name),
          outputFolder,
          name
        )
        .then(octaveOutput => {
          const promises = []
          readdir(outputFolder, (err, files) => {
            if (err) {
              return 'Unable to scan directory: ' + err
            }
            files.forEach(file => {
              promises.push(
                storage.save(
                  country,
                  `${project}/${fieldsite}/${dataset}/analysis/octave/${basename(
                    file
                  )}`,
                  join(outputFolder, file)
                )
              )
            })
          })

          // wait for all files to upload before generating report
          Promise.all(promises).then(() => {
            resolve(octaveOutput)
          })
        })
        .catch(e => {
          reject(e)
        })
    })
  }
}

export const swotAnalysisController = new SwotAnalysisController()

async function updateDatabase(datasetId: any, containerName: any, blobName: string) {
    const client = await MongoClient.connect(process.env.MONGO_DB_CONNECTION_STRING, { useUnifiedTopology: true })

    const db = await client.db()
    const collection = await db.collection('datasets')
    const query = { _id: new ObjectId(datasetId) }

    const dataset = await collection.findOne(query);
    dataset.update({containerName, blobName});

    client.close()

}

