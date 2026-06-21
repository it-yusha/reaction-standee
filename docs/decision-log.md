# Reaction Standee Decision Log

開発中の判断理由を後から見返すためのメモです。README は現在の使い方、このファイルは経緯と意図を残します。

## 2026-06-21: 録画方式はDOM表示を主軸にする

### 背景

Reaction Standee は、ショート動画向けに立ち絵を自然に表示し、ポーズ、口パク、まばたき、生命感演出を組み合わせるアプリとして進めている。

録画方法として、以下を検討した。

- OBS Browser Source
- Safari/Chrome のウィンドウキャプチャ
- Canvas に再描画してブラウザ内録画
- Electron によるMacアプリ化
- 将来的なWebGL/PIXI.jsなどの専用描画エンジン

### 判断

短期の主軸は、DOM/CSS版の高品質表示をそのまま使うことにした。

具体的には、設定は `/settings`、録画表示は `/record`、Macアプリ レベル1では Electron ウィンドウ内に `/record` を表示する。

### 理由

- DOM/CSS版の見た目品質にすでに満足できている。
- 白フチ、差分オーバーレイ、生命感エフェクト、背景表示などはDOM/CSSの方が作りやすく、見た目も安定している。
- Canvas版は録画イメージとしては分かりやすいが、白フチやリアクションエフェクトの見た目がチープになりやすい。
- CanvasでDOMと同じ見た目を再現しようとすると、実質的に別描画エンジンを作ることになり、目的から外れやすい。
- OBS Browser Source は環境によってCSSアニメーションや画像切替が重くなる。
- Electron レベル1なら、ブラウザのツールバーを避けつつ、DOM/CSSの見た目を維持できる。

### 残すもの

- `/record`: 現在の主導線。DOM/CSS品質の録画表示。
- `/canvas`: Canvas出力の実験画面として残す。短期の主導線にはしない。
- `/capture`: 旧来のブラウザウィンドウキャプチャ用として残す。主導線からは外す。
- `/avatar`: OBS Browser Source用の代替表示として残す。主導線からは外す。

## 2026-06-21: 画像と設定は共有ローカル保存へ寄せる

### 背景

Safari、Chrome、OBS Browser Source、Electron は保存領域が分かれるため、IndexedDBやlocalStorageだけだと画像や設定を再登録する必要が出る。

### 判断

画像は `.reaction-standee/assets/`、表示設定は `.reaction-standee/settings.json` に共有保存する。

### 理由

- 初回だけ `/settings` を開けば、既存ブラウザ保存から共有保存へ移せる。
- Electron版が同じ画像と設定を読める。
- Git管理には入れず、ローカル実データとして扱える。
- 将来、より本格的なローカル保存APIへ移行する場合も入口を一本化しやすい。

### 注意点

- `.reaction-standee/` はGit管理外。
- 別Macへ移す場合は `.reaction-standee/` も移す必要がある。
- 画像差し替えが即時に見えない場合は表示側を再読み込みする。

## 2026-06-21: 設定画面の導線を整理する

### 背景

`/settings` 上部に `/capture`、`/record`、`/canvas`、`/avatar` が並び、用途が分かりづらくなっていた。

### 判断

設定画面の上部リンクは、通常使う `/record` と、実験用途の `/canvas` だけにする。

### 理由

- 現在の録画主導線は `/record`。
- `/avatar` は OBS Browser Source の代替用途で、日常的には触らない。
- `/capture` は旧来のブラウザウィンドウキャプチャ用途で、Electron主導線では優先度が下がった。
- 画面上の選択肢を減らすことで、操作の迷いを減らせる。

