# 📅 面談日程くん

個人懇談の日程調整ウェブアプリ。保護者の希望日時を収集し、兄弟配慮の自動割り当てを実行。

## デプロイ手順

### 前提条件

- Node.js（v18以上）がインストールされていること
- GitHubアカウントがあること

### 1. リポジトリを作成

```bash
# GitHubで「mendan-scheduler」という名前のリポジトリを新規作成（空で作成）

# ローカルにクローン or このフォルダで初期化
cd mendan-app
git init
git remote add origin https://github.com/daiki0807/mendan-scheduler.git
```

### 2. 依存パッケージをインストール

```bash
npm install
```

### 3. ローカルで動作確認

```bash
npm run dev
```

ブラウザで `http://localhost:5173/mendan-scheduler/` を開いて確認。

### 4. ビルド＆デプロイ

```bash
npm run build
npm run deploy
```

これで `gh-pages` ブランチにビルド済みファイルがプッシュされます。

### 5. GitHub Pages を有効化

1. GitHubリポジトリの Settings → Pages
2. Source: 「Deploy from a branch」
3. Branch: 「gh-pages」/ 「/(root)」を選択
4. Save

数分後に以下のURLでアクセス可能：

```
https://daiki0807.github.io/mendan-scheduler/
```

## GAS URL の変更

`src/api.js` の `GAS_URL` を書き換えてから再デプロイ：

```javascript
const GAS_URL = "https://script.google.com/macros/s/YOUR_NEW_URL/exec";
```

## 技術スタック

- **フロントエンド**: React 18 + Vite
- **バックエンド**: Google Apps Script (Web App)
- **データベース**: Google スプレッドシート
- **ホスティング**: GitHub Pages
