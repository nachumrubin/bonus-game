// launchSoak.mjs — `npm run soak`: start the auth + database emulators and
// run the soak inside them (firebase emulators:exec), forwarding all flags.
// Same argv-forwarding trick as ../launch.mjs.
//
// Preflight: on Windows an emulator orphaned by an earlier Ctrl-C keeps
// ports 9000/9099 bound and emulators:exec then fails with a confusing
// error — check first and say so.

import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const RUN_SCRIPT = path.relative(REPO_ROOT, path.join(__dirname, 'runSoak.mjs')).split(path.sep).join('/');

function portInUse(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(true));
    srv.once('listening', () => srv.close(() => resolve(false)));
    srv.listen(port, '127.0.0.1');
  });
}

const forwarded = process.argv.slice(2);
const busy = [];
for (const p of [9000, 9099, 4400]) if (await portInUse(p)) busy.push(p);
if (busy.length) {
  // Emulators already running (e.g. `npm run emu` in another terminal):
  // run directly against them instead of starting a second set.
  console.log(`[soak] emulator ports ${busy.join(', ')} already in use — assuming emulators are running and connecting to them.`);
  console.log('[soak] (if that is an orphaned emulator from a crashed run, kill the java process and retry)');
  const child = spawn(process.execPath, [RUN_SCRIPT, ...forwarded], { cwd: REPO_ROOT, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 1));
} else {
  const inner = ['node', RUN_SCRIPT, ...forwarded.map(quoteIfNeeded)].join(' ');
  const cmd = `npx firebase emulators:exec --project demo-bonus-game --only auth,database ${JSON.stringify(inner)}`;
  const child = spawn(cmd, { cwd: REPO_ROOT, stdio: 'inherit', shell: true });
  child.on('exit', (code) => process.exit(code ?? 1));
}

function quoteIfNeeded(s) {
  return /[\s"']/.test(s) ? JSON.stringify(s) : s;
}
