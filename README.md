# ここログ

気持ち・思考を記録し、カレンダー、タイムライン、検索、統計で振り返る個人用PWAのプロジェクトです。

[![Deploy Kokolog to GitHub Pages](https://github.com/ketakah/kokolog/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/ketakah/kokolog/actions/workflows/deploy-pages.yml)

公開URL: <https://ketakah.github.io/kokolog/>

## 現在の状態

**M1〜M10の実装、GitHub Pages公開、デスクトップブラウザ検証まで完了しています。**

現在動作するもの:

- タイムラインホーム
- 本文を主入力にした新規作成
- 任意の明示タイトルと自動表示見出し
- 5段階の調子
- 任意タグの作成・選択
- IndexedDBへの保存
- 下書き自動保存と再読み込み後の復元
- 記録詳細
- 編集
- お気に入り
- データ件数が不自然に0件になった場合の書き込み停止
- 完全JSONバックアップ
- バックアップの構造・件数・内容ハッシュ検証
- 追加・統合と重複判定
- 同一更新時刻・異内容の競合解決
- 削除墓標による古い記録の復活防止
- 全置換前のJSON保存確認
- 全置換前の7日スナップショット
- スナップショット復元
- 30日または50件変更のバックアップ案内
- 月曜日始まりの月間カレンダー
- 日付・投稿件数・日平均の顔・実平均
- 月移動ボタン、横スワイプ、年／月選択シート
- 日別一覧と過去日への新規作成
- 月の折れ線グラフ
- 年の棒グラフ
- 調子未入力日をまたぐ破線
- グラフから日別一覧・月間カレンダーへの移動
- タイトル・本文の部分一致検索
- Unicode NFKCによる全角／半角と英字大小の吸収
- 空白区切りの複数語AND検索
- Web Workerでの検索
- 期間・調子・調子未入力・お気に入り・タグ絞り込み
- タグAND／OR
- 適用中条件の解除チップ
- 100件ずつの段階描画
- 編集前の内容を履歴として保存
- 直近10版・30日保持
- 編集履歴からの復元
- ゴミ箱への移動・復元
- 30日後の自動完全削除
- 手動完全削除とゴミ箱を空にする操作
- 完全削除後の最小墓標
- 任意の6桁PINロック
- 起動時・バックグラウンド復帰時・手動のPINロック
- 表示中の無操作時間による1分 / 5分 / 15分ロック
- salt付きPBKDF2検証値と段階的な再試行待ち時間
- 一度だけ表示する復旧コード
- 復旧コードによるロック解除とPIN無効化
- PIN・復旧コード検証情報を完全JSONへ含めない保護
- iPhoneホーム画面用を含むPWAアイコン
- 68ファイルのApp Shellプリキャッシュ
- オフライン起動・作成・編集・検索・カレンダー・統計
- 更新準備完了通知と利用者確認後の安全な更新
- 更新直前の下書き保存とIndexedDB接続終了
- ここログ固有キャッシュだけの世代更新
- meta CSP、外部ランタイム依存なし、検索エンジン非登録
- PIN有効時のアプリ切替画面を隠すプライバシーカバー
- 自動 / ライト / ダークのテーマ設定
- データ件数、概算使用量、Persistent Storage、オフライン準備状態
- PIN再確認と保存確認を伴う完全JSONバックアップ
- バックアップ確認、確認文言、PIN再確認を伴う全データ削除
- 全削除時の他タブ機密DOM・検索Worker・DB接続の無効化
- 全削除後のService Worker・App Shell自己修復

Notionの56件はローカル開発環境へ検証済みで取り込み、利用者が保存した完全JSONも再検証済みです。公開サイトには実記録を含めていません。Service Worker、オフライン動作、端末管理機能は公開URLでも検証済みです。iPhone実機への導入と56件JSONの復元はまだ行っていません。

## ローカル起動

依存パッケージのインストールは不要です。

```powershell
npm run serve
```

ブラウザで <http://127.0.0.1:4173/> を開きます。

## テスト

```powershell
npm test
```

## 最初に見る資料

1. [要件定義](./要件定義.md)
2. [画面仕様](./画面仕様.md)
3. [データ仕様](./データ仕様.md)
4. [実装計画](./実装計画.md)
5. [Notion移行準備](./Notion移行準備.md)
6. [セキュリティレビュー](./SECURITY-REVIEW.md)

## 画面プレビュー

- [顔アイコン](./design/face-icons-preview.html)
- [カレンダー](./design/calendar-screen-preview.html)
- [日別・編集・タイムライン](./design/core-screens-preview.html)
- [統計・記録詳細・設定](./design/secondary-screens-preview.html)
- [PIN・絞り込み・タグ・インポート](./design/interaction-sheets-preview.html)

HTMLファイルをブラウザで開くと静的な画面案を確認できます。

## 公開予定

- リポジトリ: `ketakah/kokolog`
- URL: `https://ketakah.github.io/kokolog/`
- 方式: 1つのソースリポジトリからGitHub ActionsでPagesへ自動配信

既存の「のみログ」と同じ `https://ketakah.github.io` オリジンになります。両方とも本人管理の個人用PWAで、外部スクリプトを使わず、アプリ固有のDB・キー・キャッシュ名と厳格なCSPを維持する条件で同一オリジンを許容します。接頭辞は強いアクセス制御ではないため、外部コードを追加する場合や不特定多数へ提供する場合は専用オリジンへ移します。

## 個人データに関する重要事項

Notionの元ZIP、変換後JSON、実際の記録、照合レポートは、この公開予定フォルダーへ入れません。

実データはリポジトリ外の個人用フォルダーで扱います。

```text
../kokolog-private/
```

## 次の作業

1. 非公開のNotion移行レポートを目視確認
2. iPhone 17 / iOS 27.0.1でホーム画面へ追加
3. iPhoneで完全JSONからNotion由来56件を復元
4. 機内モードで起動・閲覧・作成・検索・統計を確認
5. iPhoneで更新通知とプライバシーカバーを確認

## GitHub Pagesへの公開

`main`へのpushで次を自動実行します。

1. 単体テストとNotion変換テスト
2. PWAとService Workerの検証
3. 公開許可リストから`dist-pages/`を生成
4. 実データ・移行資料・設計資料が成果物にないことを検証
5. GitHub Pagesへデプロイ

```powershell
npm run build:pages
npm run test:pages
```

公開成果物にはアプリ実行に必要なHTML、CSS、JavaScript、Manifest、アイコンだけを含めます。
