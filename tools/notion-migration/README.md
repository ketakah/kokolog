# Notion移行ツール

Notionの `Markdown & CSV` エクスポートを、ここログ完全バックアップJSONへ変換するローカル専用ツールです。

## 安全条件

- 実データはこの公開予定リポジトリへ置かない
- 元ZIP、展開ファイル、変換JSON、レポートは`kokolog-private`で扱う
- 外部APIやネットワークへデータを送信しない
- 元ZIPと元Markdownを書き換えない

## 必要環境

- Node.js 16以上
- 外部パッケージ不要

## テスト

```powershell
node .\tools\notion-migration\convert-notion-export.test.js
```

## 変換

```powershell
node .\tools\notion-migration\convert-notion-export.js `
  --csv "<展開先>\database_all.csv" `
  --markdown-dir "<展開先>" `
  --output "<非公開先>\kokolog-notion-import.json" `
  --report "<非公開先>\notion-migration-report.html" `
  --zip-sha256 "<元ZIPのSHA-256>" `
  --utc-offset-minutes 540
```

既存出力を誤って上書きしない。意図的に再生成する場合だけ`--force`を追加する。
同一結果の再現検査では、元JSONの`exportedAt`を`--exported-at`へ渡せる。

## 検証

```powershell
node .\tools\notion-migration\validate-kokolog-backup.js `
  --input "<非公開先>\kokolog-notion-import.json" `
  --expected-records 56 `
  --expected-source-sha256 "<元ZIPのSHA-256>" `
  --markdown-dir "<展開先>"
```

検証内容:

- バックアップ形式
- IDと外部IDの重複
- 日時
- タグ参照
- 内容ハッシュ
- 元ZIPハッシュ
- 元Markdownファイルハッシュ
- タイトル、本文、作成日時、更新日時の一致
- 未参照Markdownの有無
