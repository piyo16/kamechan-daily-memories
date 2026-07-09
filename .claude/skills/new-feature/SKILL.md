---
name: new-feature
description: このアプリに機能を追加・変更するときの実装手順。どの層(core/storage/app/index.html/css/sw)に何をどの順で書くかの決定フロー。記録の種類追加・グラフ追加・画面追加などで使う。
---

# 機能追加の実装手順

## 実装順序(必ずこの順で)

1. **core.js** — 集計・変換ロジックがあるなら、まず純粋関数として書く
2. **test/core.test.js** — その関数のテストを書き、`node test/core.test.js` で通す
3. **storage.js** — 保存形式が変わる場合のみ(→ schema-sync スキルを先に読む)
4. **index.html** — 画面の要素を追加(既存タブのセクション構造に合わせる)
5. **css/style.css** — 既存のクラス・CSS変数(`--accent` 等)を再利用する
6. **app.js** — イベント処理と描画。`render()` → `renderXxx(records)` の流れに乗せる
7. **sw.js** — 新ファイルを追加したら ASSETS に追記。キャッシュ対象を変更したら CACHE のバージョンを上げる
8. **README.md** — 「できること」に1行追加

## どの層に書くかの判定

| 書きたいもの | 場所 |
|---|---|
| 集計・平均・日付計算・テキスト生成 | core.js(純粋関数。DOM/fetch禁止) |
| localStorage / IndexedDB / 同期 | storage.js |
| ボタン・入力・画面の描画 | app.js |
| グラフ描画そのもの | chart.js(基本は既存の `renderTrend` を再利用) |

## よくあるパターン

### 新しい記録の種類を追加する(例: 投薬記録)

1. レコードの `type` に新しい値を決める(例: `"med"`)。**既存フィールドで表現できないか
   先に検討する**(label / note / amount の組み合わせで足りることが多い)。
2. core.js: 集計に含めるなら関数を追加。`AMOUNT_TYPES` は ごはん/水/おやつ の
   量集計専用なので、無関係な type を足さない。
3. app.js: `recordItem()` に表示分岐を追加(toilet や diary の分岐を手本にする)、
   入力UIを「きろく」タブに追加。
4. 新しいフィールドが必要になった場合のみ gas/Code.gs を更新(schema-sync 参照)。

### グラフを1枚追加する(例: トイレ回数グラフ)

1. core.js に「`[{ day: "YYYY-MM-DD", value: 数値 }]` を返す関数」を書く
   (chart.js の renderTrend はこの形式を受け取る)。
2. index.html の「グラフ」タブに card 要素を追加(既存の weight-card を手本にする)。
3. app.js の `renderCharts()` に描画呼び出しを追加。データが無いときは
   card を `hidden = true` にする(既存パターンに合わせる)。
4. 体重のように0始まりだと変化が見えない指標は `zeroBase: false` を渡す。

### 設定項目を追加する

- 設定は `Storage.getSettings()` / `setSettings()`(localStorage の `kame_settings_v1`)。
  レコードではないので**同期されない**(端末ごと)。家族間で共有すべき値なら
  設定ではなくレコード(profile 方式)にする。

## 禁止事項(重要)

- 外部ライブラリ・CDN・npmパッケージの追加
- ビルド手順の導入(そのままブラウザで動くこと)
- `Storage.upsert` / `Storage.remove` を通さないレコード書き換え
- `toISOString()` による日付キー生成(必ず `KameCore.dayKey` を使う)
- アロー関数・const/let 等のES6構文(test/ 以外)

実装が終わったら **verify スキル**の手順で動作確認する。
