import { norm } from '../core/hebrewDictionary.js';

export const BOT_WORDS_URL = './data/bot-words.txt';
export const BOT_WORDS = [];
export let botWordsReady = false;

function firstHebrewToken(value) {
  const match = String(value ?? '').match(/[\u05d0-\u05ea]+/u);
  return match ? match[0] : '';
}

export function parseBotWordsText(text, { normalize = norm } = {}) {
  const words = [];
  const seen = new Set();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const word = normalize(firstHebrewToken(line));
    if (word.length < 2 || seen.has(word)) continue;
    seen.add(word);
    words.push(word);
  }
  return words;
}

export function setBotWordsFromText(text) {
  BOT_WORDS.length = 0;
  BOT_WORDS.push(...parseBotWordsText(text));
  botWordsReady = true;
  return BOT_WORDS.length;
}

export async function loadBotWords(url = BOT_WORDS_URL) {
  const resp = await fetch(url, { cache: 'no-cache' });
  if (!resp.ok) {
    throw new Error(`bot wordlist fetch failed: ${resp.status}`);
  }
  return setBotWordsFromText(await resp.text());
}

function rngInt(rng, n) {
  if (typeof rng?.int === 'function') return rng.int(n);
  const fn = typeof rng === 'function' ? rng : Math.random;
  return Math.floor(fn() * n);
}

function shuffleInPlace(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rngInt(rng, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function createBotWordList({
  sourceWords = BOT_WORDS,
  maxWordLen = 6,
  cap = Infinity,
  isWordValid = null,
  preserveOrder = true,
  rng = Math.random,
} = {}) {
  const words = [];
  const seen = new Set();

  for (const raw of sourceWords ?? []) {
    const word = norm(firstHebrewToken(raw));
    if (word.length < 2 || word.length > maxWordLen || seen.has(word)) continue;
    if (typeof isWordValid === 'function' && !isWordValid(word)) continue;
    seen.add(word);
    words.push(word);
  }

  if (!preserveOrder) shuffleInPlace(words, rng);
  return Number.isFinite(cap) ? words.slice(0, cap) : words;
}
