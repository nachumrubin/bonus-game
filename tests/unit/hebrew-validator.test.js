const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('index.html', 'utf8');

function extractValidatorModule() {
  const startMarker = "const _HV = {";
  const endMarker = "window.HebrewValidator = {";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Could not locate Hebrew validator module boundaries in index.html');
  }

  const tail = source.indexOf('};', end);
  if (tail === -1) {
    throw new Error('Could not locate end of window.HebrewValidator assignment');
  }

  return source.slice(start, tail + 2);
}

function loadValidator(dictWords = []) {
  const context = vm.createContext({
    window: {},
    console: { log: () => {}, warn: () => {} },
    Set,
    Map,
    Date,
    String,
  });

  vm.runInContext(extractValidatorModule(), context);
  context.window.HebrewValidator.init(new Set(dictWords));
  return context.window.HebrewValidator;
}

test('normalizeSurface strips non-Hebrew chars and normalizes final letters', () => {
  const hv = loadValidator();
  const result = hv.normalizeSurface(' ץ!כ?ן3 ');

  assert.equal(result.cleaned, 'ץכן');
  assert.equal(result.normalized, 'צכנ');
});

test('generateFinalLetterVariants offers final-letter variant for ending letters', () => {
  const hv = loadValidator();
  assert.deepEqual(Array.from(hv.generateFinalLetterVariants('ספרנ')), ['ספרנ', 'ספרן']);
  assert.deepEqual(Array.from(hv.generateFinalLetterVariants('ספר')), ['ספר']);
});

test('validate prefers FORCE_REJECT over FORCE_ACCEPT', () => {
  const hv = loadValidator();
  hv.FORCE_ACCEPT.add('עלי');

  const out = hv.validate('עלי');
  assert.equal(out.valid, false);
  assert.equal(out.reason, 'force_reject');
});

test('validate accepts configured short words from FORCE_ACCEPT', () => {
  const hv = loadValidator();

  const out = hv.validate('אב');
  assert.equal(out.valid, true);
  assert.equal(out.reason, 'force_accept');
});

test('validate accepts dictionary hit through final-letter variant', () => {
  const hv = loadValidator(['ספרן']);

  const out = hv.validate('ספרנ');
  assert.equal(out.valid, true);
  assert.equal(out.reason, 'exact');
  assert.equal(out.surface, 'ספרן');
});

test('validate rejects too-short words not in FORCE_ACCEPT', () => {
  const hv = loadValidator(['אבג']);

  const out = hv.validate('אג');
  assert.equal(out.valid, false);
  assert.equal(out.reason, 'too_short');
});
