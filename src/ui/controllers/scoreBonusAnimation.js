// scoreBonusAnimation — visual feedback for auto-extra-score boost
// activations.
//
// Subscribes to EV.BOOST_ACTIVATED and, for `boostId === 'auto_extra_score'`,
// floats a "+N" badge near the appropriate score panel. The badge fades
// out and removes itself after ~1.5s.
//
// Pure-ish: the math/payload-formatting helpers are pure; the DOM mount
// uses document.body and degrades cleanly when no document is present.

import { EV } from '../../events/eventTypes.js';

const DEFAULT_DURATION_MS = 1500;

// Pure: extract a renderable label from a BOOST_ACTIVATED event payload.
// Returns null if the event doesn't represent a score bonus.
export function describeScoreBonus(payload) {
  if (!payload) return null;
  // The bus.emit shape from the engine is (entry-shaped):
  //   { slot, boostId, payload: { extra }, turnNumber }
  // OR a plugin-emitted variant; we accept either.
  const boostId = payload.boostId ?? payload.entry?.boostId;
  if (boostId !== 'auto_extra_score') return null;
  const extra = payload.payload?.extra ?? payload.entry?.payload?.extra ?? payload.extra ?? null;
  if (extra == null || extra === 0) return null;
  const slot = payload.slot ?? payload.entry?.slot ?? null;
  return { slot, extra, label: `+${extra}` };
}

// Best-effort: locate the score-panel element for a slot. Falls back to
// document.body when the legacy panels aren't present.
function findScorePanel(doc, slot) {
  if (!doc?.getElementById) return null;
  // Legacy IDs:
  //   #scn1 wraps slot 0 score; #scn2 wraps slot 1
  //   #ss1, #ss2 are the actual score numbers
  const panel = doc.getElementById(slot === 0 ? 'scn1' : 'scn2')
            ?? doc.getElementById(slot === 0 ? 'ss1'  : 'ss2');
  return panel ?? doc.body ?? null;
}

export function mountScoreBonusAnimation({
  bus, doc = globalThis.document,
  durationMs = DEFAULT_DURATION_MS,
} = {}) {
  if (!bus) throw new Error('mountScoreBonusAnimation: bus required');

  const cleanups = [];
  let pendingFloats = [];

  cleanups.push(bus.on(EV.BOOST_ACTIVATED, (payload) => {
    const info = describeScoreBonus(payload);
    if (!info) return;
    show(info);
  }));

  function show(info) {
    if (!doc?.createElement) return;
    const panel = findScorePanel(doc, info.slot);
    if (!panel) return;
    const float = doc.createElement('div');
    float.className = 'spine-score-bonus-float';
    float.textContent = info.label;
    float.style.cssText =
      'position:absolute;pointer-events:none;font-family:Heebo,sans-serif;font-size:18px;font-weight:900;'
      + 'color:#1ed760;text-shadow:0 1px 4px rgba(0,0,0,.5);'
      + 'animation:spineScoreBonusFloat 1500ms ease-out forwards;';
    // Inject the keyframes once (idempotent)
    ensureKeyframes(doc);
    panel.appendChild?.(float);
    pendingFloats.push(float);
    setTimeout(() => {
      try { float.remove?.(); } catch {}
      pendingFloats = pendingFloats.filter(x => x !== float);
    }, durationMs);
  }

  return {
    unmount() {
      for (const off of cleanups) try { off(); } catch {}
      cleanups.length = 0;
      for (const f of pendingFloats) try { f.remove?.(); } catch {}
      pendingFloats = [];
    },
    _show: show, // exposed for tests
  };
}

let _kfInjected = false;
function ensureKeyframes(doc) {
  if (_kfInjected) return;
  if (!doc?.head?.appendChild || !doc.createElement) return;
  const style = doc.createElement('style');
  style.setAttribute('data-spine-score-bonus', '1');
  style.textContent = '@keyframes spineScoreBonusFloat { 0% { transform: translateY(0); opacity: 0; } 20% { opacity: 1; } 100% { transform: translateY(-32px); opacity: 0; } }';
  doc.head.appendChild(style);
  _kfInjected = true;
}

// Test-only reset
export function _resetForTests() {
  _kfInjected = false;
}
