import type Anthropic from "@anthropic-ai/sdk";
import { tsunamiRegionsFor } from "../jma/regions.js";
import { TSUNAMI_DISPLAY_LEVEL } from "../composer/rules.js";
import type { Alert } from "../jma/parse.js";
import { MODELS, costOf, type CallUsage, type ModelKey } from "../reader/pricing.js";
import type { Finding } from "./checks.js";

export const VISION_VERIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings", "three_second_note"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["check", "cell_id", "reason"],
        properties: {
          check: { enum: ["bulletin-mismatch", "pictogram-misuse", "missing-source"] },
          cell_id: { type: "string", description: "id of the offending cell from the layout JSON, or empty if it concerns the whole screen" },
          reason: { type: "string" },
        },
      },
    },
    three_second_note: { type: "string", description: "Whether a person with no background would know what to do within three seconds, and why. Not a finding." },
  },
} as const;

const TSUNAMI_RULE = `大津波警報=${TSUNAMI_DISPLAY_LEVEL.major_warning}・津波警報=${TSUNAMI_DISPLAY_LEVEL.warning}・津波注意報=${TSUNAMI_DISPLAY_LEVEL.advisory}`;
const SYSTEM = `あなたは避難案内サイネージの検査係です。描画された画面の画像と、その画面のレイアウト JSON、元になった気象庁の電文の要点を受け取ります。画面に見えているものだけを根拠に、次の 3 つを判定します。見えないもの・推測は判定に使いません。問題が無ければ findings は空にします。
- bulletin-mismatch: 画面の災害種別・警戒レベル・警報名・行動が、電文と矛盾している（例: 電文は洪水なのに津波と書いてある、電文のレベルと画面のレベル表示が違う、解除なのに避難を促している）。言い換えや省略は矛盾ではない。municipality_areas はこの自治体に当たる区域だけで、電文の他の区域の警報は判定に使わない。津波の display_level は警報種別から規則で決まる（${TSUNAMI_RULE}）ので、電文に level 欄が無くても矛盾ではない。status が drill（訓練電文）なら、見出し（headline）の「【訓練】」「DRILL」等の訓練表記は正しい表示。action・languages セルは ja 以外の言語に訓練語を持ち、ja の action には入れない契約（ja は見出しで示す）なので、ja の action に無いことは矛盾にしない。津波の区域が警報・注意報から津波予報（若干の海面変動・status downgraded）に下がった電文は解除画面で、見出しは「〈直前の警報名〉解除」、行動は「海に入らない・海岸に近づかない」の注意文、行動の図記号は解除の safe_here（災害種別は見出しの図記号が担う）。この組み合わせは解除とも図記号とも矛盾しない
- pictogram-misuse: 図記号が災害種別や行動と合っていない（例: 洪水の画面に津波の図記号、上へ逃げる画面に横へ逃げる図記号）。図記号 ID の意味はユーザー入力に書く
- missing-source: 出典行（気象庁の発表時刻と自治体名）が画面に見えない、または読めない
three_second_note には、前提知識のない人が 3 秒で何をすればよいか分かるかを 1〜2 文で書く。これは所見で、findings には入れない。`;

const LANGUAGES = "languages セルの言語と並び順: ja_easy（やさしい日本語）, en, zh_hans, zh_hant, ko, th（タイ文字）, vi（ベトナム語・ダイアクリティカル付き）, fil（フィリピン語）, id（インドネシア語）。これらの文字が見えるのは正常で、判定対象は意味の矛盾だけ";
const PICTOGRAMS = "図記号 ID: tsunami=津波, flood=洪水・浸水, landslide=土砂災害, heavy_rain=大雨, storm_surge=高潮, earthquake=地震, go_higher=高い所・上の階へ, directions_run=避難する（走る人）, arrow_forward=方向（rotation で向き）, emergency_evacuation_site=指定緊急避難場所, evacuation_shelter=指定避難所, safe_here=ここは安全";

export interface VisionVerdict { findings: Finding[]; note: string; usage: CallUsage }

export async function visionCheck(args: {
  client: Anthropic; model: ModelKey; pngs: string[]; layout: unknown; alert: Alert; municipalityId: string;
}): Promise<VisionVerdict> {
  const l = args.layout as { cells: { id: string; role: string; text: { ja: string }; pictogram?: string; rotation?: number }[]; template: string; alert: { level: number; hazard: string } };
  // Tsunami bulletins list every forecast region in the country; Vision must judge the screen against this
  // municipality's region only, as the Composer does.
  const regions = new Set(tsunamiRegionsFor(args.municipalityId));
  const mine = args.alert.areas.filter((a) => (a.code_type === "city" ? a.code.slice(0, 5) === args.municipalityId : regions.has(a.code)));
  const bulletin = {
    hazard: args.alert.hazard,
    title: args.alert.raw_title,
    headline_text: args.alert.headline_text,
    issued_at: args.alert.issued_at,
    status: args.alert.status,
    municipality_areas: mine.map((a) => ({ name: a.name, kind_name: a.kind_name, level: a.level, status: a.status })),
  };
  const layoutBrief = { template: l.template, display_level: l.alert.level, cells: l.cells.map((c) => ({ id: c.id, role: c.role, ja: c.text.ja, pictogram: c.pictogram, rotation: c.rotation })) };
  const msg = await args.client.messages.stream({
    model: MODELS[args.model].id,
    max_tokens: 8_000,
    system: SYSTEM,
    output_config: { effort: "medium", format: { type: "json_schema", schema: VISION_VERIFY_SCHEMA as unknown as Record<string, unknown> } },
    messages: [{
      role: "user",
      content: [
        ...args.pngs.map((data) => ({ type: "image" as const, source: { type: "base64" as const, media_type: "image/png" as const, data } })),
        { type: "text" as const, text: [`画面画像は ${args.pngs.length} 枚（横長の画面は左右に分割）。`, PICTOGRAMS, LANGUAGES, `## 電文の要点\n${JSON.stringify(bulletin, null, 1)}`, `## レイアウト JSON（要点）\n${JSON.stringify(layoutBrief, null, 1)}`].join("\n\n") },
      ],
    }],
  }).finalMessage();
  if (msg.stop_reason === "refusal" || msg.stop_reason === "max_tokens") throw new Error(`vision verifier stopped: ${msg.stop_reason}`);
  const text = msg.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "{}";
  const out = JSON.parse(text) as { findings: { check: Finding["check"]; cell_id: string; reason: string }[]; three_second_note: string };
  return {
    findings: out.findings.map((f) => ({ check: f.check, ...(f.cell_id ? { cell_id: f.cell_id } : {}), detail: `vision: ${f.reason}` })),
    note: out.three_second_note,
    usage: costOf(args.model, "vision-verify", msg.usage),
  };
}
