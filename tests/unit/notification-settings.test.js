const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('index.html', 'utf8');

test('notification settings button is wired to permission request flow', () => {
  assert.match(
    source,
    /<button id="sett-notif-button" onclick="requestNotifPermission\(\)"/,
    'expected settings notification button to call requestNotifPermission'
  );
  assert.match(source, /function _setNotifButtonBusy\(isBusy\)/, 'expected busy state helper for visible feedback');
  assert.match(source, /btn\.disabled = !!isBusy/, 'expected button to disable while requesting permission');
});

test('notification permission flow falls back to browser permission API', () => {
  assert.match(source, /async function _requestBrowserNotificationPermission\(\)/, 'expected browser permission helper');
  assert.match(source, /Notification\.requestPermission\(\)/, 'expected direct browser permission request fallback');
  assert.match(source, /await _syncOneSignalSubscriptionAfterPermission\(\)/, 'expected OneSignal synchronization before reading subscription status');
  assert.match(source, /פעיל בדפדפן/, 'expected visible status when browser notifications are granted without a push subscription');
});

test('notification status handles unsupported and denied browsers visibly', () => {
  assert.match(source, /'Notification' in window/, 'expected feature detection before reading Notification');
  assert.match(source, /el\.textContent = 'לא נתמך'/, 'expected unsupported browser status');
  assert.match(source, /el\.textContent = 'חסום'/, 'expected denied permission status');
  assert.match(source, /_refreshNotifToggle\('מבקש\.\.\.'\)/, 'expected immediate requesting status');
});


test('notification permission flow cannot stay stuck on requesting status', () => {
  assert.match(source, /const NOTIF_ONESIGNAL_TIMEOUT_MS = 4000/, 'expected bounded OneSignal wait time');
  assert.match(source, /function _withNotifTimeout\(promise, label\)/, 'expected timeout wrapper for OneSignal calls');
  assert.match(source, /await _withNotifTimeout\(initOneSignal\(\), 'OneSignal init'\)/, 'expected initOneSignal timeout guard');
  assert.match(source, /await _withNotifTimeout\(OneSignal\.Notifications\.requestPermission\(\), 'OneSignal permission'\)/, 'expected OneSignal permission timeout guard');
  assert.match(source, /_refreshNotifToggle\('מפעיל\.\.\.'\)/, 'expected progress status after browser permission is granted');
  assert.match(source, /_refreshNotifToggle\(_osSubscriptionId \? undefined : 'פעיל בדפדפן'\)/, 'expected terminal granted status even without a push subscription');
});
