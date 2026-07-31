// kimi-mc Service Worker：离线可玩
// 策略：install 期 precache 关键静态资产（贴图/音效/字体，清单由 scripts/gen-sw-precache.mjs 生成）；
// 页面 network-first（保证新版本及时生效）；纹理 network-first（atlas 会随版本变化，旧缓存会错位）；
// 其余静态资源 cache-first（JS chunk 带内容哈希，安全长缓存）

const CACHE = 'kimi-mc-v5';

// precache 清单（构建时由 prebuild 生成；缺失时静默降级为纯懒缓存）
try {
  importScripts('/sw-precache-manifest.js');
} catch {
  // ignore
}
const PRECACHE = self.__PRECACHE_MANIFEST__ || [];

self.addEventListener('install', (event) => {
  // 逐个 fetch 写入，个别资产 404 不阻塞 SW 安装
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {}))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 页面导航：网络优先，离线回退到缓存的首页
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // 纹理（atlas/pack/水面条带）：网络优先（内容随版本变化），离线回退缓存
  if (url.pathname.startsWith('/textures/')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request).then((cached) => cached || Response.error())),
    );
    return;
  }

  // 静态资源（JS/CSS/音效/图标）：缓存优先，未命中回源并写入缓存
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        }),
    ),
  );
});
