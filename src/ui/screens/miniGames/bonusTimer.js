// Shared bonus-overlay timer bar. Drives the #btw / #btbar elements that
// ship in partials/screens/bonus-challenge.html — every mini-game that
// mounts into #ov-bonus calls startBonusTimer(durationMs) inside its
// attachLegacy() and the returned stop() inside finalize().
//
// The bar shrinks from 100% to 0% over durationMs, switches to the .urg
// (urgent / red) color in the last 30%, and gracefully no-ops in test
// environments where the bonus overlay elements aren't in the DOM.

export function startBonusTimer({ doc = globalThis.document, durationMs = 0 } = {}) {
  const wrap = doc?.getElementById?.('btw');
  const bar  = doc?.getElementById?.('btbar');
  if (!wrap || !bar || !(durationMs > 0)) return () => {};

  // Reset to full width without any transition so the bar always starts at
  // 100% even if the previous mini-game ended mid-animation.
  wrap.style.display = '';
  bar.style.transition = 'none';
  bar.style.width = '100%';
  bar.classList?.remove?.('urg');
  void bar.offsetWidth; // force layout flush so the next transition runs

  bar.style.transition = `width ${durationMs}ms linear, background .5s`;
  bar.style.width = '0%';

  const urgentAt = Math.max(0, Math.floor(durationMs * 0.7));
  const urgentTimer = setTimeout(() => bar.classList?.add?.('urg'), urgentAt);

  return function stopBonusTimer() {
    try { clearTimeout(urgentTimer); } catch { /* swallow */ }
    if (wrap) wrap.style.display = 'none';
    if (bar) {
      bar.style.transition = 'none';
      bar.style.width = '100%';
      bar.classList?.remove?.('urg');
    }
  };
}
