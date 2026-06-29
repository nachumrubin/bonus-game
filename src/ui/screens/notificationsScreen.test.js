import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bus from '../../events/bus.js';
import { mountNotificationsScreen, NOTIF_INTENT, NOTIF_RENDER } from './notificationsScreen.js';

function makeEl(id = '') {
  const listeners = [];
  return {
    id,
    style: {},
    innerHTML: '',
    textContent: '',
    addEventListener(ev, fn) { listeners.push({ ev, fn }); },
    removeEventListener(ev, fn) {
      const i = listeners.findIndex((l) => l.ev === ev && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatch(ev, event) {
      for (const l of listeners.filter((l) => l.ev === ev)) l.fn(event);
    },
  };
}

function makeDom() {
  const byId = new Map();
  for (const id of [
    'notif-empty',
    'notif-invites-wrap',
    'notif-invites-list',
    'notif-friends-wrap',
    'notif-friends-list',
    'notif-support-wrap',
    'notif-support-list',
  ]) {
    byId.set(id, makeEl(id));
  }
  return {
    byId,
    root: {
      querySelector(sel) {
        if (!sel.startsWith('#')) return null;
        return byId.get(sel.slice(1)) ?? null;
      },
    },
  };
}

test('notifications inbox renders support replies and marks them read', () => {
  bus._reset();
  const { root, byId } = makeDom();
  const marked = [];
  bus.on(NOTIF_INTENT.MARK_SUPPORT_REPLY_READ, (payload) => marked.push(payload));

  mountNotificationsScreen({ root, bus });
  bus.emit(NOTIF_RENDER, {
    supportReplies: [{
      id: 'n1',
      type: 'supportReply',
      title: 'הפנייה שלך טופלה',
      message: 'תודה, בדקנו וטיפלנו.',
      originalMessage: 'לא מצליח לשחק נגד חבר',
      reasonLabel: 'דווח על בעיה במשחק',
      outcomeLabel: 'טופל',
      createdAt: 1782720000000,
    }],
  });

  assert.equal(byId.get('notif-empty').style.display, 'none');
  assert.equal(byId.get('notif-support-wrap').style.display, '');
  assert.match(byId.get('notif-support-list').innerHTML, /הפנייה שלך טופלה/);
  assert.match(byId.get('notif-support-list').innerHTML, /תודה, בדקנו וטיפלנו/);
  assert.match(byId.get('notif-support-list').innerHTML, /הפנייה המקורית/);
  assert.match(byId.get('notif-support-list').innerHTML, /לא מצליח לשחק נגד חבר/);

  byId.get('notif-support-list').dispatch('click', {
    target: {
      tagName: 'BUTTON',
      getAttribute(name) {
        return name === 'data-notif-read-support' ? 'n1' : null;
      },
    },
  });

  assert.deepEqual(marked, [{ id: 'n1' }]);
});
