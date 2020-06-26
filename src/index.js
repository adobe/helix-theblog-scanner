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
const rp = require('request-promise-native');
const cheerio = require('cheerio');
const openwhisk = require('openwhisk');

const ExcelHandler = require('./handlers/ExcelHandler');

const IMPORTER_ACTION = 'helix-theblog/helix-theblog-importer@latest';

const DOMAIN = 'theblog.adobe.com';
const IP = '192.40.113.16';
const SITE = `https://${DOMAIN}`;

const URLS_XLSX = '/importer/urls.xlsx';
const URLS_XLSX_WORKSHEET = 'urls';
const URLS_XLSX_TABLE = 'listOfURLS';

function getIPURL(url) {
  return url.replace(DOMAIN, IP);
}

async function doScan(opts, url, scanned, doImport, logger) {
  if (doImport) {
    logger.info(`Running import for ${url}`);
    // async is not possible yet
    // because of onedrive resources not being accessible to many time in parallel
    try {
      const result = await opts.ow.actions.invoke({
        name: IMPORTER_ACTION,
        blocking: true,
        result: true,
        params: {
          url,
        },
      });
      logger.debug('Import action response: ', result);
    } catch (error) {
      logger.error(`Error processing importer to ${url}: ${error.message}`);
    }
  }

  logger.info(`Scanning ${url}`);
  scanned.push(url);

  const html = await rp({
    uri: getIPURL(url),
    timeout: 60000,
    rejectUnauthorized: false,
  });

  const $ = cheerio.load(html);

  // try to find links
  const links = $('body').find('a.article-link, a.prev, a.next');
  logger.debug(`Number of links found ${links.length}`);
  for (let i = links.length - 1; i >= 0; i -= 1) {
    const link = links[i];
    const linkUrl = link.attribs.href;
    // scan links but not already scanned and outside of domain
    if (scanned.indexOf(linkUrl) === -1 && linkUrl.indexOf('theblog.adobe.com') !== -1) {
      // eslint-disable-next-line no-await-in-loop
      await doScan(opts, getIPURL(linkUrl), scanned, true, logger);
    }
  }
}

/**
 * This is the main function
 */
async function main(params = {}) {
  const {
    __ow_logger: logger,
    AZURE_ONEDRIVE_CLIENT_ID: oneDriveClientId,
    AZURE_ONEDRIVE_CLIENT_SECRET: oneDriveClientSecret,
    AZURE_ONEDRIVE_REFRESH_TOKEN: oneDriveRefreshToken,
    AZURE_ONEDRIVE_ADMIN_LINK: oneDriveAdminLink,
    OPENWHISK_API_KEY: owKey,
    OPENWHISK_API_HOST: owHost,
  } = params;

  try {
    let excelHandler;

    if (oneDriveClientId && oneDriveClientSecret) {
      logger.info('OneDrive credentials provided - using OneDrive handler');
      excelHandler = new ExcelHandler({
        logger,
        clientId: oneDriveClientId,
        clientSecret: oneDriveClientSecret,
        refreshToken: oneDriveRefreshToken,
        sharedLink: oneDriveAdminLink,
      });
    } else {
      logger.info('No OneDrive credentials provided');
      throw new Error('Missing OneDrive credentials');
    }

    // load urls already processed
    const rows = await excelHandler.getRows(URLS_XLSX, URLS_XLSX_WORKSHEET, URLS_XLSX_TABLE);

    let ow;
    if (owKey) {
      ow = openwhisk({
        api_key: owKey,
        apihost: owHost,
      });
    } else {
      ow = openwhisk();
    }

    await doScan(
      {
        ow,
      },
      SITE,
      rows.value.map(
        (r) => (r.values.length > 0 && r.values[0].length > 1 ? r.values[0][1] : null),
      ),
      false,
      logger,
    );

    logger.info('Process done!');
    return Promise.resolve({
      body: `Successfully scanned ${SITE}`,
    });
  } catch (error) {
    logger.info(`An error occured during the scan: ${error.message}. Error has been caught and next scan might solve the issue.`);
    return Promise.resolve({
      body: `Error during the scan: ${error.message}`,
    });
  }
}

module.exports.main = wrap(main)
  .with(epsagon)
  .with(status)
  .with(oLogger.trace)
  .with(oLogger);
