import * as imageDataUri from 'image-data-uri'
import * as Handlebars from 'handlebars'
import * as Util from 'util'
import * as Path from 'path'
import * as Fs from 'fs'
import * as cheerio from 'cheerio'
import * as XLSX from 'xlsx'
import * as Puppeteer from 'puppeteer'
import * as csv from 'csv-parser'
import { PDFDocument, PDFPage, degrees } from 'pdf-lib'

const ReadFile = Util.promisify(Fs.readFile)
const WriteFile = Util.promisify(Fs.writeFile)

export type ReportInfo = {
  //location where ANN files reside
  pythonFolder: string
  //location where Octave files reside
  octaveFolder: string
  //location where PDF output should reside
  outputFolder: string
  //base filename
  filename: string
  reportDate: string
  countryName: string
  projectName: string
  fieldSiteName: string
  datasetName: string
  numSamples: string
  numOptimize: string
  confidenceLevel: string
  octaveOutput: string
  webSkipped: Object[]
}

export class AnalysisReport {
  debug: boolean

  constructor(debug = false) {
    this.debug = debug
  }

  async html(report: ReportInfo) {
    //get base64 for octave images
    const octaveBackcheck = await imageDataUri.encodeFromFile(
      Path.resolve(
        report.octaveFolder,
        report.filename + '.csv',
        report.filename + '_Backcheck.png'
      )
    )
    const octaveContour = await imageDataUri.encodeFromFile(
      Path.resolve(
        report.octaveFolder,
        report.filename + '.csv',
        report.filename + '_Contour.png'
      )
    )
    const octaveHistogram = await imageDataUri.encodeFromFile(
      Path.resolve(
        report.octaveFolder,
        report.filename + '.csv',
        report.filename + '_Histogram.png'
      )
    )
    //get the ANN table
    const $ = cheerio.load(
      Fs.readFileSync(
        Path.resolve(report.pythonFolder, report.filename + '.html')
      )
    )
    const pythonReport = `<table class="table center" border="1">${$(
      '#annTable'
    ).html()}</table>`
    //get ANN version
    const annVersion = `${$('.swot_version').html()}`
    //get average time between tapstand and household
    const deltaT = `${$('.time_difference').html()}`
    //get the Excel table from octave output
    var workbook = XLSX.readFile(
      Path.resolve(
        report.octaveFolder,
        report.filename + '.csv',
        report.filename + '_Results.xlsx'
      )
    )
    const octaveExcelOutputFull = XLSX.utils.sheet_to_html(
      workbook.Sheets[workbook.SheetNames[0]]
    )
    const $octave = cheerio.load(octaveExcelOutputFull)
    const octaveExcelOutput = `<table class="table center octaveTable" border="1">${$octave(
      'table'
    ).html()}</table>`
    //get skipped rows from octave output
    const skippedRowsFilename = Path.resolve(
      report.octaveFolder,
      report.filename + '.csv',
      report.filename + '_SkippedRows.csv'
    )
    // get standardization ruleset from octave output
    const octaveRulesetFilename = Path.resolve(
      report.octaveFolder,
      report.filename + '.csv',
      report.filename + '_Ruleset.csv'
    )
    const octaveSkippedRows = []
    if (Fs.existsSync(skippedRowsFilename)) {
      try {
        Fs.createReadStream(skippedRowsFilename)
          .pipe(csv())
          .on('data', row => {
            octaveSkippedRows.push(row)
          })
      } catch (e) {
        console.log(`Error while parsing skipped data rows for EO: ${e}`)
      }
    }
    const octaveRuleset = []
    if (Fs.existsSync(octaveRulesetFilename)) {
      try {
        Fs.createReadStream(octaveRulesetFilename)
          .pipe(csv())
          .on('data', row => {
            octaveRuleset.push(row)
          })
      } catch (e) {
        console.log(`Error while parsing standardized ruleset for EO: ${e}`)
      }
    }
    //get the FRC images
    const annFRC = await imageDataUri.encodeFromFile(
      Path.resolve(report.pythonFolder, report.filename + '-frc.jpg')
    )

    const pythonSkippedHtml = cheerio.html($('#pythonSkipped'))
    const pythonRuleset = cheerio.html($('#ann_ruleset'))
    const pythonSkippedCount = $('#pythonSkipped_count').html()

    let octaveFRCDist = '0.0'
    // extract FRC=[frcValue]; from octave, e.g. FRC=0.1;
    if (
      report.octaveOutput != null &&
      report.octaveOutput.length > 0 &&
      report.octaveOutput.indexOf('FRC=') != -1
    ) {
      try {
        octaveFRCDist = report.octaveOutput.substring(
          report.octaveOutput.indexOf('FRC=') + 4
        )
        octaveFRCDist = octaveFRCDist.split(';')[0]
      } catch (e) {
        console.log(
          `Error while parsing FRC= value from octave output: ${report.octaveOutput}`
        )
        console.log(
          `Ensure octave command in .env file looks like this: octave-cli --eval "[~,frc]=engmodel('<INPUTFILE>', '<OUTPUTFILE>'); printf('FRC=%.1f;', frc);"`
        )
      }
    }

    const dataHeaders = [
      'ts_datetime',
      'ts_frc',
      'hh_datetime',
      'hh_frc',
      'ts_wattemp',
      'ts_cond',
    ]

    const numSamples = parseInt(report.numSamples)
    const flowchart_counts = {
      n_input: report.numSamples,
      x_eo: octaveSkippedRows.length,
      n_eo: numSamples - octaveSkippedRows.length,
      x_ann: pythonSkippedCount,
      n_ann: numSamples - parseInt(pythonSkippedCount),
    }

    try {
      //prepare report data
      const data = {
        reportDate: report.reportDate,
        countryName: report.countryName,
        projectName: report.projectName,
        fieldSiteName: report.fieldSiteName,
        datasetName: report.datasetName,
        numSamples: report.numSamples,
        numOptimize: report.numOptimize,
        confidenceLevel: report.confidenceLevel,
        octaveBackcheck: octaveBackcheck,
        octaveExcelOutput: octaveExcelOutput,
        octaveContour: octaveContour,
        octaveHistogram: octaveHistogram,
        pythonHtmlReport: pythonReport,
        annVersion: annVersion,
        deltaT: deltaT,
        pythonFRCImage: annFRC,
        octaveFRCDist: octaveFRCDist,
        pythonSkippedHtml: pythonSkippedHtml,
        pythonSkippedCount: pythonSkippedCount,
        pythonRuleset: pythonRuleset,
        octaveSkipped: octaveSkippedRows,
        octaveRuleset: octaveRuleset,
        dataHeaders: dataHeaders,
        flowchart_counts: flowchart_counts,
      }

      const templateDir = Fs.existsSync('./static')
        ? './static'
        : './dist/static'

      Handlebars.registerHelper('ifin', (list, item, options) => {
        if (list && list.split(',').includes(item)) {
          return options.fn(this)
        } else {
          return options.inverse(this)
        }
      })

      const flowchart = await this.compileFile(
        templateDir,
        'flowchart-template.html'
      )
      Handlebars.registerPartial('standardizationFlowchart', flowchart)

      const standardizationtable = await this.compileFile(
        templateDir,
        'standardization_table-template.html'
      )
      Handlebars.registerPartial('standardizationTable', standardizationtable)

      const template = await this.compileFile(
        templateDir,
        'report-template.html'
      )
      return template(data)
    } catch (error) {
      throw new Error('Cannot create HTML report template.' + error)
    }
  }

  async pdf(report: ReportInfo) {
    const html = await this.html(report)
    //for debugging, save the html file
    if (this.debug) {
      Fs.writeFileSync(
        Path.resolve(report.outputFolder, report.filename + '-test.html'),
        html
      )
    }

    const browser = await Puppeteer.launch({ args: ['--no-sandbox'] })

    const page = await browser.newPage()
    await page.setContent(html)
    await page.emulateMediaType('print')

    const pdfPath = Path.resolve(
      report.outputFolder,
      report.filename + (report.filename.endsWith('.pdf') ? '' : '.pdf')
    )

    let pdf = await page.pdf({
      margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' },
      scale: 0.7,
    })

    // pdf = Buffer.from(await this.rotatePage(pdf, 90, 5));

    await WriteFile(pdfPath, pdf)

    return pdf
  }

  async compileFile(templateDir: string, filename: string) {
    const templatePath = Path.resolve(templateDir, filename)
    const content = await ReadFile(templatePath, 'utf8')
    return Handlebars.compile(content)
  }

  async rotatePage(
    pdf: Buffer,
    degreeAngle: number = 90,
    ...pageNumbers: number[]
  ) {
    const pdfDoc = await PDFDocument.load(pdf)

    let page: PDFPage
    pageNumbers.forEach(pageNumber => {
      page = pdfDoc.getPage(pageNumber - 1)
      page.setRotation(degrees(degreeAngle))
    })

    return pdfDoc.save()
  }
}

// for debugging purposes -- run `node report.js` in dist folder. Ensure report-template.html is in the same directory
// new AnalysisReport().pdf({
//   confidenceLevel: 'max',
//   countryName: 'Sudan',
//   datasetName: 'Test 123',
//   fieldSiteName: 'Site 123',
//   filename: 'python6__ssc1__TESTSite__20200125',
//   pythonFolder: 'C:\\source\\swot\\report\\sampledata',
//   octaveFolder: 'C:\\source\\swot\\report\\sampledata',
//   outputFolder: 'C:\\source\\swot\\report\\sampledata',
//   numOptimize: '123',
//   numSamples: '1234',
//   projectName: 'Project ABC',
//   reportDate: 'May 10, 2020'
// })
