# Public Release Checklist

Reaction StandeeをPublicリポジトリ化し、GitHub Pagesでデモ公開する前の確認メモです。

## 1. リポジトリ公開前

- `git status` がcleanであることを確認する。
- `npm run build` が成功する。
- `npm run build:pages` が成功する。
- `.env`、APIキー、トークン、パスワード、秘密鍵が含まれていないことを確認する。
- `.reaction-standee/`、`.build/`、`dist/`、`.DS_Store`、`*.tsbuildinfo` がGit管理外であることを確認する。
- GitHub上でSecret scanningやPush protectionの警告が出ていないことを確認する。

## 2. 公開してよい内容の確認

- READMEにアプリの目的、デモURL、起動方法、技術構成、工夫点が書かれている。
- カメラ映像とマイク音声はブラウザ内で処理し、アプリ自身はサーバーへ送信・保存しないことをREADMEに明記する。
- GitHub Pages公開版では、登録画像や設定がブラウザ内保存になることをREADMEに明記する。
- ユーザーが登録する画像素材の権利はユーザー側で管理することをREADMEに明記する。
- 権利未確認のキャラクター画像、背景画像、差分画像をリポジトリに含めない。
- ライセンスを未定にする場合は、READMEに「コードの再利用ライセンスは未定」と書く。

## 3. GitHub Pages設定

- リポジトリをPublicに変更する。
- GitHubの `Settings > Pages` で Source を `GitHub Actions` にする。
- `main` ブランチへpushする。
- Actionsの `Deploy GitHub Pages` ワークフローが成功する。
- 公開URLを開けることを確認する。

想定URL:

```text
https://it-yusha.github.io/reaction-standee/
```

録画表示:

```text
https://it-yusha.github.io/reaction-standee/?route=record
```

## 4. デモ確認

- トップURLで設定画面が開く。
- `?route=record` で録画表示が開く。
- トラッキングをONにすると、未許可の場合はカメラ許可ダイアログが出る。
- カメラ許可後、ポーズ認識が動く。
- 画像登録がブラウザ内でできる。
- 再読み込み後も登録画像と設定が復元される。
- 口パクを使う場合、マイク許可後に音声反応が動く。
- Mac + Safariを推奨環境として確認する。
- 公開版で `/api/reaction`、`/api/assets`、`/api/settings` への不要な通信が発生しない。
- Web App ManifestとService Workerが配信される。
- Safariの「Dockに追加」または対応ブラウザのインストール導線から、PWA表示を起動できる。

## 5. ポートフォリオ表示

- README冒頭にスクリーンショット、GIF、または短いデモ動画を追加する。
- READMEからGitHub Pagesデモへ移動できる。
- READMEから判断ログ `docs/decision-log.md` へ移動できる。
- 採用担当者が見ても、何を作り、何を工夫し、どう動くかが冒頭で分かる。
