---
name: schema-sync
description: レコードのフィールド追加・変更、Googleスプレッドシート同期(gas/Code.gs)、マージ・削除ロジックを触るときの手順と注意点。データ互換性を壊さないためのルール。
---

# レコード形式・同期まわりの変更手順

このアプリのデータは 3か所に存在する:
**localStorage(各端末) / Googleスプレッドシート(共有) / JSONバックアップ**。
形式を変えるときは3つすべてとの互換性を考える。

## フィールドを追加する手順

1. **本当に必要か確認**: 既存の label / note / amount で表現できないか。
   構造データなら profile 方式(note に JSON 文字列)も使える。
2. `gas/Code.gs` を更新(3か所セット):
   - `HEADERS` 配列の**末尾**に列名を追加(途中に挿入すると既存シートの列とずれる)
   - `rowToRecord_` に読み出しを追加(添字は HEADERS の位置に合わせる)
   - `recordToRow_` に書き込みを追加(同じ順序)
3. クライアント側(app.js / core.js)で新フィールドを読むときは
   **未定義でも動くように書く**(古いレコードにはそのフィールドが無い)。
   例: `Number(r.newField) || 0`
4. ユーザーへの報告に**「gas/Code.gs を再デプロイする必要がある」**旨を必ず含める
   (Apps Script は手動デプロイ。手順は docs/setup.md)。
   既存シートに新しい列ヘッダーを手で足す必要があるかも確認して伝える。

## 絶対に壊してはいけない規則

- **マージ規則**: 同一 id は `updatedAt`(ISO文字列)の**文字列比較**で新しい方が勝つ。
  この実装は `js/core.js` の `mergeRecords` と `gas/Code.gs` の `doPost` の2か所にあり、
  **必ず同じ挙動に保つ**。片方だけ変えると端末間でデータが食い違う。
- **論理削除**: `deleted: true` のレコード(トゥームストーン)は消さない・除外して
  同期しない、をしない。全件残して送受信する。表示側で `liveRecords` で除外する。
- **profile / food-defs レコード**: id が `"profile"`(プロフィール)/ `"food-defs"`
  (フード登録。note に JSON 配列)で固定、ts は `"2000-01-01T..."` 固定。
  この特別扱いを崩さない(集計対象外・一覧に出さないため)。
- **旧データの受け入れ**: importJSON やシートから来る古い形式のレコードが
  エラーにならないこと。フィールド不足はデフォルト値で吸収する。

## 同期の仕組み(変更前に理解する)

```
保存時: Storage.upsert → localStorage更新 + outbox(kame_outbox_v1)に積む → trySync
同期時: outbox を POST → 未送信写真を最大5枚 POST → GET で全件取得 → mergeRecords でマージ
失敗時: 静かにあきらめて outbox に残す(次回再送)。エラーで例外を投げない
```

- GAS への POST は **`Content-Type: text/plain`** で送る(CORSプリフライト回避)。
  `application/json` に変えると動かなくなる。
- 送信中に増えた outbox を消さないよう、送信済み判定は `id + ":" + updatedAt` で行う。
  この仕組みを単純化しないこと。
- 写真はレコードと別経路: IndexedDB(kame-db/photos)に保存し、
  Googleドライブへ dataURL で送る。レコードには photoId だけ持たせる。

## 変更後の確認

- `node test/core.test.js` が通る(mergeRecords 等を変えたらテストを足す)
- gas/Code.gs は実行できないので、HEADERS の列順と rowToRecord_/recordToRow_ の
  添字の一致を目視で確認する
- verify スキルの手順でブラウザ確認(同期未設定でもエラーにならないこと)
