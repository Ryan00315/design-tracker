const CACHE_NAME = 'pms-cache-v3'; // 升級版本號
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './k-192.png'
];

// 1. 安裝時立刻接管
self.addEventListener('install', event => {
  self.skipWaiting(); 
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll('./favicon.ico'))
  );
});

// 2. 啟動時自動清除舊版快取
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName); // 把舊的垃圾清掉
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. 🚀 網路優先策略 (Network First)
self.addEventListener('fetch', event => {
  event.respondWith(
    // 先嘗試去網路抓取最新的檔案
    fetch(event.request)
      .then(response => {
        // 如果抓取成功，順便更新快取裡的備份
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        }
        return response;
      })
      .catch(() => {
        // 如果沒網路 (斷網)，才從快取裡面拿舊檔案出來顯示
        return caches.match(event.request);
      })
  );
});

// 監聽網頁傳來的強制接管指令
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
