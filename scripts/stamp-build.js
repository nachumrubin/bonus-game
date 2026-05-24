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
        find: /(var CACHE_NAME = 'boost-)(\d{14})(')/,
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
    ],
  },
  {
    file: 'partials/screens/home.html',
    updates: [
      {
        // Match the `build NNNNNNNNNNNNNN` label wherever it sits inside the
        // credit line. Not anchored to `</div>` so adding sibling content
        // (e.g. music attribution on a new line) doesn't break the stamp.
        find: /(build )(\d{14})/,
        replace: `$1${timestamp}`,
        description: 'build label',
      },
    ],
  },
  {
    // Stamps the `?v=YYYYMMDDHHMMSS` cache-bust on the spine's module + CSS
    // imports (styles.css, src/ui/screenPartials.js, src/main.js). Without
    // this, deploying a new build only refreshes the HTML's <meta version>;
    // browsers keep serving the old JS/CSS from cache under the unchanged
    // query string until users hard-reload.
    file: 'index.html',
    updates: [
      {
        find: /\?v=\d{14}/g,
        replace: `?v=${timestamp}`,
        description: 'asset cache-bust query strings',
      },
    ],
  },
];

for (const entry of filesToUpdate) {
  const fullPath = path.join(projectRoot, entry.file);
  let content = fs.readFileSync(fullPath, 'utf8');

  for (const update of entry.updates) {
    // `find` is reused across iterations (and entries) when it carries the
    // /g flag — its lastIndex would survive between calls. Clone the regex
    // so .test() below is independent of .replace() above.
    const probe = new RegExp(update.find.source, update.find.flags.replace('g', ''));
    const hadMatch = probe.test(content);
    const nextContent = content.replace(update.find, update.replace);

    if (nextContent === content) {
      // Identical output is a no-op when the pattern is already present
      // (stamp-build run twice in the same UTC second). Only fail when
      // the pattern doesn't appear at all — that means we couldn't find
      // the thing we were supposed to stamp.
      if (hadMatch) continue;
      if (entry.optional) continue;
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
