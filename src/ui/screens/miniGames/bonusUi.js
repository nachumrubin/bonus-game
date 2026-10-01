// bonusUi — small DOM builders shared by the boost mini-games, so every game
// uses the same classes (styled in screens-glass.css, "BOOST MINI-GAMES")
// instead of per-file inline cssText.
//
//   setTone(el, base, tone)       — el.className = base [+ is-ok|is-bad|is-warn]
//   buildWordEntry(doc, opts)     — word input + ⌫ key + full-width ✓ button
//   buildWordFeed(doc)            — found-word chips + one-line feedback
//
// Everything tolerates the minimal stub documents the unit tests pass.

// tone: 'ok' | 'bad' | 'warn' | true (ok) | false (bad) | null/'' (neutral)
export function setTone(el, base, tone) {
  if (!el) return;
  const t = tone === true ? 'ok' : tone === false ? 'bad' : (tone || '');
  el.className = t ? `${base} is-${t}` : base;
}

// Input row used by the free-typing games (honeycomb, letter spinner):
//   [ input ………… ][⌫]
//   [       ✓ (primary)      ]
export function buildWordEntry(doc, {
  inputId = '',
  placeholder = '',
  inputMode = '',
  onSubmit = () => {},
} = {}) {
  const wrap = doc.createElement('div');
  wrap.className = 'bz-entry';
  const row = doc.createElement('div');
  row.className = 'bz-entry-row';

  const input = doc.createElement('input');
  input.type = 'text';
  if (inputId) input.id = inputId;
  input.className = 'ri bz-input';
  input.dir = 'rtl';
  input.placeholder = placeholder;
  if (inputMode) input.inputMode = inputMode;
  input.setAttribute?.('autocomplete', 'off');
  input.addEventListener('keydown', (e) => {
    if (e?.key === 'Enter') { e.preventDefault?.(); onSubmit(); }
  });

  const clr = doc.createElement('button');
  clr.type = 'button';
  clr.className = 'bz-key';
  clr.textContent = '⌫';
  clr.setAttribute?.('aria-label', 'נקה');
  clr.addEventListener('click', () => { input.value = ''; input.focus?.(); });

  const ok = doc.createElement('button');
  ok.type = 'button';
  ok.className = 'bz-btn';
  ok.textContent = '✓';
  ok.setAttribute?.('aria-label', 'שלח מילה');
  ok.addEventListener('click', onSubmit);

  row.appendChild(input);
  row.appendChild(clr);
  wrap.appendChild(row);
  wrap.appendChild(ok);
  return { wrap, input };
}

// Found-word chips + the single feedback line under them.
export function buildWordFeed(doc) {
  const chips = doc.createElement('div');
  chips.className = 'bz-chips';
  const fb = doc.createElement('div');
  fb.className = 'bz-fb';
  return {
    chips,
    fb,
    addChip({ word, points }) {
      const chip = doc.createElement('span');
      chip.className = 'bz-chip';
      chip.textContent = `${word} +${points}`;
      chips.appendChild(chip);
      chips.scrollTop = chips.scrollHeight;
    },
    say(msg, tone) {
      fb.textContent = msg;
      setTone(fb, 'bz-fb', tone);
    },
  };
}
