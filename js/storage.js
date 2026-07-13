/*
 * storage.js — 端末内保存(localStorage/IndexedDB)と Googleスプレッドシート同期(Apps Script)
 *
 * データは常にローカルが第一。同期先(GAS)が設定されていれば、
 * 保存時に送信し、起動時・手動同期時に全件を取得してマージする。
 * オフラインで送れなかった分は outbox に貯めて次回に再送する。
 * 写真は IndexedDB に保存し、同期先があれば Googleドライブにも保存される。
 */
(function () {
  "use strict";

  var KEY_RECORDS = "kame_records_v1";
  var KEY_OUTBOX = "kame_outbox_v1";
  var KEY_SETTINGS = "kame_settings_v1";

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  // ---- 写真ストア(IndexedDB) ----

  var dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open("kame-db", 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore("photos", { keyPath: "id" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function photoTx(mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction("photos", mode);
        var out = fn(tx.objectStore("photos"));
        tx.oncomplete = function () { resolve(out && out.result); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  var Photos = {
    // photo: { id, dataUrl, uploaded }
    save: function (id, dataUrl, uploaded) {
      return photoTx("readwrite", function (store) {
        store.put({ id: id, dataUrl: dataUrl, uploaded: !!uploaded });
      });
    },
    get: function (id) {
      return photoTx("readonly", function (store) { return store.get(id); });
    },
    pending: function () {
      return photoTx("readonly", function (store) { return store.getAll(); })
        .then(function (all) {
          return (all || []).filter(function (p) { return !p.uploaded; });
        });
    },
    markUploaded: function (id) {
      return Photos.get(id).then(function (p) {
        if (p) return Photos.save(p.id, p.dataUrl, true);
      });
    },
  };

  // ---- 本体 ----

  var Storage = {
    Photos: Photos,

    getRecords: function () {
      return readJSON(KEY_RECORDS, []);
    },

    setRecords: function (records) {
      writeJSON(KEY_RECORDS, records);
    },

    getSettings: function () {
      var s = readJSON(KEY_SETTINGS, {});
      if (!Array.isArray(s.foods)) s.foods = [];
      return s;
    },

    setSettings: function (s) {
      writeJSON(KEY_SETTINGS, s);
    },

    // プロフィールは id 固定の特別なレコードとして保存・同期する
    getProfile: function () {
      var rec = Storage.getRecords().find(function (r) { return r.id === "profile"; });
      if (!rec || !rec.note) return {};
      try { return JSON.parse(rec.note); } catch (e) { return {}; }
    },

    setProfile: function (profile) {
      Storage.upsert({
        id: "profile",
        ts: "2000-01-01T00:00:00.000Z", // 集計対象外・一覧の先頭固定
        type: "profile",
        note: JSON.stringify(profile),
      });
    },

    // フード登録も id 固定の特別なレコードとして保存・同期する(家族と共有できる)
    getFoods: function () {
      var rec = Storage.getRecords().find(function (r) { return r.id === "food-defs"; });
      if (rec && !rec.deleted && rec.note) {
        try {
          var arr = JSON.parse(rec.note);
          if (Array.isArray(arr)) return arr;
        } catch (e) {}
      }
      // 旧バージョンは設定(端末内)に保存していたので、レコードがなければそちらを見る
      var s = Storage.getSettings();
      return Array.isArray(s.foods) ? s.foods : [];
    },

    setFoods: function (foods) {
      Storage.upsert({
        id: "food-defs",
        ts: "2000-01-01T00:00:00.000Z", // 集計対象外・一覧に出さない
        type: "fooddefs",
        note: JSON.stringify(foods || []),
      });
    },

    // 旧バージョンが設定に保存していたフード登録を、共有できるレコードへ一度だけ移す
    migrateFoodDefs: function () {
      var hasRec = Storage.getRecords().some(function (r) { return r.id === "food-defs"; });
      var legacy = Storage.getSettings().foods;
      if (!hasRec && Array.isArray(legacy) && legacy.length > 0) {
        Storage.setFoods(legacy);
      }
    },

    // 追加・更新・削除はすべて「レコードを upsert」して outbox に積む
    upsert: function (record, skipSync) {
      record.updatedAt = new Date().toISOString();
      var records = KameCore.mergeRecords(Storage.getRecords(), [record]);
      Storage.setRecords(records);
      var outbox = readJSON(KEY_OUTBOX, []);
      outbox = outbox.filter(function (r) { return r.id !== record.id; });
      outbox.push(record);
      writeJSON(KEY_OUTBOX, outbox);
      if (!skipSync) Storage.trySync();
      return records;
    },

    remove: function (id) {
      var records = Storage.getRecords();
      var target = records.find(function (r) { return r.id === id; });
      if (!target) return records;
      target.deleted = true;
      return Storage.upsert(target);
    },

    exportJSON: function () {
      return JSON.stringify({
        app: "kamechan-daily-memories",
        exportedAt: new Date().toISOString(),
        records: Storage.getRecords(),
      }, null, 2);
    },

    importJSON: function (text) {
      var data = JSON.parse(text);
      var incoming = Array.isArray(data) ? data : data.records;
      if (!Array.isArray(incoming)) throw new Error("形式が違います");
      var merged = KameCore.mergeRecords(Storage.getRecords(), incoming);
      Storage.setRecords(merged);
      return merged;
    },

    // ---- 同期(Google Apps Script) ----

    syncState: { busy: false, lastResult: "" },
    onSyncChange: null, // UI が差し替えるコールバック

    hasSync: function () {
      return !!Storage.getSettings().gasUrl;
    },

    notify: function (msg) {
      Storage.syncState.lastResult = msg;
      if (Storage.onSyncChange) Storage.onSyncChange(Storage.syncState);
    },

    gasPost: function (payload) {
      var s = Storage.getSettings();
      payload.token = s.gasToken;
      return fetch(s.gasUrl, {
        method: "POST",
        // GAS で CORS プリフライトを避けるため text/plain で送る
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      }).then(function (res) {
        if (!res.ok) throw new Error("送信エラー " + res.status);
        return res.json();
      }).then(function (body) {
        if (body.error) throw new Error(body.error);
        return body;
      });
    },

    gasGet: function (params) {
      var s = Storage.getSettings();
      var qs = "token=" + encodeURIComponent(s.gasToken);
      for (var k in params) qs += "&" + k + "=" + encodeURIComponent(params[k]);
      var url = s.gasUrl + (s.gasUrl.indexOf("?") >= 0 ? "&" : "?") + qs;
      return fetch(url).then(function (res) {
        if (!res.ok) throw new Error("取得エラー " + res.status);
        return res.json();
      }).then(function (body) {
        if (body.error) throw new Error(body.error);
        return body;
      });
    },

    // 同期先から写真を1枚取ってきてローカルにも保存する
    fetchPhoto: function (id) {
      if (!Storage.hasSync()) return Promise.resolve(null);
      return Storage.gasGet({ action: "photo", id: id }).then(function (body) {
        if (!body.dataUrl) return null;
        return Photos.save(id, body.dataUrl, true).then(function () {
          return { id: id, dataUrl: body.dataUrl, uploaded: true };
        });
      }).catch(function () { return null; });
    },

    // 失敗しても静かにあきらめる(次回また送る)
    trySync: function () {
      if (!Storage.hasSync() || Storage.syncState.busy) return Promise.resolve();
      var outbox = readJSON(KEY_OUTBOX, []);
      Storage.syncState.busy = true;
      Storage.notify("同期中…");

      var push = outbox.length === 0
        ? Promise.resolve()
        : Storage.gasPost({ records: outbox }).then(function () {
            // 送信中に増えた分は消さない
            var now = readJSON(KEY_OUTBOX, []);
            var sentIds = outbox.map(function (r) { return r.id + ":" + r.updatedAt; });
            writeJSON(KEY_OUTBOX, now.filter(function (r) {
              return sentIds.indexOf(r.id + ":" + r.updatedAt) < 0;
            }));
          });

      return push
        .then(function () {
          // 未アップロードの写真を順番に送る(1回の同期で最大5枚)
          return Photos.pending().then(function (pending) {
            var queue = pending.slice(0, 5);
            return queue.reduce(function (chain, p) {
              return chain.then(function () {
                return Storage.gasPost({ photos: [{ id: p.id, dataUrl: p.dataUrl }] })
                  .then(function () { return Photos.markUploaded(p.id); });
              });
            }, Promise.resolve());
          });
        })
        .then(function () {
          return Storage.gasGet({});
        })
        .then(function (body) {
          var merged = KameCore.mergeRecords(Storage.getRecords(), body.records || []);
          Storage.setRecords(merged);
          Storage.syncState.busy = false;
          Storage.notify("同期OK (" + new Date().toLocaleTimeString("ja-JP") + ")");
          // 同期中に新しい記録が増えていたらもう一度
          if (readJSON(KEY_OUTBOX, []).length > 0) return Storage.trySync();
        })
        .catch(function (err) {
          Storage.syncState.busy = false;
          Storage.notify("同期できませんでした: " + err.message);
        });
    },
  };

  window.KameStorage = Storage;
})();
