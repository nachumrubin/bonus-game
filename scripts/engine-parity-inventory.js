#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = process.cwd();
const legacy = execFileSync('git', ['show', 'HEAD:index.html'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});

const srcFiles = walk(path.join(root, 'src'))
  .filter(file => file.endsWith('.js'))
  .map(file => ({
    file,
    rel: path.relative(root, file).replaceAll('\\', '/'),
    text: fs.readFileSync(file, 'utf8'),
  }));

const testFiles = walk(path.join(root, 'tests'))
  .filter(file => file.endsWith('.js'))
  .map(file => fs.readFileSync(file, 'utf8'))
  .join('\n');

const exactMap = {
  BS: ['10x10 board size', 'yes', 'src/game/core/board.js:BOARD_SIZE'],
  HV: ['Hebrew letter values', 'yes', 'src/game/core/letterDistribution.js:HV'],
  HD: ['Hebrew tile distribution', 'yes', 'src/game/core/letterDistribution.js:HD'],
  BDEFS: ['bonus-square coordinates', 'yes', 'src/game/boosts/data.js:BDEFS'],
  BONUS_TYPES: ['bonus tile assignment data', 'partial', 'src/game/boosts/data.js:BONUS_TYPES'],
  DICT: ['dictionary word set', 'yes', 'src/game/core/hebrewDictionary.js:DICT'],
  dictReady: ['dictionary load readiness', 'partial', 'src/game/core/hebrewDictionary.js:dictReady'],
  addWordsFromText: ['load newline dictionary words', 'yes', 'src/game/core/hebrewDictionary.js:addWordsFromText'],
  norm: ['normalize final Hebrew letters', 'yes', 'src/game/core/hebrewDictionary.js:norm'],
  terminalFinalVariants: ['generate terminal final-letter variants', 'yes', 'src/game/core/hebrewDictionary.js:terminalFinalVariants'],
  dictHas: ['dictionary lookup with final-letter variants', 'yes', 'src/game/core/hebrewDictionary.js:dictHas'],
  candidateLemmas: ['legacy lemma candidates', 'yes', 'src/game/core/hebrewDictionary.js:candidateLemmas'],
  guessLemmaFromMissing: ['legacy missing-word lemma guess', 'yes', 'src/game/core/hebrewDictionary.js:guessLemmaFromMissing'],
  looksLikePrefixedParticle: ['prefixed-particle heuristic', 'yes', 'src/game/core/hebrewDictionary.js:looksLikePrefixedParticle'],
  looksLikePossessive: ['possessive heuristic', 'yes', 'src/game/core/hebrewDictionary.js:looksLikePossessive'],
  spellingVariants: ['plene/defective spelling variants', 'yes', 'src/game/core/hebrewDictionary.js:spellingVariants'],
  dictHasPlene: ['plene/defective dictionary lookup', 'yes', 'src/game/core/hebrewDictionary.js:dictHasPlene'],
  analyze: ['fallback dictionary analyzer', 'yes', 'src/game/core/hebrewDictionary.js:analyze'],
  isValid: ['word validation entrypoint', 'yes', 'src/game/core/hebrewDictionary.js:isValid'],
  bData: ['committed 10x10 board tiles', 'yes', 'src/game/core/gameEngine.js:state.board'],
  bBoardData: ['committed off-grid bonus tiles', 'yes', 'src/game/core/gameEngine.js:state.bonusBoard'],
  bag: ['tile bag contents', 'yes', 'src/game/core/gameEngine.js:state.bag'],
  racks: ['player racks', 'yes', 'src/game/core/gameEngine.js:state.racks'],
  scores: ['player scores', 'yes', 'src/game/core/gameEngine.js:state.scores'],
  futBon: ['future boost state', 'partial', 'src/game/core/gameEngine.js:state.activeBoosts + src/game/boosts/futureEffects/*'],
  turn: ['active player', 'yes', 'src/game/core/gameEngine.js:state.currentTurnSlot'],
  firstMove: ['first-move flag', 'yes', 'src/game/core/gameEngine.js:state.firstMove'],
  passCount: ['consecutive pass/timeout count', 'yes', 'src/game/core/turnManager.js:isGameOver uses legacy threshold 6'],
  moveCount: ['number of committed moves', 'partial', 'src/game/core/gameEngine.js:state.moveCount'],
  placed: ['in-progress placements', 'partial', 'UI/session command payload; engine does not retain pending UI state'],
  replacedThisTurn: ['single tile replacement pending state', 'partial', 'src/game/core/gameEngine.js:handleConfirmMove swappedTiles'],
  bonusSqUsed: ['used bonus-square flags', 'yes', 'src/game/core/gameEngine.js:collectBonusActivations/markBonusUsed'],
  lockedCells: ['locked cells', 'yes', 'src/game/core/turnManager.js:lockedCells helpers'],
  lockInventory: ['available lock durations', 'yes', 'src/game/core/gameEngine.js:lockInventory defaults [3,3,5] per player'],
  initBag: ['initialize shuffled tile bag', 'yes', 'src/game/core/tileBag.js:createBag'],
  sh: ['shuffle', 'yes', 'src/util/rng.js + src/game/core/tileBag.js'],
  draw: ['rack refill', 'yes', 'src/game/core/tileBag.js:drawInto'],
  isBonusPos: ['detect bonus square', 'yes', 'src/game/core/board.js:isBonusPos'],
  getCommittedTile: ['read committed board/bonus tile', 'yes', 'src/game/core/board.js:getCommittedTile'],
  getTile: ['read pending-or-committed tile', 'yes', 'src/game/core/board.js:getTileAt'],
  isCollinear: ['move axis validation', 'yes', 'src/game/core/moveValidator.js:isCollinear'],
  hasGaps: ['gap validation', 'yes', 'src/game/core/moveValidator.js:hasGaps'],
  isConnected: ['board connectivity validation', 'yes', 'src/game/core/moveValidator.js:isConnected'],
  getMoveTiles: ['combine placements and replacement tile', 'partial', 'src/game/core/gameEngine.js:placedWithSwaps'],
  getWT: ['main word detection', 'yes', 'src/game/core/scoringEngine.js:getMainWord'],
  getAllWords: ['all created words', 'yes', 'src/game/core/scoringEngine.js:getAllWords'],
  scoreWord: ['word score', 'yes', 'src/game/core/scoringEngine.js:scoreWord'],
  calcTotal: ['move score plus bingo', 'yes', 'src/game/core/scoringEngine.js:scoreMove'],
  buildMoveReview: ['valid/invalid word review model', 'partial', 'src/game/core/gameEngine.js:handleConfirmMove emits invalidWords/invalidWordTiles'],
  playWord: ['main move confirmation pipeline', 'partial', 'src/game/core/gameEngine.js:handleConfirmMove'],
  commitPlay: ['commit score/board/rack/turn', 'partial', 'src/game/core/gameEngine.js + turnManager.applyMove'],
  nextTurn: ['turn transition and turn-start effects', 'partial', 'src/game/core/turnManager.js + boost plugins'],
  doExchange: ['regular tile exchange; legacy unshifts returned tile, shuffles with Math.random, then draws', 'yes', 'src/game/core/gameEngine.js:handleExchange + turnManager.applyExchange'],
  doRecall: ['recall pending UI placements', 'ui-only', 'src/ui/controllers/gameController.js'],
  applyReplacementAt: ['replace committed tile with rack tile', 'partial', 'src/game/core/gameEngine.js:swappedTiles'],
  undoReplacement: ['undo pending replacement', 'ui-only', 'src/ui/controllers/gameController.js'],
  removeOneFromRack: ['rack tile removal helper', 'yes', 'src/game/core/turnManager.js:applyMove/exchangeTilesInPlace'],
  getActivatedBonuses: ['detect bonus squares activated by move', 'yes', 'src/game/core/gameEngine.js:collectBonusActivations'],
  triggerBonus: ['legacy B1-B13 bonus dispatcher', 'partial', 'src/game/boosts/bonusTileDefs.js + futureEffects/*'],
  bonusOk: ['resolve interactive boost result', 'partial', 'src/game/core/gameEngine.js:FINALIZE_BOOST_AWARD only covers score award'],
  bonusSkip: ['skip boost and commit base move', 'unknown', 'no direct engine equivalent found'],
  startT: ['bonus mini-game timer', 'ui-only', 'src/ui/screens/miniGames/bonusTimer.js'],
  clearT: ['clear bonus mini-game timer', 'ui-only', 'src/ui/screens/miniGames/bonusTimer.js'],
  getMoveTimeLimit: ['turn time limit setting', 'partial', 'src/game/settings/settingsCompat.js + UI/session timer controllers'],
  formatTimerSec: ['timer text formatting', 'partial', 'src/ui/controllers/turnTimerController.js'],
  computeTurnSecondsLeft: ['deadline-to-seconds rounding', 'partial', 'src/ui/controllers/turnTimerController.js'],
  consumeTurnTimeLimitForPlayer: ['consume timer bonus', 'partial', 'src/game/boosts/futureEffects/timerBonus.js'],
  expireCurrentMove: ['timeout with pending tiles/pass/game-over', 'partial', 'src/game/core/gameEngine.js:PASS_TURN reason timeout forfeits multiplier; UI recalls pending tiles'],
  startMoveTimer: ['turn timer loop', 'partial', 'src/ui/controllers/turnTimerController.js'],
  serializeGameState: ['legacy online room state serialization', 'partial', 'src/game/online/schema.js + roomService.js'],
  loadGameState: ['legacy online room state restore', 'partial', 'src/game/online/roomService.js:engineStateFromRoom'],
  computeExpiredOnlineTurnState: ['online timeout claim patch', 'partial', 'src/game/online/*'],
  shouldClaimExpiredOnlineTurn: ['online timeout grace guard', 'partial', 'src/game/online/*'],
  listenForMoves: ['online inbound move sync', 'partial', 'src/game/sessions/onlineGameSession.js'],
  pushMoveToFirebase: ['online outbound move sync', 'partial', 'src/game/sessions/onlineGameSession.js + roomService.commitTransaction'],
};

const branchInventory = [
  ['playWord.empty-move', 'no placed/replaced tiles -> reject', 'yes', 'tests/unit/engine-parity.test.js'],
  ['playWord.replace-without-placement', 'swap-only move rejected', 'yes', 'tests/unit/engine-parity.test.js'],
  ['playWord.not-collinear', 'new tiles not in one row/column rejected', 'yes', 'tests/unit/engine-parity.test.js'],
  ['playWord.has-gaps', 'unfilled gaps rejected', 'yes', 'tests/unit/engine-parity.test.js'],
  ['playWord.first-move-on-bonus', 'first move cannot land on bonus square', 'yes', 'tests/unit/engine-parity.test.js'],
  ['playWord.not-connected', 'post-first move must touch committed tile', 'yes', 'tests/unit/engine-parity.test.js'],
  ['playWord.word-too-short', 'formed main word must be at least two letters', 'yes', 'tests/unit/engine-parity.test.js'],
  ['playWord.invalid-no-appeal', 'invalid word forfeits turn without points', 'partial', 'tests/unit/engine-parity.test.js'],
  ['playWord.valid-no-bonus', 'valid move commits immediately after review', 'yes', 'tests/unit/engine-parity.test.js'],
  ['playWord.valid-with-bonus', 'valid move on active bonus square opens/resolves boost before commit', 'yes', 'tests/unit/engine-parity.test.js'],
  ['commitPlay.quadNext', 'x4 applies to word score only and decrements', 'uncovered', 'src/game/boosts/futureEffects/plugins.test.js covers plugin not legacy parity'],
  ['commitPlay.doubleNext', 'x2 applies to word score only and decrements', 'uncovered', 'src/game/boosts/futureEffects/plugins.test.js covers plugin not legacy parity'],
  ['commitPlay.bonusExtra', 'bonus points added after multiplier', 'uncovered', 'none'],
  ['commitPlay.emptyRackEmptyBag', 'end game when player empties rack and bag', 'uncovered', 'none'],
  ['commitPlay.moveLimit', 'configured/max move limit ends game', 'uncovered', 'none'],
  ['nextTurn.extraTurn', 'extra turn keeps same active player', 'yes', 'src/game/core/gameEngine.test.js'],
  ['nextTurn.skipNextTurn', 'skip target player turn effect', 'uncovered', 'none'],
  ['nextTurn.tileSwap', 'turn-start tile-swap pending effect', 'uncovered', 'none'],
  ['nextTurn.lockCountdown', 'locks decrement only after player 2 turn in legacy', 'partial', 'src/game/core/gameEngine.test.js'],
  ['pass.gameOverThreshold', 'legacy pass/timeout threshold is >=6', 'yes', 'tests/unit/engine-parity.test.js'],
  ['exchange.regular', 'exchange rack letters and advance turn', 'yes', 'tests/unit/engine-parity.test.js'],
  ['exchange.freeSwap', 'free swap consumes boost and does not advance', 'yes', 'tests/unit/engine-parity.test.js'],
  ['timer.timeoutPendingTiles', 'timeout recalls pending tiles before passing', 'partial', 'tests/unit/engine-parity.test.js covers multiplier/pass threshold; pending tile recall remains UI-owned'],
  ['online.serializeBoard', '10x10 board serializes as 100 cells', 'yes', 'src/game/online/schema.test.js'],
  ['online.restoreState', 'room state restores board/rack/score/turn', 'partial', 'tests/unit/engine-parity.test.js'],
  ['online.inboundNoRevalidate', 'opponent move applies without dictionary revalidation', 'uncovered', 'none'],
  ['bonus.B1', '100-point long-word mini-game', 'partial', 'tests/unit/engine-parity.test.js covers pending activation state/event'],
  ['bonus.B2', 'auto score or short word bonus branch', 'yes', 'tests/unit/engine-parity.test.js'],
  ['bonus.B3', 'medium word bonus branch', 'uncovered', 'none'],
  ['bonus.B4', 'points/auto branch', 'uncovered', 'none'],
  ['bonus.B5', 'extra turn branch', 'yes', 'tests/unit/engine-parity.test.js + src/game/boosts/futureEffects/plugins.test.js'],
  ['bonus.B6', 'x4 next turn branch', 'partial', 'src/game/boosts/futureEffects/plugins.test.js'],
  ['bonus.B7', 'x2 next turns branch', 'partial', 'src/game/boosts/futureEffects/plugins.test.js'],
  ['bonus.B8', 'timer bonus branch', 'partial', 'src/game/boosts/futureEffects/plugins.test.js'],
  ['bonus.B9', 'auto extra score branch', 'partial', 'src/game/boosts/bonusResolver.test.js'],
  ['bonus.B10', 'cancel next opponent bonus branch', 'partial', 'src/game/boosts/futureEffects/plugins.test.js'],
  ['bonus.B11', 'interactive 100-point branch', 'uncovered', 'none'],
  ['bonus.B12', 'interactive 50-point branch', 'uncovered', 'none'],
  ['bonus.B13', 'wheel outcome branches', 'partial', 'src/game/boosts/bonusResolver.test.js'],
];

const entries = [
  ...scanDeclarations('function', /^function\*?\s+([A-Za-z_$][\w$]*)\s*\(/gm),
  ...scanDeclarations('const', /^const\s+([A-Za-z_$][\w$]*)\b/gm),
  ...scanDeclarations('let', /^let\s+([A-Za-z_$][\w$]*)\b/gm),
  ...scanDeclarations('var', /^var\s+([A-Za-z_$][\w$]*)\b/gm),
].sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));

for (const entry of entries) {
  const mapped = exactMap[entry.name];
  const category = categorize(entry.name);
  entry.behavior = mapped?.[0] ?? inferBehavior(entry.name, category, entry.kind);
  entry.status = mapped?.[1] ?? inferStatus(entry.name, category);
  entry.newEngine = mapped?.[2] ?? inferNewFile(entry.name, category);
  entry.covered = isCovered(entry.name, entry.newEngine, category) ? 'yes' : 'no';
  if (entry.status === 'missing' || entry.status === 'different' || entry.status === 'unknown' || entry.covered === 'no') {
    entry.gap = entry.status === 'ui-only' ? 'out-of-engine or UI coverage needed' : `${entry.status}; coverage=${entry.covered}`;
  } else {
    entry.gap = '';
  }
}

writeInventory(entries);
writeCoverage(entries);
writeReport(entries);

function scanDeclarations(kind, regex) {
  const out = [];
  for (const match of legacy.matchAll(regex)) {
    out.push({
      kind,
      name: match[1],
      line: lineOf(match.index),
    });
  }
  return out;
}

function lineOf(index) {
  return legacy.slice(0, index).split('\n').length;
}

function categorize(name) {
  const n = name.toLowerCase();
  if (/dict|valid|word|lemma|hebrew|shailta|surface|variant/.test(n)) return 'dictionary';
  if (/score|calc|elo|rating|rank|stats/.test(n)) return 'scoring';
  if (/bonus|boost|wheel|honeycomb|crossword|unscramble|fill|search/.test(n)) return 'boost';
  if (/timer|time|deadline|expire|timeout|presence|missed/.test(n)) return 'timer';
  if (/online|firebase|fb|room|invite|matchmaking|session|presence|async|serialize|loadgamestate|pushmove|listenformoves/.test(n)) return 'online';
  if (/rack|bag|draw|exchange|tile|joker|replacement/.test(n)) return 'rack/tile';
  if (/board|cell|grid|committed|gap|connected|collinear|lock|bonuspos/.test(n)) return 'board/validation';
  if (/turn|pass|resign|endgame|startgame|initgame/.test(n)) return 'turn';
  if (/render|show|open|close|ui|screen|overlay|music|audio|avatar|profile|friend|photo|menu|tutorial|legend|champions/.test(n)) return 'ui';
  return 'misc';
}

function inferBehavior(name, category, kind) {
  if (kind !== 'function') return `${category} state/config variable`;
  return `${category} behavior function`;
}

function inferStatus(name, category) {
  if (findExport(name)) return 'yes';
  if (category === 'ui') return 'ui-only';
  if (['dictionary', 'board/validation', 'rack/tile', 'scoring', 'turn', 'boost', 'timer', 'online'].includes(category)) return 'unknown';
  return 'out-of-engine';
}

function inferNewFile(name, category) {
  const direct = findExport(name);
  if (direct) return direct;
  const byCategory = {
    dictionary: 'src/game/core/hebrewDictionary.js or src/game/account/dictionaryService.js',
    'board/validation': 'src/game/core/board.js or moveValidator.js',
    'rack/tile': 'src/game/core/tileBag.js or turnManager.js',
    scoring: 'src/game/core/scoringEngine.js',
    turn: 'src/game/core/turnManager.js or gameEngine.js',
    boost: 'src/game/boosts/*',
    timer: 'src/ui/controllers/turnTimerController.js or sessions',
    online: 'src/game/online/* or src/game/sessions/onlineGameSession.js',
    ui: 'src/ui/*',
  };
  return byCategory[category] ?? '';
}

function findExport(name) {
  for (const f of srcFiles) {
    const re = new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|var)\\s+${escapeRe(name)}\\b`);
    if (re.test(f.text)) return f.rel;
  }
  return null;
}

function inferNewFileFromText(ref) {
  return ref.split(':')[0];
}

function isCovered(name, newEngine, category) {
  if (testFiles.includes(name)) return true;
  const file = newEngine ? inferNewFileFromText(newEngine) : '';
  if (file && testFiles.includes(path.basename(file).replace('.js', '.test.js'))) return true;
  if (category === 'ui' && testFiles.includes(name.replace(/^_/, ''))) return true;
  return false;
}

function writeInventory(rows) {
  const lines = [
    '# Legacy Behavior Inventory',
    '',
    'Generated by `node scripts/engine-parity-inventory.js` from `HEAD:index.html` and the current `src/` tree.',
    '',
    '| Legacy function / variable | Line | Behavior it controls | Modular implementation | New engine file/function | Missing / partial / unknown | Test coverage |',
    '|---|---:|---|---|---|---|---|',
    ...rows.map(r => `| \`${r.name}\` (${r.kind}) | ${r.line} | ${esc(r.behavior)} | ${esc(r.status)} | ${esc(r.newEngine)} | ${esc(r.gap || '-')} | ${r.covered} |`),
  ];
  fs.writeFileSync(path.join(root, 'docs/legacy-behavior-inventory.md'), lines.join('\n') + '\n');
}

function writeCoverage(rows) {
  const uncovered = rows.filter(r => r.covered === 'no' && !['ui-only', 'out-of-engine'].includes(r.status));
  const missing = rows.filter(r => ['missing', 'different', 'unknown'].includes(r.status));
  const lines = [
    '# Engine Parity Coverage Matrix',
    '',
    'Generated by `node scripts/engine-parity-inventory.js`.',
    '',
    `- Legacy declarations scanned: ${rows.length}`,
    `- Engine-relevant uncovered declarations: ${uncovered.length}`,
    `- Missing/different/unknown declarations: ${missing.length}`,
    '',
    '## Rule Branch Coverage',
    '',
    '| Legacy branch | Behavior | Coverage status | Test/source |',
    '|---|---|---|---|',
    ...branchInventory.map(([id, behavior, status, test]) => `| \`${id}\` | ${esc(behavior)} | ${status} | ${esc(test)} |`),
    '',
    '## Uncovered Engine-Relevant Legacy Declarations',
    '',
    '| Legacy item | Line | Category/behavior | Status | Expected new location |',
    '|---|---:|---|---|---|',
    ...uncovered.map(r => `| \`${r.name}\` | ${r.line} | ${esc(r.behavior)} | ${r.status} | ${esc(r.newEngine)} |`),
    '',
    '## Missing, Different, Or Unknown',
    '',
    '| Legacy item | Line | Behavior | Status | Notes |',
    '|---|---:|---|---|---|',
    ...missing.map(r => `| \`${r.name}\` | ${r.line} | ${esc(r.behavior)} | ${r.status} | ${esc(r.gap || r.newEngine)} |`),
  ];
  fs.writeFileSync(path.join(root, 'docs/engine-parity-coverage-matrix.md'), lines.join('\n') + '\n');
}

function writeReport(rows) {
  const critical = rows.filter(r =>
    ['missing', 'different'].includes(r.status) ||
    (r.covered === 'no' && ['dictionary', 'board/validation', 'rack/tile', 'scoring', 'turn', 'boost', 'timer', 'online'].includes(categorize(r.name)))
  );
  const lines = [
    '# Aggressive Engine Audit Report',
    '',
    'Generated by `node scripts/engine-parity-inventory.js`.',
    '',
    'This report intentionally treats uncovered legacy engine behavior as a refactor bug until it is implemented, covered, or explicitly approved as removed.',
    '',
    '## High-Risk Findings',
    '',
    '- Fixed: `passCount` now follows the legacy `passCount >= 6` game-over threshold.',
    '- Fixed: `lockInventory` now initializes as legacy `[3,3,5]` per player.',
    '- Fixed: `bonusSqUsed` is enforced by `gameEngine.handleConfirmMove()` via automatic bonus-square activation.',
    '- Fixed: regular exchange now returns tiles with legacy `unshift`, shuffles with a Math.random-compatible RNG, then refills.',
    '- Partially fixed: timeout `PASS_TURN` now forfeits active score multipliers and uses the six-pass threshold; pending tile recall remains UI-owned.',
    '- Several B1-B13 legacy boost branches are plugin-tested in isolation at best, not parity-tested through legacy trigger/commit semantics.',
    '',
    '## Critical Missing/Different/Uncovered Items',
    '',
    '| Legacy item | Line | Behavior | Status | New location / note |',
    '|---|---:|---|---|---|',
    ...critical.map(r => `| \`${r.name}\` | ${r.line} | ${esc(r.behavior)} | ${r.status}; covered=${r.covered} | ${esc(r.newEngine || r.gap)} |`),
  ];
  fs.writeFileSync(path.join(root, 'docs/engine-parity-audit-report.md'), lines.join('\n') + '\n');
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function esc(value) {
  return String(value ?? '').replaceAll('|', '\\|').replace(/\r?\n/g, '<br>');
}
