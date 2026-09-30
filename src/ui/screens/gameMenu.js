// gameMenu — the in-game ☰ menu (#btn-game-menu → #gm-menu).
//
// Settings, finish/save, music (and pause / async home when their own
// controllers show them) live in this dropdown instead of the top bar. The
// buttons keep their ids + onclick attributes, so the controllers that wire
// them (gameFlowController, audioService, asyncHomeButton) are unaffected.
// The menu closes on any item click, an outside tap, or Escape.

export function wireGameMenu(root) {
  const btn = root?.querySelector?.('#btn-game-menu');
  const menu = root?.querySelector?.('#gm-menu');
  if (!btn || !menu) return () => {};
  const doc = btn.ownerDocument ?? globalThis.document;

  const setOpen = (open) => {
    menu.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  const isOpen = () => menu.classList.contains('open');

  const onBtn = (e) => { e.stopPropagation?.(); setOpen(!isOpen()); };
  // Item clicks still reach their own handlers; closing happens after.
  const onMenu = (e) => { if (e.target?.closest?.('button')) setOpen(false); };
  const onDoc = (e) => {
    if (!isOpen()) return;
    if (menu.contains(e.target) || btn.contains(e.target)) return;
    setOpen(false);
  };
  const onKey = (e) => { if (e.key === 'Escape' && isOpen()) setOpen(false); };

  btn.addEventListener('click', onBtn);
  menu.addEventListener('click', onMenu);
  doc?.addEventListener?.('pointerdown', onDoc, true);
  doc?.addEventListener?.('keydown', onKey);
  setOpen(false);

  return () => {
    btn.removeEventListener('click', onBtn);
    menu.removeEventListener('click', onMenu);
    doc?.removeEventListener?.('pointerdown', onDoc, true);
    doc?.removeEventListener?.('keydown', onKey);
    setOpen(false);
  };
}
