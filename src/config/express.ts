import * as bodyParser from 'body-parser'
import * as cookieParser from 'cookie-parser'
import * as express from 'express'
import * as logger from 'morgan'
import * as path from 'path'
import config from './config'
import * as middleware from './middleware';

export default function(app) {
  app.use(logger('common'))
  // app.use(bodyParser.json())
  app.use(bodyParser.urlencoded({ extended: false }))
  app.use(cookieParser())
  app.use(express.static(path.join(__dirname, '../../src/public')))

  app.use(middleware.allowIp);

  for (const route of config.globFiles(config.routes)) {
    require(path.resolve(route)).default(app)
  }

  return app
}
