#!/bin/bash

REPODIR="/home/swotAdmin/source/analyzer"
cd ${REPODIR} && git remote update > /dev/null 2>&1
UPSTREAM_ORIGIN="origin"
UPSTREAM_BRANCH="master"
UPSTREAM="${UPSTREAM_ORIGIN}/${UPSTREAM_BRANCH}"
LOCAL=$(cd ${REPODIR} && git rev-parse @)
REMOTE=$(cd ${REPODIR} && git rev-parse ${UPSTREAM})

echo "Checking for updates on $(date)" >> ${REPODIR}/updates.log
if [[ $LOCAL != $REMOTE ]]; then
	echo "Found an update: commit ${REMOTE}" >> ${REPODIR}/updates.log
	(cd ${REPODIR} && git pull ${UPSTREAM_ORIGIN} ${UPSTREAM_BRANCH} && npm run build && pm2 restart 0)
	echo "Analyzer was updated" >> ${REPODIR}/updates.log
fi
