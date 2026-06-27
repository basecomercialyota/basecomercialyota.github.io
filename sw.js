// ════════════════════════════════════════════════════════════
// SERVICE WORKER — Yota Energia Solar PWA
// Estratégia:
//   - App principal (index.html / navegação): NETWORK FIRST
//       -> online: sempre confere com o servidor e pega a versão mais nova (no-cache)
//       -> offline: usa a última versão guardada (continua funcionando)
//   - Chamadas de API (Railway/Mongo/Google): Network First
//   - Demais assets (ícones, fontes): Cache First com atualização em 2º plano
// ════════════════════════════════════════════════════════════

const CACHE_NAME    = 'yota-solar-v3';
const OFFLINE_PAGE  = 'index.html';

// Arquivos para cache no install
const PRECACHE_URLS = [
  'index.html',
  'manifest.json',
];

// ── Install: cache arquivos essenciais ──
self.addEventListener('install', function(event) {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      console.log('[SW] Caching essential files');
      return cache.addAll(PRECACHE_URLS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// ── Activate: limpar caches antigas ──
self.addEventListener('activate', function(event) {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          return key !== CACHE_NAME;
        }).map(function(key) {
          console.log('[SW] Deleting old cache:', key);
          return caches.delete(key);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── Fetch: estratégia híbrida ──
self.addEventListener('fetch', function(event) {
  var req = event.request;
  var url = new URL(req.url);

  // API calls: Network First (tenta online, falha graciosamente)
  if (url.hostname.includes('railway.app') ||
      url.hostname.includes('mongodb') ||
      url.hostname.includes('googleapis')) {
    event.respondWith(
      fetch(req).catch(function() {
        return new Response(
          JSON.stringify({ erro: 'Sem conexão. Dados salvos localmente.' }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // App principal (index.html / navegação): NETWORK FIRST
  // Sempre busca a versão mais nova quando online; usa o cache só se estiver offline.
  // É isto que acaba com a necessidade de "Cmd + Shift + R".
  var isAppShell = req.mode === 'navigate' ||
                   url.pathname === '/' ||
                   url.pathname.endsWith('/') ||
                   url.pathname.endsWith('index.html');
  if (isAppShell) {
    event.respondWith(
      fetch(req.url, { cache: 'no-cache' }).then(function(response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(OFFLINE_PAGE, clone);
          });
        }
        return response;
      }).catch(function() {
        return caches.match(OFFLINE_PAGE);
      })
    );
    return;
  }

  // Demais assets: Cache First (serve do cache, atualiza em background)
  event.respondWith(
    caches.match(req).then(function(cached) {
      if (cached) {
        // Atualiza cache em background
        fetch(req).then(function(response) {
          if (response && response.status === 200) {
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(req, response);
            });
          }
        }).catch(function() {});
        return cached;
      }

      // Não está no cache: busca na rede
      return fetch(req).then(function(response) {
        if (!response || response.status !== 200) return response;
        var responseClone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(req, responseClone);
        });
        return response;
      }).catch(function() {
        // Offline e sem cache: serve o app principal
        return caches.match(OFFLINE_PAGE);
      });
    })
  );
});

// ── Background Sync (sincronizar quando voltar online) ──
self.addEventListener('sync', function(event) {
  if (event.tag === 'sync-proposals') {
    console.log('[SW] Syncing proposals...');
  }
});

// ── Push notifications (futuro) ──
self.addEventListener('push', function(event) {
  if (event.data) {
    var data = event.data.json();
    self.registration.showNotification(data.title || 'Yota Solar', {
      body: data.body || '',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
    });
  }
});
