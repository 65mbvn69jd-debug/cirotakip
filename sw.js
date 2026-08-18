const CACHE_NAME = 'ciro-takip-v5';

const ASSETS = [
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );

  self.skipWaiting();
});

self.addEventListener('activate', event => {

  event.waitUntil(

    caches.keys().then(keys =>
      Promise.all(

        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))

      )
    )

  );

  self.clients.claim();
});

self.addEventListener('fetch', event => {

  if(event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  const isAppFile =
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/cloud-fix.js') ||
    url.pathname.endsWith('/sw.js');

  if(isAppFile){

    event.respondWith(

      fetch(event.request, {
        cache:'no-store'
      }).then(async response => {

        if(url.pathname.endsWith('/index.html')){

          let text = await response.text();

          text = text.replace(
            /\nconst date =\ndocument\.getElementById\("date"\)\.value;[\s\S]*?\n\/\* =====================================================\n   CİRO KAYDET\n/,
            '\n/* =====================================================\n   CİRO KAYDET\n'
          );

          return new Response(text,{
            status:response.status,
            statusText:response.statusText,
            headers:response.headers
          });

        }

        return response;

      })

    );

    return;
  }

  event.respondWith(

    caches.match(event.request).then(cached =>

      cached ||

      fetch(event.request).then(response => {

        const copy=response.clone();

        caches
          .open(CACHE_NAME)
          .then(cache =>
            cache.put(event.request,copy)
          );

        return response;

      })

    )

  );

});