// claimStallEndController — owns the "סיים וזכה" stalling-rule claim flow.
//
// When the game enters a state where the local player is leading and the
// scoreless-turn counter has reached STALL_CLAIM_THRESHOLD, the topbar
// button #btn-claim-stall-end becomes visible. Clicking it opens the
// #ov-claim-stall-end confirm overlay; confirming dispatches
// CMD.CLAIM_STALL_END which ends the game with the leader as winner.

import { $, on } from '../domHelpers.js';
import { CMD } from '../../events/commands.js';
import { EV } from '../../events/eventTypes.js';
import { canClaimStallEnd } from '../../game/core/turnManager.js';
import { applyGenderToRoot, getGender } from '../genderText.js';
import { SETTINGS_CHANGED } from '../screens/settingsScreen.js';

export function createClaimStallEndController({
  root = globalThis.document,
  bus,
  activeGameRef = () => globalThis.__spine?.activeGame ?? null,
} = {}) {
  if (!bus) throw new Error('createClaimStallEndController: bus required');

  const cleanups = [];

  // Resolve "my slot" — for online games it's session.mySlot; for offline
  // 2P/bot we show the button on whichever side is currently leading (the
  // active-turn player can claim regardless of whose turn it technically is,
  // because passCount tracks both players' scoreless turns).
  function localSlot() {
    const ag = activeGameRef();
    const ms = ag?.session?.mySlot;
    if (ms === 0 || ms === 1) return ms;
    // Offline: use the slot of whichever player is currently leading.
    const state = ag?.session?.state;
    if (!state) return null;
    const a = state.scores?.[0] ?? 0;
    const b = state.scores?.[1] ?? 0;
    if (a > b) return 0;
    if (b > a) return 1;
    return null;
  }

  function getState() {
    return activeGameRef()?.session?.state ?? null;
  }

  function refreshVisibility() {
    const btn = $('#btn-claim-stall-end', root);
    if (!btn) return;
    const state = getState();
    const slot = localSlot();
    const allowed = state != null && slot != null && canClaimStallEnd(state, slot);
    btn.style.display = allowed ? '' : 'none';
    // Pulsing glow draws attention to the option — players otherwise miss
    // that they can short-circuit a stalled game.
    btn.classList?.[allowed ? 'add' : 'remove']('claim-stall-attention');
  }

  function openConfirm() {
    const overlay = $('#ov-claim-stall-end', root);
    if (!overlay) return;
    applyGenderToRoot(overlay, getGender());
    overlay.classList?.remove('hidden');
  }
  function closeConfirm() {
    const overlay = $('#ov-claim-stall-end', root);
    if (overlay) overlay.classList?.add('hidden');
  }

  // Wire the topbar button click → open confirm overlay.
  const btn = $('#btn-claim-stall-end', root);
  if (btn) {
    cleanups.push(on(btn, 'click', (e) => {
      e.preventDefault?.();
      // Re-check at click time — state may have changed between TURN_CHANGED
      // and the click (e.g. opponent moved during a network race).
      const state = getState();
      const slot = localSlot();
      if (!state || slot == null || !canClaimStallEnd(state, slot)) {
        refreshVisibility();
        return;
      }
      openConfirm();
    }));
  }

  // Wire the confirm-overlay buttons.
  const yesBtn = $('#claim-stall-yes', root);
  const noBtn  = $('#claim-stall-no',  root);
  if (yesBtn) {
    cleanups.push(on(yesBtn, 'click', (e) => {
      e.preventDefault?.();
      closeConfirm();
      const ag = activeGameRef();
      const slot = localSlot();
      if (!ag?.session || slot == null) return;
      ag.session.dispatch?.({ type: CMD.CLAIM_STALL_END, payload: { slot } });
    }));
  }
  if (noBtn) {
    cleanups.push(on(noBtn, 'click', (e) => {
      e.preventDefault?.();
      closeConfirm();
    }));
  }

  cleanups.push(bus.on(SETTINGS_CHANGED, (changes = {}) => {
    if ('gender' in changes) {
      const overlay = $('#ov-claim-stall-end', root);
      if (overlay) applyGenderToRoot(overlay, changes.gender);
    }
  }));

  // Recompute visibility on any state-changing event.
  const refreshOn = [
    EV.GAME_STARTED,
    EV.TURN_CHANGED,
    EV.MOVE_CONFIRMED,
    EV.MOVE_SCORE_COMMITTED,
    EV.TILES_EXCHANGED,
    EV.GAME_COMPLETED,
  ];
  for (const ev of refreshOn) {
    if (!ev) continue;
    cleanups.push(bus.on(ev, () => refreshVisibility()));
  }

  // Hide on game-complete unconditionally (covers race conditions).
  if (EV.GAME_COMPLETED) {
    cleanups.push(bus.on(EV.GAME_COMPLETED, () => {
      const b = $('#btn-claim-stall-end', root);
      if (b) b.style.display = 'none';
      closeConfirm();
    }));
  }

  // Initial paint.
  refreshVisibility();

  return {
    refreshVisibility,
    dispose() {
      for (const off of cleanups.splice(0)) {
        try { off(); } catch {}
      }
    },
  };
}
