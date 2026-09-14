# 因子台帳

ウマ娘の因子（青/赤/白）を画像から読み取って登録・検索できる個人用ツール。
設計方針は `SPEC.md` を参照。データはこのリポジトリの `data/factors.json` を
GitHub Contents API 経由でDB代わりに読み書きする。

## 構成

```
/
├── index.html       # 画面本体
├── style.css        # スタイル
├── script.js        # フロントエンドのロジック（GitHub連携含む）
├── data/
│   └── factors.json # 因子データ本体（配列）
├── api/
│   └── analyze.js   # 画像解析の中継バックエンド（Vercel Serverless Function）
└── README.md
```

## セットアップ

### 1. デプロイ

このリポジトリを [Vercel](https://vercel.com/) にインポートしてデプロイする
（フレームワーク設定不要）。`index.html` などの静的ファイルと `api/analyze.js`
（画像解析の中継関数）が同一ドメインで配信されるため、追加のCORS設定は不要。

### 2. 画像解析用のAPIキーを設定

Vercelプロジェクトの環境変数に以下を設定する。

| 変数名 | 内容 |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic APIキー（[console.anthropic.com](https://console.anthropic.com/)で発行） |

このキーはサーバー側（`api/analyze.js`）でのみ使用され、ブラウザには渡らない。

### 3. GitHub個人アクセストークン(PAT)を発行

アプリ画面からこのリポジトリの `data/factors.json` を読み書きするために、
ブラウザ側でPATを使用する。

- GitHubの Settings → Developer settings → Fine-grained personal access token で発行
- 対象リポジトリ: このリポジトリのみに限定
- 権限: **Contents: Read and write** のみ付与（他の権限は不要）
- 有効期限はできるだけ短く設定し、期限切れ時は再発行する

このトークンはブラウザの `localStorage` に平文で保存される（個人利用前提の
簡易実装）。共有端末では使用しない、ブラウザのプロファイルを共有しない、など
取り扱いに注意すること。

### 4. アプリを開いて接続

デプロイしたURLを開き、「GitHub連携設定」パネルに以下を入力して
「保存して読み込む」を押す。

- リポジトリ所有者（例: `izayoisinya`）
- リポジトリ名（例: `UmaMusumeDB`）
- ブランチ（空欄でデフォルトブランチ）
- 手順3で発行したPAT

以降、画像貼り付け→読み取り→保存/削除ができる。他端末からの更新を
取り込みたい場合は「更新」ボタンで再取得する。

## データの同期について

- 読み込みはアプリを開いた時と「更新」ボタン押下時のみ（ポーリングはしない）
- 検索・フィルタはメモリ上のデータに対してのみ行う
- 保存・削除のたびに `data/factors.json` へのコミットが1つ積まれる
- 書き込み直前に最新の `sha` を取得し直すが、ほぼ同時に他端末が書き込んだ
  場合は409エラーとなる。その場合は画面の案内に従い「更新」ボタンで
  最新を取得してから再度保存・削除する

## ローカルでの動作確認

Vercel CLIを使うと `api/analyze.js` を含めてローカル確認できる。

```bash
npm install -g vercel
vercel dev
```

`ANTHROPIC_API_KEY` はローカルでは `.env.local` に設定する（`.gitignore` 済み）。
