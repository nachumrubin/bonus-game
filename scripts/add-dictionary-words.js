#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const DICTIONARY_B64_REGEX = /(const B64 = ")(.*?)(";)/s;

function parseInputWords(args) {
  const raw = args.join(' ');
  return raw
    .split(/[\s,]+/u)
    .map((word) => word.trim())
    .filter(Boolean);
}

function addWordsToDictionaryText(dictionaryText, wordsToAdd) {
  const lines = dictionaryText.split(/\r?\n/);
  const existing = new Set(lines.map((line) => line.trim()).filter(Boolean));
  const appended = [];

  for (const word of wordsToAdd) {
    if (!existing.has(word)) {
      existing.add(word);
      lines.push(word);
      appended.push(word);
    }
  }

  return {
    nextDictionaryText: lines.join('\n'),
    appended,
    totalWords: existing.size,
  };
}

function replaceDictionaryB64InHtml(html, nextDictionaryB64) {
  if (!DICTIONARY_B64_REGEX.test(html)) {
    throw new Error('Could not locate embedded dictionary B64 payload in index.html');
  }

  return html.replace(DICTIONARY_B64_REGEX, `$1${nextDictionaryB64}$3`);
}

function decodeBase64ToUtf8(b64) {
  return Buffer.from(b64, 'base64').toString('utf8');
}

function encodeUtf8ToBase64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

function runCli() {
  const words = parseInputWords(process.argv.slice(2));

  if (words.length === 0) {
    console.error('Usage: node scripts/add-dictionary-words.js <word1> <word2> ...');
    console.error('You can also pass comma-separated words.');
    process.exit(1);
  }

  const projectRoot = path.resolve(__dirname, '..');
  const indexPath = path.join(projectRoot, 'index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf8');

  const dictMatch = indexHtml.match(DICTIONARY_B64_REGEX);
  if (!dictMatch || !dictMatch[2]) {
    throw new Error('Could not locate embedded dictionary B64 payload in index.html');
  }

  const currentDictionaryB64 = dictMatch[2];
  const currentDictionaryText = decodeBase64ToUtf8(currentDictionaryB64);
  const { nextDictionaryText, appended, totalWords } = addWordsToDictionaryText(currentDictionaryText, words);

  if (appended.length === 0) {
    console.log('No new words were added. Dictionary was unchanged.');
    return;
  }

  const nextDictionaryB64 = encodeUtf8ToBase64(nextDictionaryText);
  const nextIndexHtml = replaceDictionaryB64InHtml(indexHtml, nextDictionaryB64);

  fs.writeFileSync(indexPath, nextIndexHtml);

  console.log(`Added ${appended.length} words.`);
  console.log(`Total dictionary size: ${totalWords}`);
  console.log(`Words added: ${appended.join(', ')}`);
}

if (require.main === module) {
  runCli();
}

module.exports = {
  addWordsToDictionaryText,
  decodeBase64ToUtf8,
  encodeUtf8ToBase64,
  parseInputWords,
  replaceDictionaryB64InHtml,
  DICTIONARY_B64_REGEX,
};
