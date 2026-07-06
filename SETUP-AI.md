# AI機能セットアップ手順（機能担当B）

features-b.js のAI機能（画像認識・自然言語解析）は、Supabase Edge Function
`ai-assist` を経由してClaude APIを呼び出します。APIキーはこのEdge
Function側にだけ置くので、features-b.js やGitHubリポジトリにキーが
含まれることはありません。

## 1. 必要なもの
- Supabaseプロジェクト（すでに使っているものでOK）
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- Anthropic APIキー（https://console.anthropic.com/ で取得）

## 2. Supabase CLIのセットアップ
```bash
npm install -g supabase
supabase login
supabase link --project-ref <あなたのプロジェクトref>
```
プロジェクトrefはSupabaseダッシュボードのURLや「Project Settings > General」で確認できます。

## 3. Edge Functionを配置
プロジェクトのルートに以下の構成でファイルを置きます（このリポジトリでは
`ai-assist/index.ts` として渡しています）。

```
supabase/
└── functions/
    └── ai-assist/
        └── index.ts   ← 渡された ai-assist/index.ts をここに配置
```

まだ `supabase/` フォルダがなければ、初回のみ以下を実行してください。
```bash
supabase functions new ai-assist
```
その後、生成された `supabase/functions/ai-assist/index.ts` の内容を、
渡したファイルの内容に置き換えてください。

## 4. APIキーをシークレットとして設定
```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
```
⚠️ このコマンドを実行する端末以外（GitHubなど）にはキーを絶対に置かないでください。

## 5. デプロイ
```bash
supabase functions deploy ai-assist
```

## 6. 動作確認
デプロイ後、アプリ上で以下を試してください。
- 予定モーダルのタイトル欄に「15時から16時に打ち合わせ」と入力 → 🤖ボタンをクリック
- ヘッダーの「🤖 AIで追加」から「明日の10時に病院」と入力
- 画像添付欄に予定が書かれた画像をアップロード

エラーが出る場合は、まず以下を確認してください。
- `supabase functions deploy ai-assist` が成功しているか
- `supabase secrets list` で `ANTHROPIC_API_KEY` が登録されているか
- ブラウザの開発者ツール（Console/Network）でエラーメッセージを確認

## モデルについて
現在は軽量・低コストな `claude-haiku-4-5-20251001` を使っています。
解析精度が足りない場合は `ai-assist/index.ts` 内の `MODEL` 定数を
`claude-sonnet-5` に変更してください（コストは上がります）。

## 補足：なぜクライアント側に直接キーを書かないのか
ブラウザで動くJavaScript（features-b.js）は誰でもソースコードを見られる
ため、そこにAPIキーを書くと以下のリスクがあります。
- GitHubにpushした瞬間にキーが公開される
- 誰かがキーを使って勝手にAPIを呼び出し、課金される
- 大学の授業でリポジトリを公開・共有する場合は特に注意が必要

Edge Function経由にすることで、キーはSupabase側のサーバー環境変数
（シークレット）にのみ存在し、ブラウザからは絶対に見えなくなります。
