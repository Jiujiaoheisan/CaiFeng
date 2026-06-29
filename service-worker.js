// 裁档 · 衣样图录 - Service Worker
// 作用：缓存App外壳文件，让应用可以离线启动，并满足"可安装PWA"的技术条件
// 注意：用户的实际衣样数据（图片、记录）始终存在 localStorage 里，不经过这里，
// 这个文件只负责让页面本身（HTML/JS/图标）离线也能加载出来。

const CACHE_NAME = 'caidang-shell-v3';
const SHELL_FILES = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './vendor/jspdf.min.js',
  './vendor/html2canvas.min.js',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-192.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

// 缓存优先策略：先尝试本地缓存，没有再走网络（保证彻底离线也能打开App外壳）
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          // 顺手把新请求到的同源文件也缓存起来
          if (response && response.status === 200 && event.request.url.startsWith(self.location.origin)) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
