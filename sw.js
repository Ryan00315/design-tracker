// ==========================================
// 🚀 PWA 離線快取與自動更新核心 (Service Worker)
// ==========================================

// 💡 每次您更新了 app.js 或 style.css，請記得把這裡的 v1 往上加 (例如改成 v2, v3...)
const CACHE_NAME = 'pms-cache-v1'; 

// 這些是守衛需要抓下來存進硬碟的檔案清單
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './favicon.ico' // 👈 配合剛剛改名的小圖示
];

// 1. 安裝階段：把上面的檔案通通存起來
self.addEventListener('install', event => {
  // skipWaiting() 會讓新的 Service Worker 不要等，準備立刻接管
  self.skipWaiting(); 
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('📦 開啟快取儲存空間');
      return cache.addAll(urlsToCache);
    })
  );
});

// 2. 啟動階段：清掉舊版本的快取垃圾
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          // 如果發現舊版本的快取 (名字跟現在的 CACHE_NAME 不一樣)，就刪掉它！
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ 刪除舊版本快取:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // 強制立刻控制所有開啟的網頁
  );
});

// 3. 攔截請求：採用「網路優先 (Network First)」策略
self.addEventListener('fetch', event => {
  event.respondWith(
    // 先嘗試去網路抓取最新的檔案
    fetch(event.request)
      .then(response => {
        // 如果抓取成功，而且狀態正常，就順便更新快取裡的備份
        if (response && response.status === 200 && response.type === 'basic') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        }
        return response; // 把最新的檔案還給網頁
      })
      .catch(() => {
        // 只有在真的斷網、抓不到的時候，才從快取裡面拿舊檔案出來顯示
        return caches.match(event.request);
      })
  );
});

// 4. 監聽從 index.html 傳來的「強制接管」指令
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
