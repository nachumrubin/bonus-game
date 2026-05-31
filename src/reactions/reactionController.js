// Reaction UI controller — mounts the reaction panel, bubbles, and button.
// Pure UI concern: never touches game state, scoring, turns, or timers.
//
// Public API:
//   mountReactionController({ bus, db, roomId, mySlot, storage, root })
//   → returns { dispose }

import { EV } from '../events/eventTypes.js';
import { SETTINGS_CHANGED } from '../ui/screens/settingsScreen.js';
import { REACTIONS, getReactionDisplay } from './reactionsConfig.js';
import {
  sendReaction,
  clearReaction,
  canSendReaction,
  recordReactionSent,
  resetCooldown,
  cooldownRemaining,
  isReactionMuted,
  setReactionMuted,
} from './reactionService.js';

function messagesDisabled() {
  return !!globalThis.gameSettings?.disableMessages;
}

const BUBBLE_VISIBLE_MS  = 2500;
const BUBBLE_FADE_MS     = 400;
const COOLDOWN_TICK_MS   = 200;

export function mountReactionController({
  bus,
  db,
  roomId,
  mySlot,
  storage = globalThis.localStorage ?? null,
  root    = globalThis.document,
}) {
  if (!bus)    throw new Error('mountReactionController: bus required');
  if (!db)     throw new Error('mountReactionController: db required');
  if (!roomId) throw new Error('mountReactionController: roomId required');
  if (mySlot !== 0 && mySlot !== 1) throw new Error('mountReactionController: mySlot must be 0 or 1');

  resetCooldown();

  const cleanups    = [];
  let panelOpen     = false;
  let cooldownTimer = null;

  // ── DOM refs ────────────────────────────────────────────────────────────────

  const overlay = root.getElementById('rxn-overlay');
  const panel   = root.getElementById('rxn-panel');

  // Show only the local player's reaction button
  const slot0Btn = root.getElementById('rxn-btn-slot0');
  const slot1Btn = root.getElementById('rxn-btn-slot1');
  if (slot0Btn) slot0Btn.style.display = mySlot === 0 ? '' : 'none';
  if (slot1Btn) slot1Btn.style.display = mySlot === 1 ? '' : 'none';

  const openBtn = mySlot === 0 ? slot0Btn : slot1Btn;

  if (!openBtn || !panel || !overlay) return { dispose: () => {} };

  function applyMessagingPreference() {
    const off = messagesDisabled();
    if (openBtn) openBtn.style.display = off ? 'none' : '';
    if (off && panelOpen) closeReactionPanel();
  }
  applyMessagingPreference();

  // ── Build panel content ─────────────────────────────────────────────────────

  panel.innerHTML = buildPanelHTML();

  // ── Open / close ────────────────────────────────────────────────────────────

  function openReactionPanel() {
    if (panelOpen) return;
    panelOpen = true;
    overlay.style.display = 'flex';
    overlay.removeAttribute('aria-hidden');
    requestAnimationFrame(() => overlay.classList.add('rxn-overlay-visible'));
  }

  function closeReactionPanel() {
    if (!panelOpen) return;
    panelOpen = false;
    overlay.classList.remove('rxn-overlay-visible');
    overlay.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      if (!panelOpen) overlay.style.display = 'none';
    }, 200);
  }

  // Click on the backdrop (anywhere outside the panel) closes the overlay.
  function onOverlayClick(e) {
    if (e.target === overlay) closeReactionPanel();
  }
  overlay.addEventListener('click', onOverlayClick);
  cleanups.push(() => overlay.removeEventListener('click', onOverlayClick));

  // ── Button interaction ──────────────────────────────────────────────────────

  function onOpenBtnClick(e) {
    e.stopPropagation();
    if (messagesDisabled()) return;
    if (panelOpen) { closeReactionPanel(); return; }
    openReactionPanel();
    updatePanelCooldownState();
  }

  openBtn.addEventListener('click', onOpenBtnClick);
  cleanups.push(() => openBtn.removeEventListener('click', onOpenBtnClick));

  // ── ESC closes panel ────────────────────────────────────────────────────────

  function onKeyDown(e) {
    if (e.key === 'Escape' && panelOpen) closeReactionPanel();
  }
  root.addEventListener('keydown', onKeyDown);
  cleanups.push(() => root.removeEventListener('keydown', onKeyDown));

  // ── Panel item click → send reaction ────────────────────────────────────────

  function onPanelClick(e) {
    const item = e.target.closest('[data-rxn-type][data-rxn-id]');
    if (!item) return;
    const type = item.dataset.rxnType;
    const id   = item.dataset.rxnId;
    if (!canSendReaction()) return;
    closeReactionPanel();
    const now = Date.now();
    recordReactionSent(now);
    startCooldownUI();
    sendReaction(db, roomId, { type, id, senderSlot: mySlot }).catch((err) => {
      console.warn('[reactions] sendReaction failed:', err);
    });
    // Show own bubble immediately (don't wait for Firebase echo)
    const display = getReactionDisplay({ type, id });
    if (display) showReactionBubble(mySlot, display, root);
  }

  panel.addEventListener('click', onPanelClick);
  cleanups.push(() => panel.removeEventListener('click', onPanelClick));

  // ── Mute toggle ─────────────────────────────────────────────────────────────

  function onMuteToggle(e) {
    const toggleBtn = e.target.closest('#rxn-mute-btn');
    if (!toggleBtn) return;
    const next = !isReactionMuted(storage);
    setReactionMuted(storage, next);
    updateMuteBtn(toggleBtn, next);
  }

  panel.addEventListener('click', onMuteToggle);
  cleanups.push(() => panel.removeEventListener('click', onMuteToggle));

  // ── Close button (×) ───────────────────────────────────────────────────────

  function onCloseClick(e) {
    if (e.target.closest('#rxn-close-btn')) closeReactionPanel();
  }
  panel.addEventListener('click', onCloseClick);
  cleanups.push(() => panel.removeEventListener('click', onCloseClick));

  // ── Receive opponent reactions ───────────────────────────────────────────────

  const unsubReaction = bus.on(EV.REACTION_RECEIVED, ({ reaction }) => {
    if (!reaction) return;
    // Don't show own reactions (already shown immediately on send)
    if (Number(reaction.senderSlot) === mySlot) return;
    if (isReactionMuted(storage)) return;
    if (messagesDisabled()) return;
    const display = getReactionDisplay(reaction);
    if (display) showReactionBubble(Number(reaction.senderSlot), display, root);
  });
  cleanups.push(unsubReaction);

  const unsubSettings = bus.on(SETTINGS_CHANGED, (changes = {}) => {
    if ('disableMessages' in changes) applyMessagingPreference();
  });
  cleanups.push(unsubSettings);

  // ── Cooldown UI ──────────────────────────────────────────────────────────────

  function startCooldownUI() {
    openBtn.classList.add('rxn-btn-cooldown');
    openBtn.disabled = true;
    if (cooldownTimer) clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      if (canSendReaction()) {
        openBtn.classList.remove('rxn-btn-cooldown');
        openBtn.disabled = false;
        clearInterval(cooldownTimer);
        cooldownTimer = null;
      }
      updatePanelCooldownState();
    }, COOLDOWN_TICK_MS);
  }

  function updatePanelCooldownState() {
    const isCooling = !canSendReaction();
    panel.querySelectorAll('[data-rxn-type]').forEach(el => {
      el.classList.toggle('rxn-item-disabled', isCooling);
      el.setAttribute('aria-disabled', String(isCooling));
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function buildPanelHTML() {
    const muted = isReactionMuted(storage);
    const muteLabel = muted ? '🔕 ביטול השתקה' : '🔔 השתק תגובות';

    const emojiItems = REACTIONS.emojis.map(e =>
      `<button class="rxn-emoji-item" data-rxn-type="emoji" data-rxn-id="${e.id}" aria-label="${e.id}" type="button">${e.value}</button>`
    ).join('');

    const msgItems = REACTIONS.messages.map(m =>
      `<button class="rxn-msg-item" data-rxn-type="message" data-rxn-id="${m.id}" type="button">${m.text}</button>`
    ).join('');

    return `
      <div class="rxn-panel-header">
        <span class="rxn-panel-title">תגובות</span>
        <button class="rxn-mute-btn" id="rxn-mute-btn" type="button">${muteLabel}</button>
        <button class="rxn-close-btn" id="rxn-close-btn" type="button" aria-label="סגור">×</button>
      </div>
      <div class="rxn-emoji-grid">${emojiItems}</div>
      <div class="rxn-msg-list">${msgItems}</div>
    `;
  }

  function updateMuteBtn(btn, muted) {
    btn.textContent = muted ? '🔕 ביטול השתקה' : '🔔 השתק תגובות';
  }

  // ── Dispose ──────────────────────────────────────────────────────────────────

  function dispose() {
    closeReactionPanel();
    for (const off of cleanups) {
      try { off(); } catch { /* swallow */ }
    }
    cleanups.length = 0;
    if (cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null; }
    // Hide overlay and clean up DOM
    overlay.style.display = 'none';
    overlay.classList.remove('rxn-overlay-visible');
    panel.innerHTML = '';
    if (slot0Btn) slot0Btn.style.display = 'none';
    if (slot1Btn) slot1Btn.style.display = 'none';
    resetCooldown();
    // Best-effort: clear liveReaction so it doesn't replay into the next session
    clearReaction(db, roomId).catch(() => {});
  }

  return { dispose };
}

// ── Shared bubble renderer ───────────────────────────────────────────────────

/**
 * Show a reaction speech bubble emerging from a player's avatar.
 *
 * P1 (slot 0) sits in the right card under RTL layout, so its bubble appears
 * to the LEFT of the avatar with the tail on the bubble's right edge pointing
 * back at the avatar. P2 mirrors. Anchoring on the avatar (not the whole
 * card) and placing the bubble sideways — instead of above the card — keeps
 * it out of the turn-timer / status bar above the score row.
 *
 * @param {0|1} slot - which player's avatar to anchor on
 * @param {string} displayValue - emoji or Hebrew text to display
 * @param {Document} doc
 */
export function showReactionBubble(slot, displayValue, doc = globalThis.document) {
  // Anchor to the avatar (the "mouth" of the speech bubble), falling back to
  // the whole score card if the avatar element isn't in the DOM for any reason.
  const avatarId = slot === 0 ? 'is-av1' : 'is-av2';
  const cardId   = slot === 0 ? 'is-sb1' : 'is-sb2';
  const anchor = doc.getElementById(avatarId) ?? doc.getElementById(cardId);
  if (!anchor) return;

  const rect = anchor.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;

  // Two-element structure: outer = positioning (transform owned by JS),
  // inner = visual styling + open/close animation (transform owned by CSS).
  // Keeping them on different nodes avoids the two transforms fighting.
  const anchorEl = doc.createElement('div');
  anchorEl.className = 'rxn-bubble-anchor';

  const bubble = doc.createElement('div');
  // slot 0 → P1 (right side in RTL): tail on bubble's right pointing at avatar.
  // slot 1 → P2 (left side): tail on bubble's left.
  bubble.className = `rxn-bubble rxn-bubble-${slot === 0 ? 'right' : 'left'}`;
  bubble.dir = 'rtl';
  bubble.textContent = displayValue;
  anchorEl.appendChild(bubble);

  // Sit the bubble vertically centered on the avatar and horizontally adjacent
  // to it, pointing inward toward the screen center.
  const viewportW = doc.documentElement?.clientWidth ?? 360;
  const gap = 10;
  const safety = 6;
  const cy  = Math.round(rect.top + rect.height / 2);

  let leftPx;
  let anchorTransform;
  if (slot === 0) {
    // P1 (right side): bubble's right edge sits `gap` px left of the avatar.
    leftPx          = Math.round(rect.left - gap);
    anchorTransform = 'translate(-100%,-50%)';
  } else {
    // P2 (left side): bubble's left edge sits `gap` px right of the avatar.
    leftPx          = Math.round(rect.right + gap);
    anchorTransform = 'translate(0,-50%)';
  }

  // Width-bound: the bubble shrinks to fit its text but caps at the actual
  // horizontal space between this avatar and the OTHER player's score card,
  // so long messages wrap to 2+ lines instead of overflowing into the opposite
  // card. Hard upper limit at 240px keeps short messages compact.
  const otherCardId = slot === 0 ? 'is-sb2' : 'is-sb1';
  const otherRect   = doc.getElementById(otherCardId)?.getBoundingClientRect() ?? null;
  let maxBw;
  if (slot === 0) {
    // Bubble extends LEFT from leftPx. Must stay right of the other card.
    maxBw = otherRect ? leftPx - otherRect.right - safety : leftPx - safety;
  } else {
    // Bubble extends RIGHT from leftPx. Must stay left of the other card.
    maxBw = otherRect ? otherRect.left - leftPx - safety : (viewportW - leftPx - safety);
  }
  maxBw = Math.max(100, Math.min(maxBw, 240));

  anchorEl.style.cssText = [
    'position:fixed',
    `left:${leftPx}px`,
    `top:${cy}px`,
    `max-width:${maxBw}px`,
    `transform:${anchorTransform}`,
    'z-index:9999',
    'pointer-events:none',
    'display:inline-block', // shrink-to-fit width up to max-width
  ].join(';');

  doc.body.appendChild(anchorEl);

  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => bubble.classList.add('rxn-bubble-in'));
  });

  // Fade out after BUBBLE_VISIBLE_MS — animate the inner bubble, then remove
  // the outer anchor (which removes the bubble too).
  const fadeTimer = setTimeout(() => {
    bubble.classList.add('rxn-bubble-out');
    setTimeout(() => { try { anchorEl.remove(); } catch {} }, BUBBLE_FADE_MS);
  }, BUBBLE_VISIBLE_MS);

  // Safety cleanup
  setTimeout(() => { try { anchorEl.remove(); } catch {} }, BUBBLE_VISIBLE_MS + BUBBLE_FADE_MS + 200);
  void fadeTimer;
}
