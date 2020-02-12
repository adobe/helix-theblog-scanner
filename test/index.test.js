/*
 * Copyright 2019 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-env mocha */

'use strict';

const assert = require('assert');
const index = require('../src/index.js');

require('dotenv').config();

describe('Index Tests', () => {
  it('index with url', async () => {
    const result = await index.main({
      AZURE_ONEDRIVE_CLIENT_ID: process.env.AZURE_ONEDRIVE_CLIENT_ID,
      AZURE_ONEDRIVE_CLIENT_SECRET: process.env.AZURE_ONEDRIVE_CLIENT_SECRET,
      AZURE_ONEDRIVE_REFRESH_TOKEN: process.env.AZURE_ONEDRIVE_REFRESH_TOKEN,
      AZURE_ONEDRIVE_ADMIN_LINK: process.env.AZURE_ONEDRIVE_ADMIN_LINK,
      OPENWHISK_API_KEY: process.env.OPENWHISK_API_KEY,
      OPENWHISK_API_HOST: process.env.OPENWHISK_API_HOST,
    });
    assert.deepEqual(result, { body: 'Successfully scanned https://theblog.adobe.com' });
  });
});
