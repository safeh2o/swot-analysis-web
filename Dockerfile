FROM node:15.0.1-buster-slim

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
COPY package.json /usr/src/app/
RUN npm install
# RUN npm install -g pm2

COPY . /usr/src/app
RUN npm run build

ENV NODE_ENV production

EXPOSE 3000

CMD [ "npm", "run", "start" ]
# CMD ["pm2", "start", "dist/index.js", "--name", "SWOT-Analyzer"]
