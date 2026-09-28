import Anthropic from "@anthropic-ai/sdk";
import { createOrder, getSettings, ordersForUser, searchProducts, type Conversation, type OrderInput } from "./db";
import type { Env } from "./types";

const MODEL = "claude-opus-5";
const MAX_TOOL_ROUNDS = 6;

type MessageParam = Anthropic.Beta.BetaMessageParam;
type Tool = Anthropic.Beta.BetaTool;

const tools: Tool[] = [
  {
    name: "search_products",
    description:
      "ค้นหาสินค้าในร้านจากคำค้น (ชื่อ รายละเอียด หมวดหมู่) ส่งค่าว่างเพื่อดูสินค้าทั้งหมด คืนค่า id ชื่อ ราคา สต็อกคงเหลือ",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "คำค้น เช่น 'เสื้อ ดำ' หรือ '' สำหรับทั้งหมด" } },
      required: ["query"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "create_order",
    description:
      "สร้างออเดอร์เมื่อลูกค้ายืนยันสินค้า จำนวน และให้ ชื่อ เบอร์โทร ที่อยู่จัดส่ง ครบแล้วเท่านั้น ระบบตัดสต็อกและคืนเลขออเดอร์กับยอดรวม",
    input_schema: {
      type: "object",
      properties: {
        customer_name: { type: "string" },
        phone: { type: "string" },
        address: { type: "string", description: "ที่อยู่จัดส่งเต็ม รวมรหัสไปรษณีย์" },
        note: { type: "string", description: "เช่น ไซส์ สี หรือหมายเหตุอื่น ๆ" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { product_id: { type: "integer" }, quantity: { type: "integer" } },
            required: ["product_id", "quantity"],
            additionalProperties: false,
          },
        },
      },
      required: ["customer_name", "phone", "address", "note", "items"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "check_my_orders",
    description: "ดูออเดอร์ล่าสุดของลูกค้าคนนี้ พร้อมสถานะ (pending=รอชำระ, paid=ชำระแล้ว, shipped=จัดส่งแล้ว, cancelled=ยกเลิก)",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    name: "handoff_to_human",
    description:
      "ส่งต่อให้แอดมินตัวจริง ใช้เมื่อลูกค้าขอคุยกับคน ส่งสลิป/รูปภาพ ร้องเรียน ขอคืนเงิน หรือเรื่องที่ตอบจากข้อมูลร้านไม่ได้ หลังเรียกแล้วบอทจะหยุดตอบแชทนี้",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
      additionalProperties: false,
    },
    strict: true,
  },
];

function systemPrompt(settings: Record<string, string>): string {
  return `คุณคือ "นาคา" พนักงานขายออนไลน์ของร้าน "${settings.shop_name ?? "ร้านค้า"}" ให้บริการลูกค้าผ่าน LINE (ขับเคลื่อนโดย naka-ai)

หน้าที่: ตอบคำถามสินค้า แนะนำสินค้าที่เหมาะ ปิดการขาย และสร้างออเดอร์ให้ลูกค้า

ข้อมูลร้าน (นโยบาย ค่าส่ง การชำระเงิน):
${settings.shop_info ?? "-"}

แนวทาง:
- ตอบเป็นภาษาไทย สุภาพ เป็นกันเอง สั้นกระชับแบบแชท ไม่ใช้ markdown (LINE ไม่แสดงตัวหนา/หัวข้อ) ใช้อีโมจิได้พอประมาณ
- ราคาและสต็อกต้องมาจาก search_products เท่านั้น ห้ามเดาหรือแต่งข้อมูลสินค้าที่ไม่มีในระบบ
- ก่อนสร้างออเดอร์ ให้สรุปรายการ จำนวน ยอดรวม (รวมค่าส่งตามข้อมูลร้าน) และขอ ชื่อ เบอร์โทร ที่อยู่ ให้ครบ แล้วให้ลูกค้ายืนยันก่อน
- หลังสร้างออเดอร์ แจ้งเลขออเดอร์ ยอดชำระ และวิธีชำระเงินตามข้อมูลร้าน
- ถ้าไม่แน่ใจ หรือเป็นเรื่องที่ต้องใช้คนตัดสินใจ ให้ใช้ handoff_to_human และบอกลูกค้าว่าแอดมินจะติดต่อกลับ`;
}

async function runTool(env: Env, conv: Conversation, name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "search_products": {
      const products = await searchProducts(env.DB, String(input.query ?? ""));
      if (!products.length) return "ไม่พบสินค้าที่ตรงกับคำค้น";
      return JSON.stringify(
        products.map(({ id, name, description, category, price, stock }) => ({ id, name, description, category, price, stock })),
      );
    }
    case "create_order":
      return JSON.stringify(await createOrder(env.DB, conv.line_user_id, input as unknown as OrderInput));
    case "check_my_orders": {
      const orders = await ordersForUser(env.DB, conv.line_user_id);
      return orders.length ? JSON.stringify(orders) : "ลูกค้ายังไม่มีออเดอร์";
    }
    case "handoff_to_human":
      conv.human_mode = true;
      conv.handoff_reason = String(input.reason ?? "");
      return "ส่งต่อแอดมินเรียบร้อย แจ้งลูกค้าว่าแอดมินจะมาตอบเร็ว ๆ นี้";
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

/**
 * Run one customer turn through the sales agent. Mutates `conv` (history, handoff state)
 * and returns the text to send back to the customer.
 */
export async function runSalesAgent(env: Env, conv: Conversation, userText: string): Promise<string> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 25_000 });
  const settings = await getSettings(env.DB);

  const messages: MessageParam[] = [...conv.history.map((t) => ({ role: t.role, content: t.content })), { role: "user", content: userText }];

  let reply = "";
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: [{ type: "text", text: systemPrompt(settings), cache_control: { type: "ephemeral" } }],
      tools,
      messages,
    });

    if (response.stop_reason === "refusal") {
      reply = "ขออภัยค่ะ เรื่องนี้นาคาช่วยตอบไม่ได้ เดี๋ยวแอดมินจะมาดูแลต่อนะคะ 🙏";
      conv.human_mode = true;
      conv.handoff_reason = "AI declined to answer";
      break;
    }

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) reply = text;

    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    if (response.stop_reason !== "tool_use") break; // end_turn, max_tokens, stop_sequence

    messages.push({ role: "assistant", content: response.content });
    const toolResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      try {
        const content = await runTool(env, conv, block.name, block.input as Record<string, unknown>);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content });
      } catch (err) {
        console.error("tool failed", block.name, err);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: `เกิดข้อผิดพลาด: ${String(err)}`, is_error: true });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  if (!reply) reply = "ขออภัยค่ะ ระบบขัดข้องชั่วคราว รบกวนพิมพ์อีกครั้งนะคะ 🙏";
  conv.history.push({ role: "user", content: userText }, { role: "assistant", content: reply });
  return reply;
}
