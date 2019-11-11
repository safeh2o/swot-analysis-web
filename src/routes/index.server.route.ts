import { Express } from 'express'
import { swotAnalysisController } from '../controllers/swot.analysis.controller';

export default class IndexRoute {
  constructor(app: Express) {
    app.route('/analysis').get(swotAnalysisController.index.bind(swotAnalysisController));
  }
}
