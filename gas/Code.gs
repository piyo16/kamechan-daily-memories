/*
 * かめちゃん日記 — Googleスプレッドシート同期API (Google Apps Script)
 *
 * セットアップ手順は docs/setup.md を見てください。
 * appsscript.json(マニフェスト)とセットで使います。権限は次の3つに絞ってあります:
 *   - このスプレッドシートのみ(他のシートには一切アクセスできません)
 *   - このスクリプトが作成したファイルのみ(ドライブの他のファイルには一切アクセスできません)
 *   - Drive APIへの通信(写真の保存・取得のため)
 *
 * - 記録はシート「records」に1行1レコードで保存(同一idは updatedAt の新しい方が勝つ)
 * - 写真は Googleドライブのフォルダ「かめちゃん日記_photos」に保存(非公開のまま)
 */

var SHEET_NAME = "records";
var PHOTO_FOLDER = "かめちゃん日記_photos";
var HEADERS = ["id", "ts", "type", "label", "given", "left", "amount", "note", "by", "photoId", "weight", "temp", "updatedAt", "deleted"];
var COL_UPDATED_AT = HEADERS.indexOf("updatedAt") + 1; // 1始まり

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
  }
  return sheet;
}

function checkToken_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty("TOKEN");
  return expected && token === expected;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- Drive API(drive.file スコープ: このスクリプトが作ったファイルだけが見える) ----

function driveFetch_(url, options) {
  options = options || {};
  options.headers = { Authorization: "Bearer " + ScriptApp.getOAuthToken() };
  options.muteHttpExceptions = true;
  var res = UrlFetchApp.fetch(url, options);
  if (res.getResponseCode() >= 300) {
    throw new Error("Drive APIエラー " + res.getResponseCode());
  }
  return res;
}

function findByName_(name, extraQuery) {
  var q = "name='" + String(name).replace(/'/g, "\\'") + "' and trashed=false" + (extraQuery || "");
  var url = "https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent(q) + "&fields=files(id,name)";
  var body = JSON.parse(driveFetch_(url).getContentText());
  return (body.files && body.files[0]) || null;
}

function getFolderId_() {
  var folder = findByName_(PHOTO_FOLDER, " and mimeType='application/vnd.google-apps.folder'");
  if (folder) return folder.id;
  var res = driveFetch_("https://www.googleapis.com/drive/v3/files", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ name: PHOTO_FOLDER, mimeType: "application/vnd.google-apps.folder" }),
  });
  return JSON.parse(res.getContentText()).id;
}

function savePhoto_(photoId, dataUrl) {
  var name = String(photoId) + ".jpg";
  if (findByName_(name)) return; // すでにある
  var meta = driveFetch_("https://www.googleapis.com/drive/v3/files", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ name: name, parents: [getFolderId_()], mimeType: "image/jpeg" }),
  });
  var fileId = JSON.parse(meta.getContentText()).id;
  var bytes = Utilities.base64Decode(String(dataUrl).split(",")[1] || "");
  driveFetch_("https://www.googleapis.com/upload/drive/v3/files/" + fileId + "?uploadType=media", {
    method: "patch",
    payload: Utilities.newBlob(bytes, "image/jpeg"),
  });
}

function loadPhoto_(photoId) {
  var file = findByName_(String(photoId) + ".jpg");
  if (!file) return null;
  var res = driveFetch_("https://www.googleapis.com/drive/v3/files/" + file.id + "?alt=media");
  return "data:image/jpeg;base64," + Utilities.base64Encode(res.getContent());
}

// ---- 記録の読み書き ----

function rowToRecord_(row) {
  return {
    id: String(row[0]),
    ts: String(row[1]),
    type: String(row[2]),
    label: String(row[3] || ""),
    given: Number(row[4]) || 0,
    left: Number(row[5]) || 0,
    amount: Number(row[6]) || 0,
    note: String(row[7] || ""),
    by: String(row[8] || ""),
    photoId: String(row[9] || ""),
    weight: Number(row[10]) || 0,
    temp: Number(row[11]) || 0,
    updatedAt: String(row[12] || ""),
    deleted: row[13] === true || row[13] === "TRUE" || row[13] === "true",
  };
}

function recordToRow_(r) {
  return [
    r.id, r.ts, r.type, r.label || "", r.given || 0, r.left || 0, r.amount || 0,
    r.note || "", r.by || "", r.photoId || "", r.weight || 0, r.temp || 0,
    r.updatedAt || "", !!r.deleted,
  ];
}

function readAll_() {
  var values = getSheet_().getDataRange().getValues();
  var records = [];
  for (var i = 1; i < values.length; i++) {
    if (values[i][0]) records.push(rowToRecord_(values[i]));
  }
  return records;
}

// GET ?token=XXXX               → 全レコード
// GET ?token=XXXX&action=photo&id=YYYY → 写真1枚(dataURL)
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!checkToken_(p.token)) return json_({ error: "合言葉が違います" });

  if (p.action === "photo") {
    var dataUrl = loadPhoto_(p.id);
    if (!dataUrl) return json_({ error: "写真が見つかりません" });
    return json_({ dataUrl: dataUrl });
  }

  return json_({ records: readAll_() });
}

// POST body = { token, records?: [...], photos?: [{id, dataUrl}] }
function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ error: "JSONが読めません" });
  }
  if (!checkToken_(body.token)) return json_({ error: "合言葉が違います" });

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (body.records && body.records.length) {
      var sheet = getSheet_();
      var values = sheet.getDataRange().getValues();
      var rowById = {};
      for (var i = 1; i < values.length; i++) {
        if (values[i][0]) rowById[String(values[i][0])] = i + 1; // 1始まりの行番号
      }
      body.records.forEach(function (r) {
        if (!r || !r.id) return;
        var row = recordToRow_(r);
        var existing = rowById[String(r.id)];
        if (existing) {
          var currentUpdatedAt = String(sheet.getRange(existing, COL_UPDATED_AT).getValue() || "");
          if (String(r.updatedAt || "") > currentUpdatedAt) {
            sheet.getRange(existing, 1, 1, HEADERS.length).setValues([row]);
          }
        } else {
          sheet.appendRow(row);
          rowById[String(r.id)] = sheet.getLastRow();
        }
      });
    }

    if (body.photos && body.photos.length) {
      body.photos.forEach(function (p) {
        if (!p || !p.id || !p.dataUrl) return;
        savePhoto_(p.id, p.dataUrl);
      });
    }
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true });
}
