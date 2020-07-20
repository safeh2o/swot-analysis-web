import * as imageDataUri from 'image-data-uri';
import * as Handlebars from 'handlebars';
import * as Util from 'util';
import * as Path from 'path';
import * as Fs from 'fs';
import * as cheerio from 'cheerio';
import * as XLSX from 'xlsx';
import * as Puppeteer from 'puppeteer';
import * as csv from 'csv-parser';
const ReadFile = Util.promisify(Fs.readFile)

export type ReportInfo = {
  //location where ANN files reside
  pythonFolder: string,
  //location where Octave files reside
  octaveFolder: string,
  //location where PDF output should reside
  outputFolder: string,
  //base filename
  filename: string,
  reportDate: string,
  countryName: string,
  projectName: string,
  fieldSiteName: string,
  datasetName: string,
  numSamples: string,
  numOptimize: string,
  confidenceLevel: string,
  octaveOutput: string,
  webSkipped: string[]
}

export class AnalysisReport {

  async html(report: ReportInfo) {

    //get base64 for octave images
    const octaveBackcheck = await imageDataUri.encodeFromFile(Path.resolve(report.octaveFolder, report.filename + ".csv", report.filename + "_Backcheck.png"));
    const octaveContour = await imageDataUri.encodeFromFile(Path.resolve(report.octaveFolder, report.filename + ".csv", report.filename + "_Contour.png"));
    //get the ANN table
    const $ = cheerio.load(Fs.readFileSync(Path.resolve(report.pythonFolder, report.filename + ".html")));
    const pythonReport = `<table class="table center" border="1">${$('#annTable').html()}</table>`;
    //get ANN version
    const annVersion = `${$('.swot_version').html()}`;
    //get average time between tapstand and household
    const deltaT = `${$('.time_difference').html()}`;
    //get the Excel table from octave output
    var workbook = XLSX.readFile(Path.resolve(report.octaveFolder, report.filename + ".csv", report.filename + "_Results.xlsx"));
    const octaveExcelOutputFull = XLSX.utils.sheet_to_html(workbook.Sheets[workbook.SheetNames[0]]);
    const $octave = cheerio.load(octaveExcelOutputFull);
    const octaveExcelOutput = `<table class="table center octaveTable pagebreak" border="1">${$octave('table').html()}</table>`;
    //get skipped rows from octave output
    const skippedRowsFilename = Path.resolve(report.octaveFolder, report.filename + '.csv', report.filename + '_SkippedRows.csv');
    // get standardization ruleset from octave output
    const octaveRulesetFilename = Path.resolve(report.octaveFolder, report.filename + '.csv', report.filename + '_Ruleset.csv');
    const octaveSkippedRows = [];
    if (Fs.existsSync(skippedRowsFilename)) {
      try {
        Fs.createReadStream(skippedRowsFilename)
        .pipe(csv())
        .on('data', (row) => {
          octaveSkippedRows.push(row);
        });
      } catch (e) {
        console.log(`Error while parsing skipped data rows for EO: ${e}`);
      }
    }
    const octaveRuleset = [];
    if (Fs.existsSync(octaveRulesetFilename)) {
      try {
        Fs.createReadStream(octaveRulesetFilename)
        .pipe(csv())
        .on('data', (row) => {
          if (row['Count'] > 0){
            octaveRuleset.push(row);
          }
        });
      } catch (e) {
        console.log(`Error while parsing standardized ruleset for EO: ${e}`);
      }
    }
    //get the FRC images
    const annFRC = await imageDataUri.encodeFromFile(Path.resolve(report.pythonFolder, report.filename + "-frc.jpg"));

    const pythonSkipped = $('#pythonSkipped');
    let pythonSkippedHtml = null;
    if (pythonSkipped.html()){
      let tr = pythonSkipped.find('thead tr');
      tr.attr('style', null);
      pythonSkippedHtml = `<table class="table center" border="1">${pythonSkipped.html()}</table>`;
    }
    const pythonRuleset = $('#ann_ruleset').html();

    let octaveFRCDist = "0.0";
    // extract FRC=[frcValue]; from octave, e.g. FRC=0.1;
    if (report.octaveOutput != null && report.octaveOutput.length > 0 && report.octaveOutput.indexOf("FRC=") != -1) {
      try {
        octaveFRCDist = report.octaveOutput.substring(report.octaveOutput.indexOf("FRC=") + 4);
        octaveFRCDist = octaveFRCDist.split(";")[0];
      } catch(e) {
        console.log(`Error while parsing FRC= value from octave output: ${report.octaveOutput}`);
        console.log(`Ensure octave command in .env file looks like this: octave-cli --eval "[~,frc]=engmodel('<INPUTFILE>', '<OUTPUTFILE>'); printf('FRC=%.1f;', frc);"`);
      }
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
        pythonHtmlReport: pythonReport,
        annVersion: annVersion,
        deltaT: deltaT,
        pythonFRCImage: annFRC,
        octaveFRCDist: octaveFRCDist,
        webSkipped: report.webSkipped,
        pythonSkippedHtml: pythonSkippedHtml,
        pythonRuleset: pythonRuleset,
        octaveSkipped: octaveSkippedRows,
        octaveRuleset: octaveRuleset
      }

      //inject template into report
      let templatePath, content;
      try {
        //app is running inside dist folder
        templatePath = Path.resolve('./static/report-template.html')
        content = await ReadFile(templatePath, 'utf8')
      } catch (e) {
        //app might be running outside dist folder
        templatePath = Path.resolve('./dist/static/report-template.html')
        content = await ReadFile(templatePath, 'utf8')
      }
      const template = Handlebars.compile(content)
      return template(data)
    } catch (error) {
      throw new Error('Cannot create HTML report template.' + error)
    }
  }

  async pdf(report: ReportInfo) {
    const html = await this.html(report);
    //for debugging, save the html file
    // Fs.writeFileSync(Path.resolve(report.outputFolder, report.filename + "-test.html"), html)
    const browser = await Puppeteer.launch({args: ['--no-sandbox']});
    const page = await browser.newPage();
    await page.setContent(html);

    await page.emulateMediaType('print');
    return page.pdf({
      path: Path.resolve(report.outputFolder, report.filename + (report.filename.endsWith(".pdf") ? '' : '.pdf'))
    })
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
