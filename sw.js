const CACHE_NAME = 'pms-cache-v2'; // 順便把 v1 改成 v2，強迫它更新
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './k-192.png' // 👈 補上這一行，讓系統認識這張圖
];

// ... 底下的 install 和 fetch 程式碼維持原樣不動 ...

// 安裝 Service Worker 並快取檔案
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urlsToCache);
    })
  );
});

// 攔截網路請求，讓 App 在網路不穩時也能載入基本框架
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
