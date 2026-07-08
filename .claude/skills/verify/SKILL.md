---
name: verify
description: このリポジトリでコードを変更したあとの動作確認手順。テスト実行・ローカル起動・ブラウザでの実機確認・PWAキャッシュ更新チェック。コミット前に必ず使う。
---

# 変更の動作確認手順

## 1. ユニットテスト(必須・最初にやる)

```bash
node test/core.test.js
```

- 成功なら `all tests passed ✔` と出る。それ以外の出力は失敗。
- npm は無い。`npm test` は動かない。
- core.js を変更したのにテストを足していなければ、ここで test/core.test.js に追加する。

## 2. 構文チェック(全JSファイル)

ブラウザ用ファイルは実行しないと構文エラーに気づけないので、変更したファイルを確認:

```bash
node --check js/app.js && node --check js/storage.js && node --check js/chart.js && node --check js/core.js && node --check sw.js
```

## 3. ブラウザでの実機確認

```bash
python3 -m http.server 8000
```

バックグラウンドで起動し、Playwright(Chromium はインストール済み)か手元のブラウザで
http://localhost:8000 を開いて確認する。Playwright を使う場合:

- `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` が設定済み。`playwright install` は実行しない。
- ページを開いたら **console のエラーを必ず確認**する(素のJSなので実行時エラーが出やすい)。
- スマホ想定なので viewport は 390x844 程度にする。

### 確認する画面(変更した機能に応じて)

| タブ | 確認内容 |
|---|---|
| きろく | ごはん/水/おやつの入力→追加→「きょうの記録」に出る |
| グラフ | 月切替・週/日切替でグラフが描画される |
| りれき | カレンダーで日付選択→記録が表示・削除できる |
| マイページ | プロフィール保存・けんこうチェック表示 |
| せってい | フード登録・きせかえ・バックアップ書き出し |

記録データは localStorage なので、テストデータは画面から入力するか、
DevTools で `kame_records_v1` に投入する。

## 4. PWAキャッシュの確認(見落としやすい)

`sw.js` の `ASSETS` に含まれるファイル(index.html, css, js, アイコン)を1つでも
変更したら、`sw.js` の `CACHE` バージョンが上がっていることを確認する:

```bash
git diff --name-only main | grep -E 'index.html|css/|js/|icons/|manifest' && grep 'var CACHE' sw.js
```

変更があるのに CACHE が上がっていなければ上げる(例: `kame-v3` → `kame-v4`)。

## 5. 同期(GAS)を触った場合

gas/Code.gs はこの環境では実行できない。ロジックの整合だけ確認する:

- `HEADERS` の列順と `rowToRecord_` / `recordToRow_` の添字が一致しているか
- クライアント側(storage.js の gasPost/gasGet)が送るキー名と一致しているか
- 変更内容を docs/setup.md に反映すべきか(再デプロイ手順が必要ならユーザーに伝える)
