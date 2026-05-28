// Reaction UI controller — mounts the reaction panel, bubbles, and button.
// Pure UI concern: never touches game state, scoring, turns, or timers.
//
// Public API:
//   mountReactionController({ bus, db, roomId, mySlot, storage, root })
//   → returns { dispose }

import { EV } from '../events/eventTypes.js';
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

  const btn   = root.getElementById('rxn-open-btn');
  const panel = root.getElementById('rxn-panel');

  // Show only the local player's reaction button
  const slot0Btn = root.getElementById('rxn-btn-slot0');
  const slot1Btn = root.getElementById('rxn-btn-slot1');
  if (slot0Btn) slot0Btn.style.display = mySlot === 0 ? '' : 'none';
  if (slot1Btn) slot1Btn.style.display = mySlot === 1 ? '' : 'none';

  const openBtn = mySlot === 0 ? slot0Btn : slot1Btn;

  if (!openBtn || !panel) return { dispose: () => {} };

  // ── Build panel content ─────────────────────────────────────────────────────

  panel.innerHTML = buildPanelHTML();

  // ── Open / close ────────────────────────────────────────────────────────────

  function openReactionPanel() {
    if (panelOpen) return;
    panelOpen = true;
    panel.style.display = 'block';
    panel.removeAttribute('aria-hidden');
    positionPanel();
    requestAnimationFrame(() => panel.classList.add('rxn-panel-visible'));
    // Click-outside listener
    setTimeout(() => {
      root.addEventListener('click', handleOutsideClick, { once: true, capture: true });
      root.addEventListener('touchstart', handleOutsideClick, { once: true, capture: true });
    }, 50);
  }

  function closeReactionPanel() {
    if (!panelOpen) return;
    panelOpen = false;
    panel.classList.remove('rxn-panel-visible');
    panel.setAttribute('aria-hidden', 'true');
    root.removeEventListener('click', handleOutsideClick, true);
    root.removeEventListener('touchstart', handleOutsideClick, true);
    setTimeout(() => {
      if (!panelOpen) panel.style.display = 'none';
    }, 180);
  }

  function handleOutsideClick(e) {
    if (panel.contains(e.target) || openBtn.contains(e.target)) {
      // Re-register since we used `once`
      setTimeout(() => {
        root.addEventListener('click', handleOutsideClick, { once: true, capture: true });
        root.addEventListener('touchstart', handleOutsideClick, { once: true, capture: true });
      }, 50);
      return;
    }
    closeReactionPanel();
  }

  function positionPanel() {
    const rect = openBtn.getBoundingClientRect();
    // Position above the button, horizontally centered on it
    const panelW = Math.min(root.documentElement?.clientWidth ?? 320, 300);
    let left = rect.left + rect.width / 2 - panelW / 2;
    // Clamp to viewport
    const margin = 6;
    left = Math.max(margin, Math.min(left, (root.documentElement?.clientWidth ?? 320) - panelW - margin));
    panel.style.left   = `${left}px`;
    panel.style.bottom = `${(root.documentElement?.clientHeight ?? 600) - rect.top + 6}px`;
    panel.style.width  = `${panelW}px`;
    panel.style.top    = 'auto';
  }

  // ── Button interaction ──────────────────────────────────────────────────────

  function onOpenBtnClick(e) {
    e.stopPropagation();
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

  // ── Receive opponent reactions ───────────────────────────────────────────────

  const unsubReaction = bus.on(EV.REACTION_RECEIVED, ({ reaction }) => {
    if (!reaction) return;
    // Don't show own reactions (already shown immediately on send)
    if (Number(reaction.senderSlot) === mySlot) return;
    if (isReactionMuted(storage)) return;
    const display = getReactionDisplay(reaction);
    if (display) showReactionBubble(Number(reaction.senderSlot), display, root);
  });
  cleanups.push(unsubReaction);

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
    // Hide panel and clean up DOM
    panel.style.display = 'none';
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
 * Show a reaction bubble near a player's score card.
 * @param {0|1} slot - which player's card to show near
 * @param {string} displayValue - emoji or Hebrew text to display
 * @param {Document} doc
 */
export function showReactionBubble(slot, displayValue, doc = globalThis.document) {
  // Find the player card to anchor the bubble
  const cardId = slot === 0 ? 'is-sb1' : 'is-sb2';
  const card = doc.getElementById(cardId);
  if (!card) return;

  const rect = card.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;

  const bubble = doc.createElement('div');
  bubble.className = 'rxn-bubble';
  bubble.dir = 'rtl';
  bubble.textContent = displayValue;

  // Position fixed, above the player card, horizontally centered
  const bw = Math.min(180, rect.width + 30);
  bubble.style.cssText = [
    'position:fixed',
    `left:${Math.round(rect.left + rect.width / 2)}px`,
    `top:${Math.round(rect.top - 4)}px`,
    `width:${bw}px`,
    'transform:translate(-50%,-100%)',
    'z-index:9999',
    'pointer-events:none',
  ].join(';');

  doc.body.appendChild(bubble);

  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => bubble.classList.add('rxn-bubble-in'));
  });

  // Fade out after BUBBLE_VISIBLE_MS
  const fadeTimer = setTimeout(() => {
    bubble.classList.add('rxn-bubble-out');
    setTimeout(() => { try { bubble.remove(); } catch {} }, BUBBLE_FADE_MS);
  }, BUBBLE_VISIBLE_MS);

  // Safety cleanup
  setTimeout(() => { try { bubble.remove(); } catch {} }, BUBBLE_VISIBLE_MS + BUBBLE_FADE_MS + 200);
  void fadeTimer;
}
