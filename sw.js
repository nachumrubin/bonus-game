// בוסט — Service Worker
// Cache name includes build timestamp — auto-invalidates on every deploy
var CACHE_NAME = 'boost-20260426140500';
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
