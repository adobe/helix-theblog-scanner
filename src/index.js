/*
 * Copyright 2020 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
const { wrap } = require('@adobe/openwhisk-action-utils');
const { logger: oLogger } = require('@adobe/openwhisk-action-logger');
const { wrap: status } = require('@adobe/helix-status');
const { epsagon } = require('@adobe/helix-epsagon');
const axios = require('axios');
const cheerio = require('cheerio');
const openwhisk = require('openwhisk');
const parse = require('csv-parse/lib/sync');

const FSHandler = require('./handlers/FSHandler');
const OneDriveHandler = require('./handlers/OneDriveHandler');

const IMPORTER_ACTION = 'helix-services-private/helix-theblog-importer@1.6.0';

const SITE = 'https://theblog.adobe.com';
const URLS_CSV = '/urls.csv';

async function doScan(opts, url, scanned, doImport, logger) {
  if (doImport) {
    logger.info(`Running import for ${url}`);
    // async is not possible yet
    // because of onedrive resources not being accessible to many time in parallel
    await opts.ow.actions.invoke({
      name: IMPORTER_ACTION,
      blocking: true,
      result: false,
      params: {
        url,
      },
    }).catch((error) => {
      logger.error(`Error processing importer to ${url}: ${error.message}`);
    });
  }

  logger.info(`Scanning ${url}`);
  scanned.push(url);

  const response = await axios({
    url,
    maxRedirects: 0,
  });

  const $ = cheerio.load(response.data);

  // try to find links
  const links = $('body').find('a.article-link, a.prev, a.next');
  logger.debug(`Number of links found ${links.length}`);
  for (let i = 0; i < links.length; i += 1) {
    const link = links[i];
    const linkUrl = link.attribs.href;
    // scan links but not already scanned and outside of domain
    if (scanned.indexOf(linkUrl) === -1 && linkUrl.indexOf('theblog.adobe.com') !== -1) {
      // eslint-disable-next-line no-await-in-loop
      await doScan(opts, linkUrl, scanned, true, logger);
    }
  }
}

/**
 * This is the main function
 * @param {string} name name of the person to greet
 * @returns {object} a greeting
 */
async function main(params = {}) {
  const {
    __ow_logger: logger,
    AZURE_ONEDRIVE_CLIENT_ID: oneDriveClientId,
    AZURE_ONEDRIVE_CLIENT_SECRET: oneDriveClientSecret,
    AZURE_ONEDRIVE_REFRESH_TOKEN: oneDriveRefreshToken,
    AZURE_ONEDRIVE_SHARED_LINK: oneDriveSharedLink,
    IMPORTER_ACTION_AUTH,
    OPENWHISK_API_KEY: owKey,
    OPENWHISK_API_HOST: owHost,
  } = params;

  try {
    let handler = new FSHandler({
      logger,
    });

    if (oneDriveClientId && oneDriveClientSecret) {
      logger.info('OneDrive credentials provided - using OneDrive handler');
      handler = new OneDriveHandler({
        logger,
        clientId: oneDriveClientId,
        clientSecret: oneDriveClientSecret,
        refreshToken: oneDriveRefreshToken,
        sharedLink: oneDriveSharedLink,
      });
    } else {
      logger.info('No OneDrive credentials provided - using default handler');
    }

    // load urls already processed
    const urls = await handler.get(URLS_CSV);
    const records = parse(urls, {
      columns: ['year', 'url', 'importDate'],
      skip_empty_lines: true,
      relax_column_count: true,
    });

    let ow;
    if (owKey) {
      ow = openwhisk({
        api_key: owKey,
        apihost: owHost,
      });
    } else {
      ow = openwhisk();
    }

    await doScan({
      ow,
    }, SITE, records.map((r) => r.url), false, logger);

    logger.info('Process done!');
    return Promise.resolve({
      body: `Successfully scanned ${SITE}`,
    });
  } catch (error) {
    logger.error(error.message);
    throw error;
  }
}

module.exports.main = wrap(main)
  .with(epsagon)
  .with(status)
  .with(oLogger.trace)
  .with(oLogger);
