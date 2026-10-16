// Keeps the app working offline. Network first, so a new version arrives whenever there is a connection.
var CACHE='habits-v12';
var FILES=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png'];
self.addEventListener('install',function(e){e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(FILES.map(function(f){return new Request(f,{cache:'reload'});}));}).then(function(){return self.skipWaiting();}));});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k!==CACHE;}).map(function(k){return caches.delete(k);}));}).then(function(){return self.clients.claim();}));});
self.addEventListener('fetch',function(e){
  if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;
  e.respondWith(fetch(e.request,{cache:'no-cache'}).then(function(r){var cp=r.clone();caches.open(CACHE).then(function(c){c.put(e.request,cp);});return r;})
    .catch(function(){return caches.match(e.request,{ignoreSearch:true}).then(function(r){return r||caches.match('./index.html');});}));
});
