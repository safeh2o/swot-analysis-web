import * as http from 'http'
import config from './config/config'
import * as cors from 'cors';
import { config as dotenvConfig } from 'dotenv'
import { env } from 'process';
import * as helmet from 'helmet';
import * as express from 'express';

dotenvConfig({path: __dirname + '/.env', debug: (env.DEBUG != null || env.DEV != null) })

console.log(`Server starting on ${env.HTTP_PORT} \n
            with Python path ${env.PYTHON_PATH} \n
            with Script path ${env.PYTHON_WORKING_DIR} \n
            with Python filename ${env.PYTHON_SCRIPT_FILE} \n
            with Octave working dir ${env.OCTAVE_WORKING_DIR} \n
            with Octave params ${env.OCTAVE_PARAM1} ${env.OCTAVE_PARAM2} \n
            with Octave filename ${env.OCTAVE_SCRIPT_FILE} \n`)

// tslint:disable-next-line: no-require-imports
const app = express();

app.use(helmet());
require('./config/express').default(app)


const server: http.Server = new http.Server(app)

server.listen(env.HTTP_PORT);
server.timeout = Number(env.HTTP_REQUEST_TIMEOUT) || 240000;

server.on('error', (e: Error) => {
  console.log('Error starting server' + e)
})

server.on('listening', () => {
  console.log(
    `Server started on port ${env.HTTP_PORT} on environment ${env.NODE_ENV ||
      'dev'}`,
  )
})
