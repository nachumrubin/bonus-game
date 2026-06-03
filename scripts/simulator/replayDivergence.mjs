// replayDivergence.mjs
//
// Detects every way a replay can disagree with the production game it was
// extracted from. This is the "did the engine reproduce what the player
// actually saw?" check — significantly broader than crash/invariant
// detection, because real bugs often produce wrong-but-not-crashing output.
//
// Three families of divergence:
//
//   1. PER-MOVE (live, during replay):
//        - replay-engine-rejected — prod accepted a CONFIRM_MOVE that the
//          current engine refuses (reason logged: word-not-in-dictionary,
//          placed-not-in-rack, cell-locked, etc.)
//        - replay-score-mismatch  — engine recomputes a different score
//          for the same placement (scoring/multiplier/bonus regression)
//        - replay-words-mismatch  — engine forms a different word set
//          (cross-word detection drift)
//
//   2. FINAL STATE (after replay-exhausted):
//        - replay-final-scores-mismatch
//        - replay-final-status-mismatch
//        - replay-final-board-mismatch    (which cells hold which letters)
//        - replay-final-bonusboard-mismatch
//        - replay-move-count-mismatch     (replay terminated before all
//          prod moves were dispatched)
//
//   3. COVERAGE:
//        - replay-skipped-move           — bot.pickCommand returned null
//          before the moveHistory was exhausted (slot mismatch, engine
//          turn disagrees, etc.) — silent bail in the prior runner
//
// Every divergence is reported to crashCollector with enough context to
// repro: originalRoomId, move index, expected vs actual.

/**
 * Build a divergence tracker for one replay game.
 * Subscribe to the per-slot buses + call recordDispatch / finalize at the
 * right moments from gameRunner.
 *
 * @param {Object} opts
 * @param {Object} opts.crashCollector
 * @param {string} opts.gameId
 * @param {string} opts.gameSeed
 * @param {Object} opts.expectedFinal      // record.expectedFinal from extractor
 * @param {Array}  opts.moveHistory        // record.moveHistory
 * @param {string} opts.originalRoomId
 */
export function createReplayDivergenceTracker({ crashCollector, gameId, gameSeed, expectedFinal, moveHistory, originalRoomId }) {
  let movesDispatched = 0;
  // Cursor of "which prod move is this dispatch supposed to be." Lines up
  // because gameRunner asks replayBot in moveHistory order.
  let nextMoveIdx = 0;
  // Capture the most recent INVALID_MOVE_REJECTED on EITHER bus so the
  // dispatch-result check can read it. Cleared at the start of each dispatch.
  let lastRejection = null;
  // Capture the most recent MOVE_CONFIRMED so we can compare score/words.
  let lastConfirmed = null;

  function attachBus(bus) {
    bus.on('evt/INVALID_MOVE_REJECTED', (payload) => {
      lastRejection = payload;
    });
    bus.on('evt/MOVE_CONFIRMED', (payload) => {
      // For non-bonus moves this carries the final score. For bonus moves
      // (scoringDeferred=true) this carries the BASE score; the subsequent
      // MOVE_SCORE_COMMITTED will overwrite with the true final via the
      // handler below. Capture both — the later one wins, which is exactly
      // what recordDispatch reads.
      lastConfirmed = payload;
    });
    bus.on('evt/MOVE_SCORE_COMMITTED', (payload) => {
      lastConfirmed = payload;
    });
  }

  function recordDispatch({ commandType, slot, accepted }) {
    // Called by gameRunner AFTER session.dispatch resolves and the version
    // wait completes. accepted = did Firebase commit land?
    if (commandType !== 'cmd/CONFIRM_MOVE') {
      // Pass / exchange / lock — we don't compare those right now.
      nextMoveIdx = advanceCursorPastNonPlace(nextMoveIdx);
      lastRejection = null; lastConfirmed = null;
      return;
    }
    const prodMove = moveHistory[nextMoveIdx];

    if (!accepted) {
      // Engine refused or commit didn't land.
      if (lastRejection) {
        crashCollector.report({
          class: 'replay-engine-rejected',
          gameId, gameSeed,
          detail: `move #${nextMoveIdx} (slot ${slot}) — engine rejected with reason="${lastRejection.reason}"; prod had this move land. originalRoomId=${originalRoomId}`,
          lastCommand: { slot, type: commandType, prodMove },
        });
      } else {
        crashCollector.report({
          class: 'replay-commit-failed',
          gameId, gameSeed,
          detail: `move #${nextMoveIdx} (slot ${slot}) — engine accepted but Firebase commit never landed. originalRoomId=${originalRoomId}`,
          lastCommand: { slot, type: commandType, prodMove },
        });
      }
      nextMoveIdx++;
      lastRejection = null; lastConfirmed = null;
      return;
    }

    // Accepted: compare prod's recorded score/words vs what the engine
    // just emitted via MOVE_CONFIRMED.
    if (prodMove && lastConfirmed) {
      const prodScore = Number(prodMove.score ?? 0);
      const replayScore = Number(lastConfirmed.score ?? 0);
      if (prodScore !== replayScore) {
        crashCollector.report({
          class: 'replay-score-mismatch',
          gameId, gameSeed,
          detail: `move #${nextMoveIdx} (slot ${slot}) — prod score=${prodScore}, replay score=${replayScore} (diff=${replayScore - prodScore}). originalRoomId=${originalRoomId}`,
          lastCommand: { prodMove, replayMove: { score: replayScore, words: lastConfirmed.words } },
        });
      }
      const prodWords = new Set((prodMove.words ?? []).map(String));
      const replayWords = new Set((lastConfirmed.words ?? []).map(String));
      const onlyProd = [...prodWords].filter(w => !replayWords.has(w));
      const onlyReplay = [...replayWords].filter(w => !prodWords.has(w));
      if (onlyProd.length || onlyReplay.length) {
        crashCollector.report({
          class: 'replay-words-mismatch',
          gameId, gameSeed,
          detail: `move #${nextMoveIdx} (slot ${slot}) — onlyInProd=[${onlyProd.join(',')}], onlyInReplay=[${onlyReplay.join(',')}]. originalRoomId=${originalRoomId}`,
          lastCommand: { prodMove, replayMove: { score: replayScore, words: lastConfirmed.words } },
        });
      }
    }

    movesDispatched++;
    nextMoveIdx++;
    lastRejection = null; lastConfirmed = null;
  }

  // moveHistory may interleave place/pass/exchange; the replayBot dispatches
  // them all but we only score-compare places. After a non-place dispatch
  // we still advance the cursor.
  function advanceCursorPastNonPlace(idx) {
    if (idx >= moveHistory.length) return idx;
    const m = moveHistory[idx];
    const t = m?.type;
    if (t === 'pass' || t === 'exchange' || t === 'free-exchange' || t === 'lock') return idx + 1;
    return idx; // it's a place — cursor stays for the caller
  }

  /**
   * Called after replay terminates. Compares the final room state against
   * the prod expected state and reports all divergences.
   */
  function finalize(finalRoom) {
    if (!expectedFinal) return;

    // Move count
    const prodMoves = moveHistory.length;
    if (movesDispatched < prodMoves) {
      crashCollector.report({
        class: 'replay-incomplete',
        gameId, gameSeed,
        detail: `replay processed ${movesDispatched} of ${prodMoves} moves before terminating. originalRoomId=${originalRoomId}`,
      });
    }

    // Status
    if (finalRoom?.status !== expectedFinal.status) {
      crashCollector.report({
        class: 'replay-final-status-mismatch',
        gameId, gameSeed,
        detail: `prod status=${expectedFinal.status}, replay status=${finalRoom?.status}. originalRoomId=${originalRoomId}`,
      });
    }

    // Scores (only meaningful if we got through all moves)
    if (movesDispatched >= prodMoves) {
      const prodS = expectedFinal.scores;
      const replayS = {
        0: Number(finalRoom?.scores?.[0] ?? finalRoom?.scores?.['0'] ?? 0),
        1: Number(finalRoom?.scores?.[1] ?? finalRoom?.scores?.['1'] ?? 0),
      };
      if (prodS[0] !== replayS[0] || prodS[1] !== replayS[1]) {
        crashCollector.report({
          class: 'replay-final-scores-mismatch',
          gameId, gameSeed,
          detail: `prod=[${prodS[0]},${prodS[1]}] replay=[${replayS[0]},${replayS[1]}]. originalRoomId=${originalRoomId}`,
        });
      }

      // Board (which cells hold which letters)
      const prodCells = expectedFinal.boardLetters || {};
      const replayCells = extractCellsFromRoom(finalRoom?.board);
      const cellDiffs = diffCellMaps(prodCells, replayCells);
      if (cellDiffs.length) {
        crashCollector.report({
          class: 'replay-final-board-mismatch',
          gameId, gameSeed,
          detail: `${cellDiffs.length} cell(s) diverge: ${cellDiffs.slice(0, 6).join('; ')}${cellDiffs.length > 6 ? '; ...' : ''}. originalRoomId=${originalRoomId}`,
        });
      }

      // Bonus board (off-grid bonus square placements)
      const prodBB = expectedFinal.bonusBoardLetters || {};
      const replayBB = extractCellsFromRoom(finalRoom?.bonusBoard);
      const bbDiffs = diffCellMaps(prodBB, replayBB);
      if (bbDiffs.length) {
        crashCollector.report({
          class: 'replay-final-bonusboard-mismatch',
          gameId, gameSeed,
          detail: `${bbDiffs.length} bonus-cell(s) diverge: ${bbDiffs.slice(0, 4).join('; ')}${bbDiffs.length > 4 ? '; ...' : ''}. originalRoomId=${originalRoomId}`,
        });
      }
    }
  }

  return { attachBus, recordDispatch, finalize };
}

function extractCellsFromRoom(board) {
  if (!board) return {};
  const out = {};
  if (Array.isArray(board)) {
    board.forEach((cell, i) => { if (cell?.letter) out[i] = cell.letter; });
  } else {
    for (const [k, v] of Object.entries(board)) {
      if (v?.letter) out[k] = v.letter;
    }
  }
  return out;
}

function diffCellMaps(a, b) {
  const diffs = [];
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of allKeys) {
    if (a[k] !== b[k]) diffs.push(`${k}:prod=${a[k] ?? '∅'} replay=${b[k] ?? '∅'}`);
  }
  return diffs;
}
