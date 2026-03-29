#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const timestamp = process.argv[2] || makeTimestamp();

const filesToUpdate = [
  {
    file: 'sw.js',
    updates: [
      {
        find: /(var CACHE_NAME = 'bonus-)(\d{14})(')/,
        replace: `$1${timestamp}$3`,
        description: 'service worker cache name',
      },
    ],
  },
  {
    file: 'index.html',
    updates: [
      {
        find: /(<meta name="version" content=")(\d{14})(">)/,
        replace: `$1${timestamp}$3`,
        description: 'version meta tag',
      },
      {
        find: /(build )(\d{14})(<\/div>)/,
        replace: `$1${timestamp}$3`,
        description: 'build label',
      },
      {
        find: /(navigator\.serviceWorker\.register\('\.\/sw\.js\?v=)(\d{14})('\, \{updateViaCache: 'none'\}\))/,
        replace: `$1${timestamp}$3`,
        description: 'service worker registration cache-buster',
      },
    ],
  },
];

for (const entry of filesToUpdate) {
  const fullPath = path.join(projectRoot, entry.file);
  let content = fs.readFileSync(fullPath, 'utf8');

  for (const update of entry.updates) {
    const nextContent = content.replace(update.find, update.replace);

    if (nextContent === content) {
      throw new Error(`Could not update ${update.description} in ${entry.file}.`);
    }

    content = nextContent;
  }

  fs.writeFileSync(fullPath, content);
  console.log(`Updated ${entry.file}`);
}

console.log(`Build timestamp: ${timestamp}`);

function makeTimestamp() {
  const now = new Date();
  const YYYY = now.getUTCFullYear();
  const MM = String(now.getUTCMonth() + 1).padStart(2, '0');
  const DD = String(now.getUTCDate()).padStart(2, '0');
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  return `${YYYY}${MM}${DD}${hh}${mm}${ss}`;
}
