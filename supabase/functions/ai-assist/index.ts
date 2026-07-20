// ============================================================
// supabase/functions/ai-assist/index.ts
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
// ★ 修正: 確実に動作する安定版のモデル名に変更
const MODEL = "gemini-3.1-flash-lite"; 

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Geminiに「必ずこの形で返せ」と強制するJSON Schema
const EVENT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    events: {
      type: "array",
      description: "検出した予定の配列。画像やテキストに複数の予定が含まれる場合はそれぞれ別要素にする。何もなければ空配列。",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "予定のタイトル（簡潔に）" },
          date: {
            type: "string",
            nullable: true,
            description: "予定の日付（YYYY-MM-DD）。相対表現は基準日から計算。読み取れなければnull。",
          },
          startH: { type: "integer", nullable: true, description: "開始時（24時間表記）" },
          startM: { type: "integer", nullable: true, description: "開始分" },
          endH: { type: "integer", nullable: true, description: "終了時。不明なら開始時刻+1時間" },
          endM: { type: "integer", nullable: true },
          tag: {
            type: "string",
            description: "仕事, プライベート, 勉強, 健康, 買い物, もしくは空文字",
          },
        },
        required: ["title", "date", "startH", "startM", "endH", "endM", "tag"],
      },
    },
  },
  required: ["events"],
};

function buildSystemPrompt(
  referenceDate: string | undefined,
  now: string | undefined,
  isImage: boolean
) {
  // ★ 修正: 日付文字列のパース事故を防ぐ安全な処理
  let todayStr = referenceDate;
  if (!todayStr && now) {
    todayStr = now.split(" ")[0]; // "YYYY-MM-DD" 部分を直接切り出す
  }
  if (!todayStr || !/^\d{4}-\d{2}-\d{2}$/.test(todayStr)) {
    todayStr = new Date().toISOString().slice(0, 10);
  }

  return (
    "あなたはスケジュール管理アプリのアシスタントです。" +
    "入力されたテキストや画像から予定情報を抽出し、指定されたJSON形式のみで返答してください。" +
    (isImage
      ? "画像の中に複数の予定が含まれている場合は、見つけたすべての予定をevents配列にそれぞれ別の要素として入れてください。1件しかない場合もevents配列に1件だけ入れてください。"
      : "基本的に1件の予定としてevents配列に1件だけ入れてください。ただし明らかに複数の予定が含まれている場合は、それぞれをevents配列の別要素にしてください。") +
    "\n\n【重要なルール】" +
    "\n1. 基準日（今日）は 「" + todayStr + "」 です。" +
    "\n2. 「明日」「来週」などの相対的な指定がある場合は、基準日から計算した日付(YYYY-MM-DD)をセットしてください。" +
    "\n3. 「15時に会議」のように日付の指定がない場合は、date に基準日（" + todayStr + "）をそのままセットしてください。" +
    "\n4. date フィールドを絶対に null や空文字にしないでください。"
  );
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

    const parts: Array<Record<string, unknown>> = [];
    const isImage = action === "parse_image";

    if (action === "parse_text") {
      if (!body.text) throw new Error("text が指定されていません");
      // ★修正: テキスト解析時にも明確な指示を添えることで精度を大幅に向上
      parts.push({ 
        text: `以下のテキストから予定情報を抽出し、JSON形式で出力してください。\n\n「${body.text}」` 
      });
    } else if (isImage) {
      if (!body.image || !body.mediaType)
        throw new Error("image / mediaType が指定されていません");
      parts.push({
        inlineData: { mimeType: body.mediaType, data: body.image },
      });
      parts.push({
        text: "この画像に書かれている予定・イベント情報をすべて読み取ってください。",
      });
    } else {
      throw new Error("action は parse_text または parse_image を指定してください");
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: buildSystemPrompt(referenceDate, now, isImage) }],
          },
          contents: [{ parts }],
          generationConfig: {
            maxOutputTokens: 3000,
            responseMimeType: "application/json",
            responseSchema: EVENT_RESPONSE_SCHEMA,
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini API Error Raw:", errText);
      throw new Error("Gemini API エラー: " + errText);
    }

    const data = await geminiRes.json();
    const candidate = data.candidates?.[0];

    if (!candidate?.content?.parts?.length) {
      console.error("AIから空の応答:", JSON.stringify(data));
      throw new Error("AIからテキスト応答が得られませんでした");
    }

    const textPart = candidate.content.parts.find((p: any) => typeof p.text === "string");
    if (!textPart) throw new Error("AIからテキスト応答が得られませんでした");

    let parsed: unknown;
    try {
      parsed = JSON.parse(textPart.text);
    } catch {
      const cleaned = textPart.text
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "");
      parsed = JSON.parse(cleaned);
    }

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