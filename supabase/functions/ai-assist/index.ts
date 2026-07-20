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
//     events: [
//       {
//         title: string,
//         date: "YYYY-MM-DD" | null,
//         startH: number | null, startM: number | null,
//         endH: number | null,   endM: number | null,
//         tag: string
//       },
//       ... // 画像内に複数の予定がある場合はここに複数入る
//     ]
//   }
//
// ★変更点（旧バージョンからの差分）
// 1. 応答を「単一オブジェクト」から「events配列」に変更。
//    画像に複数の予定が書かれている場合、すべてを配列で返すようにした。
//    （テキスト解析の場合も基本的にevents配列の1件目を使えばよい）
// 2. responseMimeType / responseSchema を指定し、Geminiに
//    JSON以外のテキストを絶対に混ぜさせないようにした。
//    → 「たまに読み取れないことがある」問題（Geminiの返答が
//      ```json ... ``` のようなコードブロック込みだったり、
//      説明文が混ざったりしてJSON.parseに失敗するケース）の対策。
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const MODEL = "gemini-3.1-flash-lite"; // 軽量・無料枠あり。精度が足りなければ gemini-2.5-flash に変更可

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Geminiに「必ずこの形で返せ」と強制するJSON Schema
// （responseSchemaとして渡すことで、モデルが自由な文章を混ぜられなくなる）
const EVENT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    events: {
      type: "array",
      description:
        "検出した予定の配列。画像やテキストに複数の予定が含まれる場合は、それぞれを別要素として返す。何も検出できなければ空配列。",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "予定のタイトル（簡潔に）" },
          date: {
            type: "string",
            nullable: true,
            description:
              "予定の日付（YYYY-MM-DD）。相対表現（今日/明日/来週の月曜など）は基準日から計算する。読み取れなければnull。",
          },
          startH: { type: "integer", nullable: true, description: "開始時（24時間表記、0-23）" },
          startM: { type: "integer", nullable: true, description: "開始分（0-59）" },
          endH: { type: "integer", nullable: true, description: "終了時。不明なら開始時刻+1時間" },
          endM: { type: "integer", nullable: true },
          tag: {
            type: "string",
            description:
              "次のいずれかに最も近いものを推測: 仕事, プライベート, 勉強, 健康, 買い物, もしくは空文字",
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
  const nowDate = now ? new Date(now) : new Date();
  const todayStr = referenceDate || nowDate.toISOString().slice(0, 10);
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][nowDate.getDay()];

  return (
    "あなたはスケジュール管理アプリのアシスタントです。" +
    "入力されたテキストや画像から予定情報を抽出し、指定されたJSON形式のみで返答してください。" +
    (isImage
      ? "画像の中に複数の予定（日時が異なる予定、複数の日にまたがる予定表やチラシなど）が" +
        "含まれている場合は、見つけたすべての予定をevents配列にそれぞれ別の要素として入れてください。" +
        "1件しかない場合もevents配列に1件だけ入れてください。" +
        "時間割のように「－」やハイフンだけが書かれたコマ、空欄のコマは予定が無いことを意味するので、" +
        "events配列には含めないでください。"
      : "基本的に1件の予定としてevents配列に1件だけ入れてください。" +
        "ただし「明日10時に病院、15時に美容院」のように明らかに複数の予定が含まれている場合は、" +
        "それぞれをevents配列の別要素にしてください。") +
    "\n\n基準日（今日）は " +
    todayStr +
    "（" +
    weekday +
    "曜日）です。日本語のテキストとして解釈してください。" +
    "情報が読み取れない項目はnullにしてください。予定が全く見つからない場合はevents: []としてください。"
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

    // Gemini の parts 配列を組み立てる
    const parts: Array<Record<string, unknown>> = [];
    const isImage = action === "parse_image";

    if (action === "parse_text") {
      if (!body.text) throw new Error("text が指定されていません");
      parts.push({ text: body.text });
    } else if (isImage) {
      if (!body.image || !body.mediaType)
        throw new Error("image / mediaType が指定されていません");
      parts.push({
        inlineData: {
          mimeType: body.mediaType,
          data: body.image,
        },
      });
      parts.push({
        text: "この画像に書かれている予定・イベント情報をすべて読み取ってください。",
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
            parts: [{ text: buildSystemPrompt(referenceDate, now, isImage) }],
          },
          contents: [{ parts }],
          generationConfig: {
            maxOutputTokens: 3000, // 時間割のように予定が多い画像でも切れないよう引き上げ（旧: 1500）
            responseMimeType: "application/json",
            responseSchema: EVENT_RESPONSE_SCHEMA,
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
      // レスポンスがブロックされた場合など（finishReason: SAFETY 等）も
      // ここに来るので、原因が分かるようにログに残す
      console.error("AIから空の応答:", JSON.stringify(data));
      throw new Error("AIからテキスト応答が得られませんでした");
    }

    const textPart = candidate.content.parts.find(
      (p: any) => typeof p.text === "string"
    );
    if (!textPart) throw new Error("AIからテキスト応答が得られませんでした");

    // responseSchemaを指定しているので基本的にJSON.parseだけで通るはずだが、
    // 念のため万一コードブロックが混ざっていた場合のフォールバックも残す
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
