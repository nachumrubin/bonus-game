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
  // The new spine's pushPayloadBuilder writes `data.type = kind` for both
  // legacy and new kinds, plus `data.roomId` (new) alongside `data.roomCode`
  // (legacy). Read both so we work either way.
  var roomId = data.roomId || data.roomCode || null;
  var kind = data.type;

  // Map kind → URL + postMessage type. Unknown kinds fall through to '/'.
  var route = mapKindToRoute(kind, roomId);

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) {
          if (route.message) list[i].postMessage(route.message);
          return list[i].focus();
        }
      }
      return clients.openWindow(route.url);
    })
  );
});

function mapKindToRoute(kind, roomId) {
  switch (kind) {
    case 'invite':
      return {
        url: roomId ? '/?join=' + roomId : '/',
        message: roomId ? { type: 'OPEN_JOIN', roomCode: roomId, roomId: roomId } : null,
      };
    case 'invite_accepted':
      return {
        url: roomId ? '/?resume=' + roomId : '/',
        message: roomId ? { type: 'OPEN_TURN', roomCode: roomId, roomId: roomId } : null,
      };
    case 'invite_rejected':
      return { url: '/', message: null };
    case 'turn':
    case 'reminder':
      return {
        url: roomId ? '/?resume=' + roomId : '/',
        message: roomId ? { type: 'OPEN_TURN', roomCode: roomId, roomId: roomId } : null,
      };
    case 'completed':
    case 'expired':
      return {
        url: roomId ? '/?summary=' + roomId : '/',
        message: roomId ? { type: 'OPEN_GAME_SUMMARY', roomCode: roomId, roomId: roomId } : null,
      };
    case 'friendRequest':
    case 'friendAccepted':
      return { url: '/?profile=friends', message: { type: 'OPEN_PROFILE' } };
    default:
      return { url: '/', message: null };
  }
}

var CACHE_NAME = 'boost-20260603021711';
var ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './icon.svg',
  './icon-512.png',
  './data/dictionary.base.txt',
  './jocker.PNG',
  './assets/music/inspire-action.mp3',
  './src/ui/screenPartials.js',
  './src/ui/screenPartialManifest.js',
  './partials/screens/admin-advanced-settings-overlay.html',
  './partials/screens/admin-confirm-decision-overlay.html',
  './partials/screens/admin-login-overlay.html',
  './partials/screens/avatar-gallery-screen.html',
  './partials/screens/avatar-unlock-overlay.html',
  './partials/screens/back-confirm-overlay.html',
  './partials/screens/bonus-challenge.html',
  './partials/screens/bonus-intro-shown-before-every-interactive-boost-mini-game.html',
  './partials/screens/boost-veto-notice.html',
  './partials/screens/champions-standalone-from-home-screen.html',
  './partials/screens/coin-toss.html',
  './partials/screens/end.html',
  './partials/screens/exchange.html',
  './partials/screens/friends-screen.html',
  './partials/screens/game.html',
  './partials/screens/guest-upgrade-overlay.html',
  './partials/screens/home.html',
  './partials/screens/incoming-game-invite.html',
  './partials/screens/invite-rejected.html',
  './partials/screens/joker-picker.html',
  './partials/screens/log-in-screen.html',
  './partials/screens/online-create-room.html',
  './partials/screens/online-disconnect.html',
  './partials/screens/online-join-code.html',
  './partials/screens/online-lobby.html',
  './partials/screens/online-matchmaking.html',
  './partials/screens/online-waiting-room.html',
  './partials/screens/pause-overlay.html',
  './partials/screens/profile-screen.html',
  './partials/screens/settings.html',
  './partials/screens/setup.html',
  './partials/screens/shailta-overlay.html',
  './partials/screens/sign-up-screen.html',
  './partials/screens/stats-screen.html',
  './partials/screens/tutorial-intro-modal.html',
  './partials/screens/tutorial-overlay-elements.html',
  './partials/screens/tutorial-prompt-shown-to-new-users-on-first-game-mode-entry.html',
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
  var url = e.request.url || '';
  // Cache API does not support non-http(s) schemes (e.g. chrome-extension://).
  if(url.indexOf('http') !== 0) return;
  var isSourceAsset = url.indexOf('/src/') !== -1 ||
    url.indexOf('/partials/') !== -1 ||
    url.indexOf('.js') !== -1 ||
    url.indexOf('.css') !== -1;
  var isHTML = e.request.mode === 'navigate' ||
    url.endsWith('/') ||
    url.indexOf('index.html') !== -1 ||
    (e.request.headers && (e.request.headers.get('accept') || '').indexOf('text/html') !== -1);
  if(isHTML){
    e.respondWith(
      fetch(e.request).then(function(resp){
        if(resp && resp.status === 200 && resp.type === 'basic'){
          var clone = resp.clone();
          caches.open(CACHE_NAME).then(function(cache){
            cache.put('./index.html', clone);
          });
        }
        return resp;
      }).catch(function(){
        return caches.match('./index.html').then(function(cached){
          return cached || caches.match('./');
        });
      })
    );
    return;
  }
  if(isSourceAsset){
    e.respondWith(
      fetch(e.request).then(function(resp){
        if(resp && resp.status === 200 && resp.type === 'basic'){
          var clone = resp.clone();
          caches.open(CACHE_NAME).then(function(cache){
            cache.put(e.request, clone);
          });
        }
        return resp;
      }).catch(function(){
        return caches.match(e.request).then(function(cached){
          return cached || caches.match('./index.html');
        });
      })
    );
    return;
  }
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
