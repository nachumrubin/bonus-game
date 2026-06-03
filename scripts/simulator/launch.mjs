// launch.mjs
//
// Tiny launcher: spawns `firebase emulators:exec --only database` with
// `node scripts/simulator/runSimulator.mjs <forwarded args>` as the inner
// command. Exists because `firebase emulators:exec`'s argv parser swallows
// anything that follows the inner command string, so the natural form
// `npm run sim -- --games 2` doesn't work without this indirection.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RUN_SCRIPT = path.relative(REPO_ROOT, path.join(__dirname, 'runSimulator.mjs')).split(path.sep).join('/');

const forwarded = process.argv.slice(2).map(quoteIfNeeded).join(' ');
const innerCmd = forwarded
  ? `node ${RUN_SCRIPT} ${forwarded}`
  : `node ${RUN_SCRIPT}`;

// Build a single shell command string so the inner command stays intact when
// firebase emulators:exec hands it to its shell. With shell:true and a single
// string, the OS shell parses everything correctly.
const shellCommand = `npx firebase emulators:exec --project demo-bonus-game --only database ${JSON.stringify(innerCmd)}`;

const child = spawn(shellCommand, {
  cwd: REPO_ROOT,
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => process.exit(code ?? 1));

function quoteIfNeeded(s) {
  if (/[\s"']/.test(s)) return JSON.stringify(s);
  return s;
}
