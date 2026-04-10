#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const DICTIONARY_B64_REGEX = /(const B64 = ")(.*?)(";)/s;

function decodeBase64ToUtf8(b64) {
  return Buffer.from(b64, 'base64').toString('utf8');
}

function exportDictionaryFile() {
  const projectRoot = path.resolve(__dirname, '..');
  const indexPath = path.join(projectRoot, 'index.html');
  const outDir = path.join(projectRoot, 'data');
  const outPath = path.join(outDir, 'dictionary.base.txt');

  const indexHtml = fs.readFileSync(indexPath, 'utf8');
  const match = indexHtml.match(DICTIONARY_B64_REGEX);

  if (!match || !match[2]) {
    throw new Error('Could not locate embedded dictionary B64 payload in index.html');
  }

  const dictionaryText = decodeBase64ToUtf8(match[2]);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, dictionaryText);

  const words = dictionaryText.split(/\r?\n/u).map((w) => w.trim()).filter(Boolean);
  console.log(`Exported ${words.length} words to ${path.relative(projectRoot, outPath)}`);
}

if (require.main === module) {
  exportDictionaryFile();
}

module.exports = {
  decodeBase64ToUtf8,
  exportDictionaryFile,
  DICTIONARY_B64_REGEX,
};
