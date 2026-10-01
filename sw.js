// בוסט — Service Worker
// Cache name includes build timestamp — auto-invalidates on every deploy

self.addEventListener('message', function(e){
  if(e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
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
        url: '/?open=notifications',
        message: { type: 'OPEN_NOTIFICATIONS' },
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

var CACHE_NAME = 'boost-20261001132551';
var ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './icon-512.png',
  './data/dictionary.txt',
  './data/bot-words.txt',
  // Navigation / top-bar icons.
  './assets/navigation/bell.png',
  './assets/navigation/sound_on.png',
  './assets/navigation/sound_off.png',
  './assets/navigation/settings.png',
  './assets/navigation/help.png',
  './assets/navigation/home.png',
  './assets/navigation/my_games.png',
  './assets/navigation/friends_nav.png',
  './assets/navigation/statistics_nav.png',
  './assets/navigation/search.png',
  // Home-screen play-mode cards.
  './assets/icons/globe.png',
  './assets/icons/1v1.png',
  './assets/icons/dice.png',
  './assets/icons/friends.png',
  './assets/icons/acheivments.png',
  './assets/icons/statistics.png',
  // Profile-screen button icons.
  './assets/ui/store.png',
  './assets/ui/logout.png',
  './assets/ui/lock.png',
  // Statistics-screen icons (section headers + weekly KPI chips).
  './assets/icons/stats-performance-icon.png',
  './assets/icons/stats-records-icon.png',
  './assets/icons/stats-style-icon.png',
  './assets/icons/stats-rivals-icon.png',
  './assets/icons/stats-average-icon.png',
  './assets/icons/stats-streak-icon.png',
  './assets/icons/stats-wins-icon.png',
  './assets/icons/stats-games-icon.png',
  // Achievement trophy-room icons — one per achievement, named by Hebrew title.
  // A 404 here is harmless (per-asset add().catch + emoji fallback at runtime).
  './assets/achievements/צעדים ראשונים.png',
  './assets/achievements/מנצח.png',
  './assets/achievements/שחקן מנוסה.png',
  './assets/achievements/רצף מנצחים.png',
  './assets/achievements/שועל ותיק.png',
  './assets/achievements/גאון מילים.png',
  './assets/achievements/חבר של כולם.png',
  './assets/achievements/ותיק.png',
  './assets/achievements/אמן המילים.png',
  './assets/achievements/בלתי מנוצח.png',
  './assets/achievements/ברק חי.png',
  './assets/achievements/אגדה.png',
  './assets/achievements/אלוף.png',
  './assets/achievements/בלתי נתפס.png',
  './assets/achievements/מילון מהלך.png',
  './assets/achievements/על-אנושי.png',
  './assets/achievements/האחד.png',
  './assets/achievements/אספן.png',
  './assets/achievements/בעל אגדה.png',
  './assets/achievements/קנייה ראשונה.png',
  './assets/achievements/תורם מילים.png',
  './jocker.PNG',
  './assets/music/inspire-action.mp3',
  './src/ui/screenPartials.js',
  './src/ui/screenPartialManifest.js',
  './partials/screens/avatar-gallery-screen.html',
  './partials/screens/avatar-store-screen.html',
  './partials/screens/avatar-store-confirm-overlay.html',
  './partials/screens/avatar-unlock-overlay.html',
  './partials/screens/back-confirm-overlay.html',
  './partials/screens/bonus-challenge.html',
  './partials/screens/bonus-intro-shown-before-every-interactive-boost-mini-game.html',
  './partials/screens/boost-veto-notice.html',
  './partials/screens/champions-standalone-from-home-screen.html',
  './partials/screens/coin-toss.html',
  './partials/screens/daily-reward-overlay.html',
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
  // NOTE: the 40 store-avatar PNGs in ./assets/avatars_v2/<category>/ are
  // deliberately NOT precached — the runtime fetch handler caches them on
  // demand the first time they're viewed, so we avoid bloating install.
];  // sw.js intentionally excluded — browser fetches it fresh

// ── Images: persistent cache + web-sized WebP ─────────────────────────────
// The PNGs under assets/ are 1024px art masters (up to 2.4 MB each). Next to
// each one, scripts/build-web-images.py writes `<name>.webp` (≤512px, ~10×
// smaller); whenever a PNG is requested we serve that WebP and fall back to
// the PNG if it is missing. Images live in ASSET_CACHE, which — unlike
// CACHE_NAME — survives deploys, so a new build no longer re-downloads every
// image. Each cached image is refreshed in the background once per SW
// lifetime (stale-while-revalidate), so replaced art still lands.
var ASSET_CACHE = 'boost-assets-v1';

function isImageAsset(url) {
  var path = String(url || '').split('#')[0].split('?')[0];
  return /\/(assets|images)\//.test(path) && /\.(png|jpe?g|webp|gif)$/i.test(path);
}

// Sound effects (assets/sfx/*.ogg|m4a) share the persistent asset cache: the
// engine preloads them after the first tap, so from then on they survive
// deploys and play offline. They are not precached at install (each device
// only ever loads one of the two formats).
function isSoundAsset(url) {
  var path = String(url || '').split('#')[0].split('?')[0];
  return path.indexOf('/assets/sfx/') !== -1 && /\.(ogg|m4a)$/i.test(path);
}

// URL of the web-sized WebP for a PNG under assets/ (not the generated
// assets/anim/ atlases), or null when the URL has none.
function webImageUrl(url) {
  var path = String(url || '').split('#')[0].split('?')[0];
  if (path.indexOf('/assets/') === -1 || path.indexOf('/assets/anim/') !== -1) return null;
  return /\.png$/i.test(path) ? path.replace(/\.png$/i, '.webp') : null;
}

function fetchImage(url) {
  var web = webImageUrl(url);
  if (!web) return fetch(url);
  return fetch(web).then(function(resp){
    return resp && resp.ok ? resp : fetch(url);
  }, function(){ return fetch(url); });
}

var _revalidated = {};
function refreshImage(cache, key) {
  _revalidated[key] = true;
  return fetchImage(key).then(function(resp){
    if (resp && resp.ok && resp.type === 'basic') {
      return cache.put(key, resp.clone()).then(function(){ return resp; }, function(){ return resp; });
    }
    return resp;
  });
}

function imageResponse(request) {
  var key = request.url.split('#')[0];
  return caches.open(ASSET_CACHE).then(function(cache){
    return cache.match(key).then(function(hit){
      if (hit) {
        if (!_revalidated[key]) refreshImage(cache, key).catch(function(){});
        return hit;
      }
      return refreshImage(cache, key).catch(function(){
        return caches.match(key).then(function(old){ return old || Response.error(); });
      });
    });
  });
}

self.addEventListener('install', function(e){
  var images = [], core = [];
  ASSETS.forEach(function(u){
    (isImageAsset(new URL(u, self.location.href).href) ? images : core).push(u);
  });
  e.waitUntil(Promise.all([
    caches.open(CACHE_NAME).then(function(cache){
      // Cache each asset independently. cache.addAll() is ATOMIC — a single
      // 404 (e.g. a partial removed from the repo without updating this list)
      // rejects the whole install, so the service worker never registers and
      // the app is left with NO offline cache AND NO push. Per-asset add()
      // with a catch degrades gracefully: a stale entry is just skipped.
      return Promise.all(core.map(function(url){
        return cache.add(url).catch(function(err){
          console.warn('[sw] precache skip', url, err && err.message);
        });
      }));
    }),
    // Images already in the persistent cache are not downloaded again.
    caches.open(ASSET_CACHE).then(function(cache){
      return Promise.all(images.map(function(u){
        var key = new URL(u, self.location.href).href;
        return cache.match(key).then(function(hit){
          return hit || refreshImage(cache, key);
        }).catch(function(err){
          console.warn('[sw] precache skip', u, err && err.message);
        });
      }));
    }),
  ]));
  self.skipWaiting();
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(k){ return k !== CACHE_NAME && k !== ASSET_CACHE; })
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
  if(isImageAsset(url) || isSoundAsset(url)){
    e.respondWith(imageResponse(e.request));
    return;
  }
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
