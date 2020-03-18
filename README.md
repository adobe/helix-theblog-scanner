# Helix - TheBlog Scanner

TheBlog should run periodically (via an [Openwhisk trigger](https://github.com/apache/openwhisk/blob/master/docs/triggers_rules.md)) and scan [theblog.adobe.com](https://theblog.adobe.com) to determine if new blog entries have been created. For each new blog entry detected, it invokes [TheBlog Importer](https://github.com/adobe/helix-theblog-importer).

The execution flow looks like this:
- fetch the content of the theblog.adobe.com homepage
- compute the list of links on the page
- for each link, check if it present in a list of already processed urls stored in a OneDrive XLSX file (/importer/urls.xlsx)
- if not present, invoke [helix-theblog-importer action](https://github.com/adobe/helix-theblog-importer)

## Status
[![CircleCI](https://img.shields.io/circleci/project/github/adobe/helix-theblog-scanner.svg)](https://circleci.com/gh/adobe/helix-theblog-scanner)
[![GitHub license](https://img.shields.io/github/license/adobe/helix-theblog-scanner.svg)](https://github.com/adobe/helix-theblog-scanner/blob/master/LICENSE.txt)
[![GitHub issues](https://img.shields.io/github/issues/adobe/helix-theblog-scanner.svg)](https://github.com/adobe/helix-theblog-scanner/issues)
[![LGTM Code Quality Grade: JavaScript](https://img.shields.io/lgtm/grade/javascript/g/adobe/helix-theblog-scanner.svg?logo=lgtm&logoWidth=18)](https://lgtm.com/projects/g/adobe/helix-theblog-scanner)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release) [![Greenkeeper badge](https://badges.greenkeeper.io/adobe/helix-theblog-scanner.svg)](https://greenkeeper.io/)

## Setup

### Installation

Deploy the action:

```
npm run deploy
```

Create a five mins triggers:

```bash
wsk trigger create five-mins-trigger --feed /whisk.system/alarms/alarm --param cron "*/5 * * * *"
```

Link the trigger to a rule: 

```bash
 wsk rule update five-mins-scan five-mins-trigger helix-services-private/helix-theblog-scanner@1.4.9
```

### Required env variables:

Connection to OneDrive:

- `AZURE_ONEDRIVE_CLIENT_ID`
- `AZURE_ONEDRIVE_CLIENT_SECRET`
- `AZURE_ONEDRIVE_REFRESH_TOKEN`

OneDrive shared folder that contains the `/importer/urls.xlsx` file:

- `AZURE_ONEDRIVE_ADMIN_LINK`

Openwhish credentials to invoke the helix-theblog-importer action:

- `OPENWHISK_API_KEY`
- `OPENWHISK_API_HOST`

Coralogix credentials to log: 

- `CORALOGIX_API_KEY`
- `CORALOGIX_LOG_LEVEL`

## Development

### Deploying Helix Service

Deploying Helix Service requires the `wsk` command line client, authenticated to a namespace of your choice. For Project Helix, we use the `helix` namespace.

All commits to master that pass the testing will be deployed automatically. All commits to branches that will pass the testing will get commited as `/helix-services/helix-theblog-scanner@ci<num>` and tagged with the CI build number.
