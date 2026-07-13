/* sw.js — オフラインでも開けるようにアプリ本体をキャッシュする */
var CACHE = "kame-v7";
var ASSETS = [
  ".",
  "index.html",
  "css/style.css",
  "js/core.js",
  "js/storage.js",
  "js/chart.js",
  "js/app.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  // 同期APIへの通信はキャッシュしない
  if (e.request.method !== "GET" || e.request.url.indexOf("script.google.com") >= 0) return;
  e.respondWith(
    // ネット優先・失敗したらキャッシュ(更新が反映されやすい)
    fetch(e.request)
      .then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return res;
      })
      .catch(function () { return caches.match(e.request); })
  );
});
