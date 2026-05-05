// בוסט — Service Worker
// Cache name includes build timestamp — auto-invalidates on every deploy

// OneSignal (wrapped in try-catch — caching works even if CDN fails to load)
try {
  importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
} catch(e) {
  // OneSignal unavailable — caching and offline mode unaffected
}

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var data = e.notification.data || {};
  var url;
  if (data.type === 'invite' && data.roomCode) url = '/?join=' + data.roomCode;
  else if (data.type === 'friendRequest' || data.type === 'friendAccepted') url = '/?profile=friends';
  else url = '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) {
          if (data.type === 'invite' && data.roomCode) {
            list[i].postMessage({ type: 'OPEN_JOIN', roomCode: data.roomCode });
          } else if (data.type === 'friendRequest' || data.type === 'friendAccepted') {
            list[i].postMessage({ type: 'OPEN_PROFILE' });
          }
          return list[i].focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

var CACHE_NAME = 'boost-20260505190020';
var ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-512.png',
  './data/dictionary.base.txt',
  './jocker.PNG',
];  // sw.js intentionally excluded — browser fetches it fresh

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(k){ return k !== CACHE_NAME; })
            .map(function(k){ return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e){
  if(e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(function(cached){
      if(cached) return cached;
      return fetch(e.request).then(function(resp){
        if(!resp || resp.status !== 200 || resp.type !== 'basic') return resp;
        var clone = resp.clone();
        caches.open(CACHE_NAME).then(function(cache){
          cache.put(e.request, clone);
        });
        return resp;
      }).catch(function(){
        return caches.match('./index.html');
      });
    })
  );
});

self.addEventListener('message', function(e){
  if(e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
