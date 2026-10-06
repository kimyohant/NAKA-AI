// What the AI marketer offers, in one place: the page reads it from /api/marketer/config and the
// job handlers validate against it. Everything is written for Thai sellers.

/** Top-level categories, close to TikTok Shop Thailand's. */
export const CATEGORIES = {
  beauty: "ความงามและของใช้ส่วนตัว",
  health: "สุขภาพและอาหารเสริม",
  fashion: "แฟชั่นและเครื่องประดับ",
  food: "อาหารและเครื่องดื่ม",
  home: "ของใช้ในบ้าน",
  kitchen: "เครื่องครัว",
  mom_baby: "แม่และเด็ก",
  electronics: "มือถือและอิเล็กทรอนิกส์",
  appliances: "เครื่องใช้ไฟฟ้า",
  sports: "กีฬาและกิจกรรมกลางแจ้ง",
  auto: "ยานยนต์และอุปกรณ์",
  pets: "สัตว์เลี้ยง",
  toys: "ของเล่นและงานอดิเรก",
  other: "อื่น ๆ",
} as const;
export type Category = keyof typeof CATEGORIES;
export const isCategory = (value: unknown): value is Category => typeof value === "string" && Object.hasOwn(CATEGORIES, value);

/** The "expert" the agent plays: each knows its platform's rules, formats and buyers. */
export const EXPERTS = {
  general: { label: "นักการตลาดทั่วไป", brief: "มองทุกช่องทางขายออนไลน์ของไทย แล้วแนะนำช่องทางที่เหมาะกับสินค้า" },
  tiktok_shop: { label: "ผู้เชี่ยวชาญ TikTok Shop", brief: "คลิปสั้นแนวตั้ง ตะกร้าเหลือง ไลฟ์ขายของ ครีเอเตอร์ affiliate และ GMV Max" },
  shopee: { label: "ผู้เชี่ยวชาญ Shopee", brief: "ชื่อสินค้าให้ติดค้นหา รูปปก โค้ดส่วนลดร้าน แคมเปญเลขเบิ้ล Shopee Live และ Shopee Ads" },
  lazada: { label: "ผู้เชี่ยวชาญ Lazada", brief: "LazMall หน้าร้าน ชื่อสินค้า แคมเปญ Sponsored Discovery และ LazLive" },
  facebook: { label: "ผู้เชี่ยวชาญ Facebook และ Instagram", brief: "เพจ กลุ่ม Reels Meta Ads การยิงแอดแบบ Advantage+ และการปิดการขายทางแชต" },
  line_oa: { label: "ผู้เชี่ยวชาญ LINE OA", brief: "บรอดแคสต์ ริชเมนู คูปอง การดูแลลูกค้าเก่าและการขายซ้ำ" },
} as const;
export type Expert = keyof typeof EXPERTS;
export const isExpert = (value: unknown): value is Expert => typeof value === "string" && Object.hasOwn(EXPERTS, value);

export interface InsightTemplate {
  id: string;
  group: "market" | "listing" | "content" | "ads";
  title: string;
  icon: "chart" | "search" | "doc" | "chat" | "video" | "money" | "calendar";
  /** The prompt the seller edits; [square brackets] are the parts they fill in. */
  prompt: string;
}

export const GROUPS = {
  market: "วิเคราะห์ตลาด",
  listing: "หน้าร้านและรีวิว",
  content: "คอนเทนต์และครีเอเตอร์",
  ads: "โฆษณาและผลลัพธ์",
} as const;

export const TEMPLATES: readonly InsightTemplate[] = [
  { id: "category_opportunity", group: "market", icon: "chart", title: "โอกาสในหมวดสินค้า",
    prompt: "วิเคราะห์โอกาสของหมวด [หมวดสินค้า] ในตลาดออนไลน์ไทย ช่วงราคาที่ขายดี กลุ่มลูกค้าหลัก ช่องว่างที่ร้านเล็กเข้าไปได้ และสินค้าแบบไหนที่ควรเริ่มก่อน" },
  { id: "trending_products", group: "market", icon: "chart", title: "สินค้ามาแรงตอนนี้",
    prompt: "จากคลิปมาแรงในหมวด [หมวดสินค้า] บอกว่าสินค้าและมุมขายแบบไหนกำลังได้ผลบน TikTok Shop และ Shopee ไทย และร้านของฉันที่ขาย [สินค้าของคุณ] ควรหยิบอะไรมาใช้" },
  { id: "competitor_scan", group: "market", icon: "search", title: "สแกนคู่แข่ง",
    prompt: "เปรียบเทียบสินค้า [สินค้าของคุณ] ราคา [ราคา] บาท กับคู่แข่ง [ชื่อร้านหรือสินค้าคู่แข่ง พร้อมราคา] หาจุดที่เราชนะ จุดที่ต้องแก้ และข้อความขายที่ทำให้ลูกค้าเลือกเรา" },
  { id: "pricing_strategy", group: "market", icon: "money", title: "ตั้งราคาสินค้าใหม่",
    prompt: "ช่วยวางราคาเปิดตัวสินค้า [สินค้าของคุณ] ต้นทุน [ต้นทุน] บาท คู่แข่งขายราคา [ช่วงราคา] บาท วางราคาปกติ ราคาโปรเปิดตัว ราคาแคมเปญเลขเบิ้ล และชุดสินค้า (bundle) ที่ยังมีกำไร" },
  { id: "title_optimization", group: "listing", icon: "doc", title: "ปรับชื่อสินค้าให้ติดค้นหา",
    prompt: "ปรับชื่อสินค้า [ชื่อสินค้าตอนนี้] สำหรับ [Shopee / Lazada / TikTok Shop] ให้ติดคำค้นภาษาไทยที่คนพิมพ์จริง พร้อมคำอธิบายสินค้าและคำค้นที่ควรใส่" },
  { id: "review_insights", group: "listing", icon: "chat", title: "วิเคราะห์รีวิวและปัญหาลูกค้า",
    prompt: "สรุปรีวิวลูกค้าต่อไปนี้ของ [สินค้าของคุณ] ว่าลูกค้าชอบอะไร บ่นอะไร ควรแก้สินค้า หน้าร้าน หรือคำตอบแชตอย่างไร: [วางรีวิวลูกค้า]" },
  { id: "ugc_brief", group: "content", icon: "doc", title: "บรีฟครีเอเตอร์ (UGC)",
    prompt: "เขียนบรีฟให้ครีเอเตอร์ TikTok ทำคลิปรีวิว [สินค้าของคุณ] กลุ่มเป้าหมาย [กลุ่มลูกค้า] ระบุมุมเล่า ฮุก 3 ช็อตแรก สิ่งที่ห้ามพูด และค่าตอบแทนแบบคอมมิชชันที่เหมาะสม" },
  { id: "video_script", group: "content", icon: "video", title: "สคริปต์คลิป TikTok",
    prompt: "เขียนสคริปต์คลิปขาย [สินค้าของคุณ] ยาว [15 / 30 / 60] วินาที ฮุก 3 แบบ ช็อตต่อช็อต ข้อความบนจอ และคำชวนกดตะกร้า" },
  { id: "viral_analysis", group: "content", icon: "video", title: "ถอดสูตรคลิปไวรัล",
    prompt: "ถอดสูตรคลิปนี้: [วางลิงก์หรือแคปชันคลิปไวรัล] ฮุก โครงเรื่อง จังหวะ และเหตุผลที่คนซื้อ แล้วปรับเป็นไอเดียคลิปสำหรับ [สินค้าของคุณ]" },
  { id: "campaign_calendar", group: "ads", icon: "calendar", title: "แผนแคมเปญเลขเบิ้ลและเงินเดือนออก",
    prompt: "วางแผนแคมเปญ [เดือน] สำหรับร้าน [ประเภทร้าน] ครอบคลุมวันเลขเบิ้ล วันเงินเดือนออก และเทศกาลไทยในเดือนนั้น งบโฆษณา [งบ] บาท แบ่งงานเป็นรายสัปดาห์" },
  { id: "roas_analysis", group: "ads", icon: "money", title: "วิเคราะห์ ROAS โฆษณา",
    prompt: "วิเคราะห์ผลโฆษณาต่อไปนี้ แคมเปญไหนควรเพิ่มงบ ตัด หรือปรับครีเอทีฟ: [วางตัวเลข ค่าโฆษณา ยอดขาย คลิก CTR ของแต่ละแคมเปญ]" },
  { id: "search_terms", group: "ads", icon: "search", title: "คำค้นสำหรับยิงแอด",
    prompt: "หาคำค้นภาษาไทยสำหรับยิงโฆษณา [สินค้าของคุณ] บน Shopee Ads และ Lazada Sponsored แยกคำหลัก คำเฉพาะเจาะจง และคำที่ควรตัดออก" },
];
export const TEMPLATE_BY_ID: ReadonlyMap<string, InsightTemplate> = new Map(TEMPLATES.map((t) => [t.id, t]));

/** Thai selling calendar the agent keeps in mind. */
export const THAI_MARKET_CONTEXT = `บริบทตลาดไทยที่ต้องใช้:
- ช่องทางหลัก: TikTok Shop, Shopee, Lazada, Facebook/Instagram, LINE OA และไลฟ์ขายของ
- แคมเปญเลขเบิ้ลทุกเดือน (เช่น 9.9, 10.10, 11.11, 12.12) และวันเงินเดือนออก (ราววันที่ 25 ถึงต้นเดือน) เป็นช่วงยอดขายสูง
- เทศกาลไทย เช่น สงกรานต์ ตรุษจีน ลอยกระทง ปีใหม่ วันแม่ วันพ่อ และช่วงเปิดเทอม
- ราคาเป็นบาท ผู้ซื้อไวต่อค่าส่ง โค้ดส่วนลด และการเก็บเงินปลายทาง
- โฆษณาอาหาร อาหารเสริม เครื่องสำอาง และสุขภาพต้องไม่อ้างสรรพคุณเกินจริงหรือรักษาโรค (ตามหลักเกณฑ์ อย. และ สคบ.)`;
