import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SFX, TIERS, cueFiles } from './sfxCatalog.js';
import * as sfx from './sfxEngine.js';

function fakeDoc() {
  const handlers = new Map();
  return {
    addEventListener: (type, fn) => handlers.set(type, fn),
    removeEventListener: type => handlers.delete(type),
    tap: () => handlers.get('pointerdown')?.(),
  };
}

function fakeCtx() {
  const param = () => ({ value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect: next => next ?? node(), start() {}, stop() {} });
  const ctx = {
    currentTime: 0, state: 'running', destination: {},
    oscillators: 0, sources: 0,
    createOscillator: () => { ctx.oscillators++; return { ...node(), frequency: param(), type: '' }; },
    createGain: () => ({ ...node(), gain: param() }),
    createBufferSource: () => { ctx.sources++; return { ...node(), playbackRate: param(), buffer: null }; },
    decodeAudioData: async () => ({ duration: 0.3 }),
  };
  return ctx;
}

function setup({ enabled = true, fetchImpl, clock = { t: 0 } } = {}) {
  const doc = fakeDoc();
  const ctx = fakeCtx();
  sfx.init({
    doc, isEnabled: () => enabled, ctxFactory: () => ctx,
    fetchImpl: fetchImpl ?? (async () => ({ ok: false, status: 404 })),
    now: () => clock.t,
  });
  return { doc, ctx, clock, done: () => sfx.dispose() };
}

test('catalog entries are well-formed', () => {
  for (const [id, entry] of Object.entries(SFX)) {
    assert.ok(TIERS.includes(entry.tier), `${id} tier`);
    assert.ok(entry.synth, `${id} needs a synth fallback`);
    assert.ok(entry.file === null || typeof entry.file === 'string', `${id} file`);
  }
});

test('every catalog file exists on disk in both formats', () => {
  for (const entry of Object.values(SFX)) {
    assert.ok(entry.file, 'every cue has a recorded sample (synth is fallback only)');
    for (const file of cueFiles(entry)) {
      for (const ext of ['ogg', 'm4a']) {
        const url = new URL(`../../../assets/sfx/${file}.${ext}`, import.meta.url);
        assert.ok(existsSync(fileURLToPath(url)), `missing assets/sfx/${file}.${ext}`);
      }
    }
  }
});

test('nothing plays before the first user gesture', () => {
  const x = setup();
  assert.equal(sfx.play('move.accepted'), null);
  assert.equal(x.ctx.oscillators, 0);
  x.doc.tap();
  assert.equal(sfx.play('move.accepted'), 'synth');
  x.done();
});

test('disabled sound plays nothing and unknown cues are ignored', () => {
  const x = setup({ enabled: false });
  x.doc.tap();
  assert.equal(sfx.play('move.accepted'), null);
  assert.equal(x.ctx.oscillators, 0);
  x.done();
  const y = setup();
  y.doc.tap();
  assert.equal(sfx.play('no.such.cue'), null);
  y.done();
});

test('throttleMs suppresses rapid repeats of the same cue', () => {
  const x = setup();
  x.doc.tap();
  assert.equal(sfx.play('timer.tick'), 'synth');
  x.clock.t += 100;
  assert.equal(sfx.play('timer.tick'), null);
  x.clock.t += 300;
  assert.equal(sfx.play('timer.tick'), 'synth');
  x.done();
});

test('sample-backed cue falls back to synth until loaded, then plays the sample', async () => {
  const entry = SFX['move.accepted'];
  const original = entry.file;
  // Catalog is frozen at the top level only; entries are plain objects.
  entry.file = 'test_accept';
  const urls = [];
  const x = setup({ fetchImpl: async url => { urls.push(url); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; } });
  try {
    x.doc.tap();
    assert.equal(sfx.play('move.accepted'), 'synth');
    await sfx._whenIdle();
    assert.equal(sfx.play('move.accepted'), 'sample');
    assert.equal(x.ctx.sources, 1);
    assert.ok(urls.some(u => u.endsWith('test_accept.m4a')));
  } finally {
    entry.file = original;
    x.done();
  }
});

test('failed loads keep using the synth fallback without refetching', async () => {
  const entry = SFX['move.invalid'];
  const original = entry.file;
  entry.file = 'test_missing';
  let fetches = 0;
  const x = setup({ fetchImpl: async url => { if (url.includes('test_missing')) fetches++; return { ok: false, status: 404 }; } });
  try {
    x.doc.tap();
    sfx.play('move.invalid');
    await sfx._whenIdle();
    assert.equal(sfx.play('move.invalid'), 'synth');
    await sfx._whenIdle();
    assert.equal(fetches, 1);
  } finally {
    entry.file = original;
    x.done();
  }
});

test('master volume 0 silences every cue; base rate and volume apply to samples', async () => {
  const x = setup();
  x.doc.tap();
  sfx.setMasterVolume(0);
  assert.equal(sfx.play('move.invalid'), null);
  sfx.setMasterVolume(0.5);
  assert.equal(sfx.play('move.invalid'), 'synth');
  x.done();
});

test('every audio file on disk is used by a cue, and every cue is played somewhere in src/', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { allCueFiles } = await import('./sfxCatalog.js');
  const sfxDir = fileURLToPath(new URL('../../../assets/sfx/', import.meta.url));
  const onDisk = new Set(readdirSync(sfxDir).map(f => f.replace(/\.(ogg|m4a)$/, '')));
  const used = new Set(allCueFiles());
  assert.deepEqual([...onDisk].filter(f => !used.has(f)), [], 'orphan files in assets/sfx');

  const srcDir = fileURLToPath(new URL('../../', import.meta.url));
  const sources = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.js') && !p.endsWith('.test.js') && !p.endsWith('sfxCatalog.js')) sources.push(readFileSync(p, 'utf8'));
    }
  })(srcDir);
  const all = sources.join('\n');
  const unused = Object.keys(SFX).filter(id => !all.includes(`'${id}'`));
  assert.deepEqual(unused, [], 'catalog cues nothing plays');
});
