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
const moment = require('moment');

const ExcelHandler = require('./handlers/ExcelHandler');

const IMPORTER_ACTION = 'helix-theblog/helix-theblog-importer@latest';

const HOST = 'theblog.adobe.com';
const IP = '192.40.113.16';
const SITE = `https://${HOST}`;

const URLS_XLSX = '/importer/urls.xlsx';
const URLS_XLSX_WORKSHEET = 'urls';
const URLS_XLSX_TABLE = 'listOfURLS';

function getIPURL(url) {
  return url.replace(HOST, IP);
}

async function doScan(opts, url, scanned, doImport, logger) {
  const scannedIndex = scanned.findIndex((item) => item.url === url);
  // is already in the list of scanned
  const alreadyScanned = scannedIndex !== -1;
  // has already been processed by the current import
  const alreadyChecked = alreadyScanned && scanned[scannedIndex].checked;

  if (!alreadyChecked) {
    logger.info(`Scanning ${url}`);

    let html;
    try {
      html = await rp({
        uri: getIPURL(url),
        timeout: 60000,
        rejectUnauthorized: false,
      });
    } catch (error) {
      logger.warn(`Error while downloading page ${url}: ${error.message}`);
      return;
    }

    const $ = cheerio.load(html);

    let lastModifiedDate;
    const lastModifiedMeta = $('[property="article:modified_time"]').attr('content');
    if (lastModifiedMeta) {
      lastModifiedDate = moment(lastModifiedMeta);
    }

    const modifiedSinceLastScanned = alreadyScanned
      && lastModifiedDate
      && lastModifiedDate.isAfter(scanned[scannedIndex].lastImportDate);

    if (doImport && (!alreadyScanned || modifiedSinceLastScanned)) {
      if (modifiedSinceLastScanned) {
        logger.info(`Re-importing ${url} because it has been modified.`);
      } else {
        logger.info(`Importing ${url}: new entry found.`);
      }
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

    if (alreadyScanned) {
      if (modifiedSinceLastScanned) {
        // eslint-disable-next-line no-param-reassign
        scanned[scannedIndex].lastImportDate = new Date();
      }
      // eslint-disable-next-line no-param-reassign
      scanned[scannedIndex].checked = true;
    } else {
      scanned.push({
        id: 'new',
        url,
        lastImportDate: new Date(),
        checked: true,
      });
    }

    if ((!alreadyScanned || modifiedSinceLastScanned)) {
      // try to find links
      const links = $('body').find('a.article-link, a.prev, a.next');
      logger.debug(`Number of links found ${links.length}`);
      for (let i = 0; i < links.length; i += 1) {
        const link = links[i];
        const linkUrl = link.attribs.href;
        // scan links but not already scanned and outside of domain
        if (linkUrl.indexOf('theblog.adobe.com') !== -1) {
          // eslint-disable-next-line no-await-in-loop
          await doScan(opts, linkUrl, scanned, true, logger);
        }
      }
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

    const read = rows.value.map(
      (r) => (r.values.length > 0 && r.values[0].length > 2
        ? { id: r.values[0][0], url: r.values[0][1], lastImportDate: new Date(r.values[0][2]) }
        : null),
    );

    // remove duplicates to keep on the latest ones
    const scanned = [];
    read.forEach((scan) => {
      const foundIndex = scanned.findIndex((s) => s.url === scan.url);
      if (foundIndex !== -1) {
        if (moment(scan.lastImportDate).isAfter(scanned[foundIndex].lastImportDate)) {
          scanned[foundIndex].lastImportDate = scan.lastImportDate;
        }
      } else {
        scanned.push(scan);
      }
    });

    await doScan(
      {
        ow,
      },
      SITE,
      scanned,
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
