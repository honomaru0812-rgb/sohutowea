// ============================================================
// supabase/functions/ai-assist/index.ts
// ============================================================
// フロントエンド（features-b.js）から呼ばれるEdge Function。
// Claude APIキーはここ（Supabaseのシークレット）にだけ置く。
// デプロイ手順は SETUP-AI.md を参照。
//
// リクエスト body:
//   { action: "parse_text",  text: string, referenceDate?: "YYYY-MM-DD", now?: ISOString }
//   { action: "parse_image", image: base64string, mediaType: string, referenceDate?, now? }
//
// レスポンス body（成功時）:
//   {
//     title: string,
//     date: "YYYY-MM-DD" | null,
//     startH: number | null, startM: number | null,
//     endH: number | null,   endM: number | null,
//     tag: string
//   }
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-haiku-4-5-20251001"; // 軽量タスクなのでHaiku。精度が足りない場合はclaude-sonnet-5に変更可

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function buildSystemPrompt(referenceDate: string | undefined, now: string | undefined) {
  const nowDate = now ? new Date(now) : new Date();
  const todayStr = referenceDate || nowDate.toISOString().slice(0, 10);
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][nowDate.getDay()];

  return (
    "あなたはスケジュール管理アプリのアシスタントです。" +
    "入力されたテキストや画像から予定情報を抽出し、必ず次のJSON形式のみで返答してください。" +
    "説明文やマークダウンのコードブロック記号は一切含めないでください。\n\n" +
    "{\n" +
    '  "title": string,            // 予定のタイトル（簡潔に）\n' +
    '  "date": "YYYY-MM-DD" | null, // 予定の日付。相対表現（今日/明日/来週の月曜など）は基準日から計算する\n' +
    '  "startH": number | null,     // 開始時（24時間表記、0-23）\n' +
    '  "startM": number | null,     // 開始分（0-59）\n' +
    '  "endH": number | null,       // 終了時。不明なら開始時刻+1時間\n' +
    '  "endM": number | null,\n' +
    '  "tag": string                // 次のいずれかに最も近いものを推測: 仕事, プライベート, 勉強, 健康, 買い物, もしくは空文字\n' +
    "}\n\n" +
    "基準日（今日）は " + todayStr + "（" + weekday + "曜日）です。日本語のテキストとして解釈してください。" +
    "情報が読み取れない項目は null にしてください。"
  );
}

function extractJSON(text: string) {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  return JSON.parse(cleaned);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY が設定されていません（supabase secrets set で設定してください）");
    }

    const body = await req.json();
    const { action, referenceDate, now } = body;

    let userContent;
    if (action === "parse_text") {
      if (!body.text) throw new Error("text が指定されていません");
      userContent = [{ type: "text", text: body.text }];
    } else if (action === "parse_image") {
      if (!body.image || !body.mediaType) throw new Error("image / mediaType が指定されていません");
      userContent = [
        { type: "image", source: { type: "base64", media_type: body.mediaType, data: body.image } },
        { type: "text", text: "この画像に書かれている予定・イベント情報を読み取ってください。" },
      ];
    } else {
      throw new Error("action は parse_text または parse_image を指定してください");
    }

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        system: buildSystemPrompt(referenceDate, now),
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      throw new Error("Anthropic API エラー: " + errText);
    }

    const data = await anthropicRes.json();
    const textBlock = (data.content || []).find((b: any) => b.type === "text");
    if (!textBlock) throw new Error("AIからテキスト応答が得られませんでした");

    const parsed = extractJSON(textBlock.text);

    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err.message || err) }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
