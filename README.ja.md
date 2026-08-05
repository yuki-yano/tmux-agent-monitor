# vde-monitor

単一の CLI で tmux / WezTerm / herdr / cmux のコーディングセッションをブラウザから監視できるツールです。
Codex CLI / Claude Code ワークフロー向けに設計されており、デスクトップとモバイルの両方で素早く確認・操作できるよう最適化されています。
モバイルアプリ相当の UI/UX を最重要要件としており、タッチしやすい操作系と小画面向けレイアウトを優先しています。

英語版: [`README.md`](README.md)

## できること

- 複数セッションの状態と直近アクティビティを一画面で確認
- セッションを開いて、pane へテキスト入力・キー入力・raw 入力を送信
- テキストモードでターミナル出力を監視（macOS 専用の cmux backend を除いてクロスプラットフォーム）
- 対応する macOS terminal backend では画像モード表示を利用可能（有効化時）
- 再起動をまたいだセッション / リポジトリのタイムラインと活動履歴を追跡
- 監視しながら Git diff / commit を確認し、リポジトリ単位のノートを管理
- tmux / herdr セッションへ Codex / Claude エージェントを起動
- 既存の Codex / Claude セッションを source pane で再開し、別の `vw` worktree 文脈へ移動
- Session Detail で worktree 文脈を切り替え、同一セッションのまま timeline / diff / commits / files を確認（[`vde-worktree`](https://github.com/yuki-yano/vde-worktree) / `vw` が必要）
- Usage Dashboard でプロバイダ単位の制限ペースと課金推移を確認

## 主な機能

- Session List: リポジトリ / ウィンドウ単位でグルーピングし、状態確認・検索 / フィルタ・ピン留めが可能
- Session Detail: ライブスクリーン表示（text/image）、タイムライン、ノート、diff、commits、ファイルナビゲーション、worktree 文脈切替、入力コンポーザー（text/keys/raw/画像添付）
- タイムラインと文脈情報: 状態タイムライン、repo notes、git diff / commits、ファイル閲覧
- worktree 文脈切替: セッションを維持したまま、選択した worktree を基準に timeline / git / files を確認（[`vde-worktree`](https://github.com/yuki-yano/vde-worktree) / `vw` が必要）
- エージェント操作: backend が対応している場合、UI から Codex / Claude の起動、または既存セッションの再開/移動
- マルチ pane 監視: デスクトップ向け Chat Grid で並列監視
- モバイル UI/UX 優先: 主要な監視・操作フローをスマホブラウザの一次体験として設計
- PWA Push 通知: セッション単位トグル（既定OFF）と設定ファイルの全体ON/OFFに対応
- Usage Dashboard: プロバイダ単位の session/weekly ペースと token/USD 集計表示

## 要件

- Node.js `24.11+`
- tmux `2.0+`、`wezterm cli` が使える WezTerm、herdr `0.7.1+`、または cmux `0.64.17+`
- cmux は macOS 14 以降が必要
- worktree 連携は [`vde-worktree`](https://github.com/yuki-yano/vde-worktree) CLI（`vw`）前提で、`vw` の snapshot が取れない場合は利用不可
- macOS 専用の画像キャプチャと platform focus 連携は `osascript` が必要
- macOS では backend によって画面収録・アクセシビリティ権限が必要です。cmux の text capture/control には不要です

## インストール

```bash
npx vde-monitor@latest
```

またはグローバルインストール:

```bash
npm install -g vde-monitor
```

## クイックスタート

用途に応じて次のいずれかを実行:

```bash
# ローカル端末のみからアクセス（デフォルト）
npx vde-monitor@latest

# 信頼できるプライベート LAN に公開（0.0.0.0 で待ち受け）
npx vde-monitor@latest --public

# Tailscale 端末からアクセス（Tailscale URL を表示）
npx vde-monitor@latest --tailscale
```

起動時に次のような URL が表示されます:

```text
vde-monitor: http://localhost:11080/#token=...
```

この URL をブラウザで開いてください。  
ターミナルの表示高さに余裕がある場合は、別端末から開くための QR コードも表示されます。

## 最初の 5 分

1. Session List を開き、監視したい pane を選択する
2. Session Detail のスクリーンパネルでライブ出力を確認する
3. コンポーザーから入力を送る
   - text input
   - key input
   - raw input
4. timeline / notes / diff / commits タブで文脈情報を確認する

## UIワークフロー

### Session Detail（単一セッションを深掘り）

- デスクトップ: 左側に Screen + Notes、右側に Diff / Files / Commits / Worktree を配置。
- モバイル: 画面下のセクションタブから同じ情報へ切り替え可能。
- File Navigator は Git ignore 対象もグレー表示します。ignore 対象ディレクトリは明示的に展開したときだけ読み込み、通常検索では内部へ再帰しません。`.git/**` は表示しません。
- 画像と HTML のプレビューは、ログに出た絶対パスを含む許可済みローカル資産を解決できます。外部 HTTP(S) 資産は読み込みません。
- 典型的な使い方:
  1. Screen パネルで現在の実行状態を監視する。
  2. Notes に判断メモや TODO を残す。
  3. Diff / Commits で変更を確認し、File Navigator で対象ファイルを読む。
  4. Worktree 文脈を切り替えて、別ブランチ視点を同一セッション内で確認する。
  5. text/keys/raw を送信し、必要に応じて画像を添付して追加入力する。

### Chat Grid（並列監視）

- 複数 pane をタイル表示して同時監視。
- 候補選択モーダルで監視対象を素早く追加/削除。
- 全タイル更新とタイル単位入力で、複数エージェントの進捗を同時比較。
- 並列実験や複数リポジトリ/ウィンドウのレビュー時に有効。

### Usage Dashboard（容量・コスト確認）

- Codex / Claude の利用状況を同一画面で比較。
- 24時間・7日・30日の期間ごとにリポジトリ活動量を比較。Active time はライフサイクルイベントで
  確認できた実行期間の和集合、Agent time は並列Agentを含む同期間の合計、Completed runs は明示的な
  完了イベントの一意な実行数を表す。pollだけで生じた状態断片は除外し、token量やコストのランキング
  としては扱わない。
- 観測範囲が不完全な場合やリポジトリを特定できない活動がある場合は、その情報を集計結果と
  あわせて表示し、未観測をゼロとして扱わない。明示的な完了があっても開始イベントを確認できない
  実行は、活動時間を除外したうえで観測範囲が不完全として表示する。
- Global State Timeline（範囲切替 + Compact）で待機時間の偏りを把握。
- provider の issue / warning を確認して、必要に応じて Session List に戻って調整。
- セッション配分の見直しや高コスト実行の抑制判断に有効。

## モバイル端末での利用

推奨アクセス方法:

- SSH ポートフォワード
- Tailscale
- 信頼できるプライベート LAN のみ

一般的な流れ:

1. ホストマシンで `npx vde-monitor@latest` を起動
2. 表示された URL を安全な経路で公開
   - 利用可能なら `--tailscale` を推奨
   - `--public` は信頼ネットワークのみ
3. モバイル端末で URL を開き、`SessionDetail` から操作

モバイル端末で HTTPS アクセスする場合（Tailscale）:

1. Tailscale + HTTPS モードで起動（例: `npx vde-monitor@latest --tailscale --https`）
2. 起動時の `Run tailscale serve now? [y/N]` に応答
   - `y` / `yes`: `tailscale serve --bg <printed-web-port>` を自動実行
   - 既定の `N`: 自動実行せず、手動復旧コマンドを表示
3. 既存の `tailscale serve` 設定がある場合は上書きせず、案内のみ表示
4. `https://<device>.<tailnet>.ts.net/#token=...` を開く（`http://100.x.x.x/...` ではなく）
5. `tailscale serve status` で状態を確認

iOS の補足:

- iOS の Web Push はホーム画面に追加したスタンドアロンPWAでのみ利用可能
- iOS の通常 Safari タブではセッション通知トグルは表示されない

## 便利なコマンド

### サーバー起動

```bash
npx vde-monitor@latest [options]
```

主なオプション:

```text
--port <port>           API/UI port
--public                Bind to 0.0.0.0
--tailscale             Use Tailscale IP for access URL
--https                 Enable Tailscale HTTPS guidance/QR (effective with `--tailscale`)
--bind <ip>             Bind to specific IPv4
--multiplexer <name>    `tmux`, `wezterm`, `herdr`, or `cmux`
--backend <name>        image backend (`alacritty`, `terminal`, `iterm`, `wezterm`, `ghostty`)
```

高度なオプション:

```text
--web-port <port>       Override displayed web port in URL
--wezterm-cli <path>    wezterm binary path (default: `wezterm`)
--wezterm-target <t>    wezterm target (`auto` or explicit target)
--cmux-cli <path>       cmux binary path (default: `cmux`)
--cmux-socket <path>    Explicit cmux socket path (default: auto-detect)
--socket-name <name>    tmux socket name
--socket-path <path>    tmux socket path
```

補足:

- `--bind` と `--tailscale` は併用不可
- `--bind` は `--public` より優先
- `--tailscale` には解決可能な Tailscale IP が必要
- `--tailscale` 単体では Tailscale IP に bind
- `--public --tailscale` では、`--https` の有無にかかわらず `0.0.0.0` に bind しつつ Tailscale URL を表示
- `--public --tailscale --https` でも、Tailscale Serve の内部 upstream には loopback (`127.0.0.1`) を使用
- `--https` は `--tailscale` 併用時のみ有効（それ以外は通常の HTTP 案内）
- `--tailscale --https` では `tailscale serve --bg <port>` の自動実行前に確認プロンプトを表示（既定 `N`）
- 既存の `tailscale serve` 設定は自動で上書きしない
- Tailscale 経由で HTTPS を使う場合は `tailscale serve` / `tailscale funnel` を使用（Tailscale IP の HTTP は HTTPS ではない）

### ユーティリティ

```bash
npx vde-monitor@latest config init
npx vde-monitor@latest config regenerate
npx vde-monitor@latest config check
npx vde-monitor@latest config prune
npx vde-monitor@latest config prune --dry-run
npx vde-monitor@latest token rotate
npx vde-monitor@latest claude hooks print
npx --package vde-monitor@latest vde-monitor-hook <HookEventName>
```

- `config init`: グローバル設定ファイルが存在しない場合のみ、初期の自動生成設定を作成
- `config regenerate`: 既存のグローバル設定を、必須テンプレートで上書き再生成
- `config check`: グローバル設定を検証（parse/schema/必須生成キー/未使用キー）
- `config prune`: グローバル設定の未使用キーを削除し、`config.yml`（YAML）として再書き込み
- `config prune --dry-run`: ファイル更新せず、削除対象キーのみ表示

## 設定

グローバル設定ファイル:

- `$XDG_CONFIG_HOME/vde/monitor/config.yml`
- フォールバック: `~/.config/vde/monitor/config.yml`

優先順位:

- `CLI args > global config > defaults`

グローバル設定ファイル探索順:

- `config.yml > config.yaml > config.json`

自動生成される必須設定（`config.yml`）:

| キー                           | 既定値                     | 意味                                                                                   |
| ------------------------------ | -------------------------- | -------------------------------------------------------------------------------------- |
| `multiplexer.backend`          | `tmux`                     | マルチプレクサ backend（`tmux` / `wezterm` / `herdr` / `cmux`）                        |
| `screen.image.backend`         | `terminal`                 | macOS での画像キャプチャ backend（`alacritty`/`terminal`/`iterm`/`wezterm`/`ghostty`） |
| `dangerKeys`                   | `["C-c","C-d","C-z"]`      | 危険キーとしてブロックするキー                                                         |
| `dangerCommandPatterns`        | 既存デフォルト正規表現配列 | 危険コマンド検知に使う正規表現パターン                                                 |
| `launch.agents.codex.options`  | `[]`                       | Codex 起動時に付与する既定オプション                                                   |
| `launch.agents.claude.options` | `[]`                       | Claude 起動時に付与する既定オプション                                                  |
| `workspaceTabs.displayMode`    | `all`                      | モバイル Workspace Tabs 表示方針（`all`/`pwa`/`none`）                                 |

設定可能だが任意の設定（未指定時はランタイム既定値を使用）:

| キー                                     | 既定値                                              |
| ---------------------------------------- | --------------------------------------------------- |
| `bind`                                   | `127.0.0.1`                                         |
| `port`                                   | `11080`                                             |
| `allowedOrigins`                         | `[]`                                                |
| `activity.pollIntervalMs`                | `1000`                                              |
| `activity.runningThresholdMs`            | `5000`                                              |
| `screen.maxLines`                        | `2000`                                              |
| `screen.highlightCorrection.codex`       | `true`                                              |
| `screen.highlightCorrection.claude`      | `true`                                              |
| `multiplexer.wezterm.cliPath`            | `wezterm`                                           |
| `multiplexer.wezterm.target`             | `auto`                                              |
| `multiplexer.cmux.cliPath`               | `cmux`                                              |
| `multiplexer.cmux.socketPath`            | `null`（自動検出）                                  |
| `notifications.pushEnabled`              | `true`                                              |
| `notifications.enabledEventTypes`        | `["pane.waiting_permission","pane.task_completed"]` |
| `usage.session.providers.codex.enabled`  | `true`                                              |
| `usage.session.providers.claude.enabled` | `true`                                              |
| `usage.pricing.providers.codex.enabled`  | `true`                                              |
| `usage.pricing.providers.claude.enabled` | `true`                                              |
| `fileNavigator.externalRoots`            | OS の一時ディレクトリ                               |
| `fileNavigator.autoExpandMatchLimit`     | `100`                                               |
| `tmux.socketName`                        | `null`                                              |
| `tmux.socketPath`                        | `null`                                              |
| `tmux.primaryClient`                     | `null`                                              |

補足:

- `fileNavigator.externalRoots` は、ログやローカルプレビュー資産から開ける repo 外の絶対パスを制御します。既定値は `os.tmpdir()` と、macOS では `/tmp` です。realpath で正規化するため、`/tmp` と `/private/tmp` は重複しません。明示的な配列（`[]` を含む）を設定すると既定値を置き換えます。
- `config check` / `config prune` はグローバル設定のみを対象にします。
- `config check` は問題が1件でもあると終了コード `1` で終了します（未使用キーを含む）。
- `config prune` は YAML を `config.yml` に書き込みます。入力が `config.json` の場合、成功後に削除されます。
- プロジェクトローカル設定（`<repo-root>/.vde/monitor/config.*`）は読み込まれません。必要な値はグローバル設定へ移行してください。

### cmux backend

cmux backend には cmux `0.64.17+` と macOS 14 以降が必要です。cmux.app をインストールした後、
Command Palette で **Install cmux CLI** を実行し、CLI を `PATH` に追加します。次のコマンドで導入を
確認してください。

```bash
cmux --version
```

準備ができたら、次のように起動します。

```bash
npx vde-monitor@latest --multiplexer cmux
```

またはグローバル設定で選択します。

```yaml
# ~/.config/vde/monitor/config.yml
multiplexer:
  backend: cmux
  cmux:
    cliPath: cmux
    socketPath: null
```

通常は `socketPath` を設定しないでください。vde-monitor は固定したファイルパスを仮定せず、起動時に
cmux CLI から使用中の socket を取得します。特定の cmux instance を意図的に選ぶ場合に限り、
`--cmux-socket` または `multiplexer.cmux.socketPath` を指定します。cmux CLI を `PATH` 上の `cmux`
として実行できない場合は、`--cmux-cli` または `multiplexer.cmux.cliPath` を使用します。例えば app
bundle 内の CLI は次のように直接指定できます。

```bash
npx vde-monitor@latest --multiplexer cmux \
  --cmux-cli /Applications/cmux.app/Contents/Resources/bin/cmux
```

明示した `--cmux-socket` または `multiplexer.cmux.socketPath` は、cmux から継承した
`CMUX_SOCKET_PATH` より優先されます。

cmux socket のアクセス権限は、vde-monitor の起動方法に合わせて明示的に設定する必要があります。

- **cmux Settings > Automation > Socket Control Mode** で mode を選択します。
- cmux-only の既定 access mode では、許可対象の子孫プロセスになるよう、cmux 内の terminal から
  vde-monitor を起動します。
- cmux 外からプロセスを起動する場合、Automation mode では同じ macOS user のローカルクライアントを
  子孫プロセスの検証なしで許可します。認証が必要なら Password mode を使用します。
- Password mode では、環境変数 `CMUX_SOCKET_PASSWORD` を設定し、cmux 側に同じ password を
  設定してください。設定ファイルへの password 保存はサポートされません。残っている
  `multiplexer.cmux.password` キーは無視され、`config check` が未使用キーとして報告します。
- `allowAll` は制御 socket を認証なしで公開するため非推奨であり、vde-monitor は意図的に拒否します。

cmux backend はローカル Unix socket を通して terminal Surface を取得・操作します。text-only の動作に
macOS の画面収録権限やアクセシビリティ権限は不要です。別 backend の画像キャプチャや platform
連携を使用する場合は、引き続きそれらの権限が必要になることがあります。

起動時に cmux の version、access mode、socket metadata、必須の v2 socket method を検証します。
契約を満たさない endpoint では即座に起動失敗し、固定 socket や tmux compatibility layer へは
fallback しません。

対応機能:

- terminal Surface の検出と安定した cmux UUID によるグルーピング
- text screen capture、text/key/raw 入力、focus、close
- cmux が注入する `CMUX_SURFACE_ID` と Hook 親プロセスの controlling TTY を照合した Claude/Codex
  Hook の対応付け（不一致・曖昧時は fail closed）

現在の制限:

- capture は text-only で、cmux の画像キャプチャには非対応
- browser Surface は監視対象外
- UI からの Codex/Claude 起動・resume は非対応
- tmux pipe mode に相当する機能はなく、activity は polling と Hook event で検出

## 通信方式（SSE + ポーリングフォールバック）

- Web UI はセッション一覧と text screen の更新を SSE（`GET /api/streams/sessions`、`GET /api/streams/sessions/:paneId/screen`）で受信します。
- SSE は `fetch` + `ReadableStream` で購読するため、`Authorization: Bearer` ヘッダを維持できます（native `EventSource` は不使用）。
- SSE が利用できない場合（プロキシ問題・サーバー再起動・ネットワーク断）、UI は自動的に従来のポーリング（一覧: 1秒、text screen: 1秒）へフォールバックし、指数バックオフで再接続します。設定は不要です。
- image モードのスクリーン取得と Chat Grid は設計上ポーリングのままです。
- 再接続時、sessions stream は `Last-Event-ID` で差分再送、screen stream はフルスナップショットから再開します。
- トークンローテーション（`POST /api/admin/token/rotate`）時は全ストリームが切断され、クライアントは新トークンで再接続します。
- 切戻し手順: `/api/streams/*` ルートを無効化（または SSE 関連コミットを revert）すればクライアントはポーリングのみで動作し続けます。

## プラットフォーム挙動

- tmux / WezTerm / herdr のテキストスクリーンキャプチャはクロスプラットフォームで動作
- cmux backend は macOS 14 以降でのみ動作し、text capture のみ対応
- 画像キャプチャは macOS 専用
- pane フォーカス連携は macOS 専用

## ランタイムデータの保存先

- Token: `~/.vde-monitor/token.json`
- セッション / タイムライン永続化: `~/.vde-monitor/state.json`
- Push VAPID鍵: `~/.vde-monitor/push-vapid.json`
- Push購読情報: `~/.vde-monitor/notifications.json`
- Hook イベントログ: `~/.vde-monitor/events/<server-key>/claude.jsonl`
- アップロード画像添付: `$TMPDIR/vde-monitor/attachments/<encoded-pane-id>/...`

## セキュリティ初期値

- API アクセスには Bearer token 認証が必須
- デフォルト bind host は loopback（`127.0.0.1`）
- `--public` は明示指定が必要
- `allowedOrigins` による Origin 制限を任意で利用可能
- ローカルファイルのプレビューには対象を限定した短命 URL を使用し、HTML の script・network connection・frame・object・form は CSP で遮断

## 開発

インストール:

```bash
pnpm install --frozen-lockfile
```

ローカル開発:

```bash
pnpm dev
pnpm dev:server
pnpm dev:web
pnpm dev:public
pnpm dev -- --tailscale  # serve the dev stack over Tailscale
```

品質チェック:

```bash
pnpm run ci
pnpm run ci:diff
pnpm run ci:fix
pnpm test
pnpm test:run
```

パッケージビルド:

```bash
pnpm build
```

`pnpm build` は npm 配布用アーティファクトを `dist/` に生成します（CLI エントリと web assets を含む）。

変更を監視して `dist/` を継続更新する場合:

```bash
pnpm run build:watch
```

## トラブルシューティング

- セッションが表示されない:
  - 選択した tmux / WezTerm / herdr / cmux backend が起動しているか確認
  - socket / target オプション（`--socket-name`, `--socket-path`, `--cmux-socket`, `--multiplexer`）を確認
  - cmux では version `0.64.17+`、macOS 14 以降、許可された socket access mode を確認
  - cmux-only access では vde-monitor を cmux 内から起動し、Password mode では
    `CMUX_SOCKET_PASSWORD` を設定
- URL は開けるが API が失敗する:
  - URL hash の token（`#token=...`）を確認
  - `npx vde-monitor@latest token rotate` で token を再発行
- モバイル端末から接続できない:
  - ネットワーク経路（SSH forward / Tailscale / LAN）を再確認
  - 適切なハードニングなしでパブリック公開しない
