import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createBootStatus,
  BOOT_PROGRESS,
  BOOT_FAIL_TEXT,
  BOOT_FAIL_HINT,
} from './bootLoadingState.js';

test('healthy boot rotates the progress strings and never shows the fail copy', () => {
  const status = createBootStatus();
  assert.equal(status.snapshot().text, BOOT_PROGRESS[0]);
  assert.equal(status.snapshot().hint, null);
  assert.equal(status.advance().text, BOOT_PROGRESS[1]);
  assert.equal(status.advance().text, BOOT_PROGRESS[2]);
  assert.equal(status.advance().text, BOOT_PROGRESS[3]);
  assert.equal(status.advance().text, BOOT_PROGRESS[0]);
});

test('fail freezes rotation on the offline copy and recover restores progress', () => {
  const status = createBootStatus();
  status.advance();
  const failed = status.fail();
  assert.equal(failed.text, BOOT_FAIL_TEXT);
  assert.equal(failed.hint, BOOT_FAIL_HINT);
  assert.equal(status.advance().text, BOOT_FAIL_TEXT);
  const restored = status.recover();
  assert.equal(restored.mode, 'progress');
  assert.equal(restored.text, BOOT_PROGRESS[1]);
  assert.equal(restored.hint, null);
});
