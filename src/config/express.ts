import * as bodyParser from 'body-parser'
import * as cookieParser from 'cookie-parser'
import * as express from 'express'
import * as logger from 'morgan'
import * as path from 'path'
import config from './config'

export default function() {
  const app: express.Express = express()

  app.use(logger('common'))
  app.use(bodyParser.json())
  app.use(bodyParser.urlencoded({ extended: false }))
  app.use(cookieParser())
  app.use(express.static(path.join(__dirname, '../../src/public')))

  for (const route of config.globFiles(config.routes)) {
    require(path.resolve(route)).default(app)
  }

  app.use(
    (req: express.Request, res: express.Response, next: Function): void => {
      const err: Error = new Error('Not Found')
      next(err)
    },
  )

  return app
}
