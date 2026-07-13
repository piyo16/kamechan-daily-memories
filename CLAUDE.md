# CLAUDE.md — かめちゃん日記 開発ガイド

猫の毎日のごはん・水・体調を記録するPWA。**ビルドなし・依存ライブラリなし・素のJavaScript**。
このファイルは開発時の必須ルールをまとめたもの。作業前に必ず読むこと。

## コマンド

| 目的 | コマンド |
|---|---|
| テスト実行(唯一のテスト) | `node test/core.test.js` |
| ローカル起動 | `python3 -m http.server 8000` → http://localhost:8000 |

npm / package.json は存在しない。`npm install` や `npm test` を実行しないこと。

## アーキテクチャ(層の依存は一方向)

```
js/core.js    純粋ロジック(集計・マージ)。UI/ブラウザAPI禁止。Nodeでテスト可能
   ↑
js/storage.js 保存(localStorage/IndexedDB)と GAS 同期。core.js のみ参照可
   ↑
js/app.js     画面制御。core.js と storage.js を使う。DOM操作はここだけ
js/chart.js   SVGライングラフ描画(独立。KameChart.renderTrend のみ公開)
---
index.html    画面。全タブのHTMLがここに入っている
css/style.css スタイル。テーマは body[data-theme] で切替
gas/Code.gs   Googleスプレッドシート側の同期API(Apps Script。手動デプロイ)
sw.js         Service Worker(オフラインキャッシュ)
test/core.test.js core.js のテスト(assertベースの素のNodeスクリプト)
```

グローバル公開名: `KameCore`(core.js)、`KameStorage`(storage.js)、`KameChart`(chart.js)。

## データモデル(最重要・変更は慎重に)

すべての記録は1つの「レコード」形式。localStorage の `kame_records_v1` に配列で保存され、
スプレッドシートにも1行1レコードで同期される。

```js
{
  id: "uuid",            // "profile" と "food-defs" だけは固定id の特別レコード
  ts: "ISO日時",          // 記録対象の日時
  type: "food" | "water" | "snack" | "diary" | "toilet" | "profile" | "fooddefs",
  label: "",             // フード名 / トイレは "pee"|"poop"
  given: 0, left: 0,     // あげた量・残した量
  amount: 0,             // 摂取量(= given - left)。集計はこの値を使う
  note: "",              // メモ。profile はここに JSON 文字列を入れる
  by: "",                // 記録した人
  photoId: "",           // 写真ID(実体は IndexedDB / Googleドライブ)
  weight: 0, temp: 0,    // diary 用: 体重kg・体温℃
  updatedAt: "ISO日時",   // 競合解決キー。Storage.upsert が自動で付ける
  deleted: false         // 論理削除(トゥームストーン)
}
```

### 絶対に守る不変条件

1. **物理削除禁止**。削除は `deleted: true` の論理削除のみ(`Storage.remove` を使う)。
   端末間で削除を伝えるために必須。
2. **レコードの追加・更新・削除は必ず `Storage.upsert` / `Storage.remove` を通す**。
   直接 `setRecords` で書き換えると updatedAt が付かず、同期(outbox)にも載らない。
3. **マージ規則は「同一idは updatedAt が新しい方が勝つ」**(`KameCore.mergeRecords`)。
   この規則は GAS 側(`Code.gs` の doPost)にも同じ実装があり、両方揃える。
4. **日付境界はローカルタイムゾーン**。日付キーは必ず `KameCore.dayKey` を使う。
   `toISOString().slice(0,10)` で日付を作らない(UTCにずれる)。
5. **レコードにフィールドを追加するときは `gas/Code.gs` の `HEADERS` /
   `rowToRecord_` / `recordToRow_` も同時に更新する**(詳細は schema-sync スキル)。

## コーディング規約

- **ES5スタイルで書く**: `var` + `function`。アロー関数・`const`/`let`・テンプレート
  リテラル・class は使わない(テストファイル `test/core.test.js` のみ例外でES6可)。
  周囲のコードのスタイルに合わせるのが最優先。
- **外部ライブラリ・CDN・npm依存の追加は禁止**。オフラインPWAなので全部自前。
- **core.js は純粋に保つ**: `document` / `window` / `fetch` / `localStorage` を
  参照しない。新しい集計ロジックは core.js に書き、必ずテストを追加する。
- UIの文言・コメント・コミットメッセージは**日本語**。やさしい表現
  (「きろく」「りれき」等のひらがな調)に合わせる。
- スマホ(iOS Safari)が主なターゲット。タップ操作・仮想キーボードを意識する。

## 変更時のチェックリスト(完了の定義)

- [ ] `node test/core.test.js` が通る(core.js を変えたらテストも追加した)
- [ ] **キャッシュ対象ファイル(sw.js の ASSETS にあるもの)を変更したら
      `sw.js` の `CACHE` のバージョン番号を上げた**(例: `kame-v3` → `kame-v4`)。
      忘れると利用者に更新が届かない
- [ ] 新しいJS/CSS/画像ファイルを追加したら `sw.js` の `ASSETS` に追記した
- [ ] レコードのフィールドを増減したら `gas/Code.gs` も更新した
- [ ] 機能を追加・変更したら `README.md` の「できること」を更新した

## Skills(作業手順書)

`.claude/skills/` に手順書がある。該当する作業では必ず参照する:

- **verify** — 変更後の動作確認手順(テスト→ローカル起動→ブラウザ確認)
- **new-feature** — 機能追加をどの層にどの順で実装するか
- **schema-sync** — レコード形式の変更・GAS同期まわりを触るときの手順
