// ============================================================
// supabase/functions/ai-assist/index.ts
// ============================================================
// フロントエンド（features-b.js）から呼ばれるEdge Function。
// Gemini APIキーはここ（Supabaseのシークレット）にだけ置く。
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

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const MODEL = "gemini-2.0-flash"; // 軽量・無料枠あり。精度が足りなければ gemini-2.5-flash に変更可

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function buildSystemPrompt(
  referenceDate: string | undefined,
  now: string | undefined
) {
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
    "基準日（今日）は " +
    todayStr +
    "（" +
    weekday +
    "曜日）です。日本語のテキストとして解釈してください。" +
    "情報が読み取れない項目は null にしてください。"
  );
}

function extractJSON(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "");
  return JSON.parse(cleaned);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    if (!GEMINI_API_KEY) {
      throw new Error(
        "GEMINI_API_KEY が設定されていません（supabase secrets set GEMINI_API_KEY=... で設定してください）"
      );
    }

    const body = await req.json();
    const { action, referenceDate, now } = body;

    // Gemini の parts 配列を組み立てる
    const parts: Array<Record<string, unknown>> = [];

    if (action === "parse_text") {
      if (!body.text) throw new Error("text が指定されていません");
      parts.push({ text: body.text });
    } else if (action === "parse_image") {
      if (!body.image || !body.mediaType)
        throw new Error("image / mediaType が指定されていません");
      parts.push({
        inlineData: {
          mimeType: body.mediaType,
          data: body.image,
        },
      });
      parts.push({
        text: "この画像に書かれている予定・イベント情報を読み取ってください。",
      });
    } else {
      throw new Error(
        "action は parse_text または parse_image を指定してください"
      );
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: buildSystemPrompt(referenceDate, now) }],
          },
          contents: [{ parts }],
          generationConfig: {
            maxOutputTokens: 500,
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      throw new Error("Gemini API エラー: " + errText);
    }

    const data = await geminiRes.json();

    // Gemini のレスポンス構造: data.candidates[0].content.parts[0].text
    const candidate = data.candidates?.[0];
    if (!candidate?.content?.parts?.length) {
      throw new Error("AIからテキスト応答が得られませんでした");
    }

    const textPart = candidate.content.parts.find(
      (p: any) => typeof p.text === "string"
    );
    if (!textPart) throw new Error("AIからテキスト応答が得られませんでした");

    const parsed = extractJSON(textPart.text);

    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String((err as Error).message || err) }),
      {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      }
    );
  }
});