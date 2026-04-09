// בוסט — Service Worker
// Cache name includes build timestamp — auto-invalidates on every deploy
var CACHE_NAME = 'boost-20260409161500';
var ASSETS = [
  './',
  './index.html',
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

function isHttpRequest(request){
  var requestUrl = new URL(request.url);
  return requestUrl.protocol === 'http:' || requestUrl.protocol === 'https:';
}

function cacheResponseIfEligible(request, response){
  if(!response || response.status !== 200 || response.type !== 'basic') return response;
  if(!isHttpRequest(request)) return response;
  var clone = response.clone();
  caches.open(CACHE_NAME).then(function(cache){
    cache.put(request, clone);
  });
  return response;
}

self.addEventListener('fetch', function(e){
  if(e.request.method !== 'GET') return;
  if(!isHttpRequest(e.request)) return;

  var isNavigation = e.request.mode === 'navigate';

  if(isNavigation){
    e.respondWith(
      fetch(e.request)
        .then(function(resp){ return cacheResponseIfEligible(e.request, resp); })
        .catch(function(){
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
      return fetch(e.request)
        .then(function(resp){ return cacheResponseIfEligible(e.request, resp); })
        .catch(function(){ return caches.match('./index.html'); });
    })
  );
});

self.addEventListener('message', function(e){
  if(e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
