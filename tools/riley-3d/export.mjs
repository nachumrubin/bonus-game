import { chromium } from 'playwright-core';
import fs from 'fs';
const [,, outDir, mode] = process.argv;
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 700, height: 700 } });
p.on('console', m => console.log('console:', m.text())); p.on('pageerror', e => console.log('pageerror:', e.message));
await p.goto('http://localhost:8765/tools/riley-3d/export.html'); await p.waitForFunction('window.ready', null, { timeout: 60000 });
const shots = { front: [0, 0.12], three_q: [0.7, 0.2], side: [Math.PI / 2, 0.08], back: [Math.PI, 0.25], top: [0.4, 1.2], face: [0.15, 0.05, 1.1, 0.88] };
for (const [n, a] of Object.entries(shots)) { const d = await p.evaluate((a) => view(...a), a); fs.writeFileSync(`${outDir}/${n}.png`, Buffer.from(d.split(',')[1], 'base64')); }
if (mode === 'glb') { const g = await p.evaluate(() => exportGlb()); fs.writeFileSync(`${outDir}/riley.glb`, Buffer.from(g, 'base64')); }
await b.close();
