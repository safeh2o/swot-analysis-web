FROM ubuntu:20.04

ENV TZ=America/Toronto \
    DEBIAN_FRONTEND=noninteractive
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

RUN mkdir -p /app
WORKDIR /app
COPY package.json /app/
RUN apt update -y && apt install -y npm \
    python3 \
    python3-pip \
    octave \
    octave-statistics \
    git \
    zip

RUN git clone https://github.com/safeh2o/swot-python-analysis
RUN git clone https://github.com/safeh2o/swot-octave-analysis

RUN pip3 install --no-cache-dir -r swot-python-analysis/requirements.txt

RUN mkdir -p output/downloads \
    output/python \
    output/octave

ENV PYTHON_PATH=python3 \
    PYTHON_WORKING_DIR=/app/swot-python-analysis \
    PYTHON_OUTPUT_FOLDER=/app/output/python \
    OCTAVE_WORKING_DIR=/app/swot-octave-analysis/EngineeringOptimizationModel \
    OCTAVE_OUTPUT_FOLDER=/app/output/octave \
    AZURE_DOWNLOAD_LOCAL_FOLDER=/app/output/downloads

RUN npm install

RUN apt install -y zip

COPY . /app
RUN npm run build

ENV NODE_ENV production
ENV HTTP_PORT 3000

EXPOSE ${HTTP_PORT}

CMD [ "npm", "run", "start" ]
