// Boot-loader status copy. Pure so tip-failure and offline recovery can be
// tested without mounting main.js. wireAppLoading() in main.js owns the DOM.

export const BOOT_PROGRESS = Object.freeze([
  'מתחבר...',
  'טוען נתונים...',
  'מכין מילים...',
  'כמעט מוכן...',
]);

export const BOOT_FAIL_TEXT = 'לא הצלחנו להתחבר. בודקים שוב...';
export const BOOT_FAIL_HINT = 'אפשר להמשיך כשהרשת חוזרת';

export function createBootStatus({ messages = BOOT_PROGRESS } = {}) {
  let index = 0;
  let mode = 'progress';

  function snapshot() {
    return {
      mode,
      index,
      text: mode === 'fail' ? BOOT_FAIL_TEXT : messages[index],
      hint: mode === 'fail' ? BOOT_FAIL_HINT : null,
    };
  }

  return {
    snapshot,
    advance() {
      if (mode === 'fail') return snapshot();
      index = (index + 1) % messages.length;
      return snapshot();
    },
    fail() {
      mode = 'fail';
      return snapshot();
    },
    recover() {
      mode = 'progress';
      return snapshot();
    },
  };
}
