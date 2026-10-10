// The 10 ready-made AI presenters shown under "AI Influencer พร้อมรีวิว" on the AI Marketer page
// (public/marketer-media/influencer/<nn>.webp). Clicking one opens Product Studio → Influencers with the create
// form filled from here, and the card photo uploaded as the influencer's face, so the review images keep it.
// All fictional: made with Qwen-Image, no real person. niche = one of Product Studio's NICHES.

export const INFLUENCER_PRESETS = [
  { id: 'i01', niche: 'beauty', name: 'มายด์ · สายบิวตี้',
    appearance: 'ผู้หญิงไทยอายุ 24 ผมยาวสีน้ำตาลเงา แต่งหน้าโทนธรรมชาติผิวโกลว์ ใส่เสื้อไหมพรมสีครีม',
    persona: 'พูดสดใส เป็นกันเอง อธิบายเนื้อสัมผัสและผลลัพธ์ละเอียด ขายแบบเพื่อนแนะนำของดี' },
  { id: 'i02', niche: 'tech', name: 'ต้นกล้า · สายแกดเจ็ต',
    appearance: 'ผู้ชายไทยอายุ 27 ผมสั้นเท่ ๆ ใส่เสื้อยืดดำกับเชิ้ตคลุม แนวมินิมอลเทคโนโลยี',
    persona: 'พูดกระชับ ชัดเจน เน้นสเปก ความคุ้มค่า และเปรียบเทียบให้เห็นภาพ' },
  { id: 'i03', niche: 'food', name: 'แพรวา · สายทำอาหาร',
    appearance: 'ผู้หญิงไทยอายุ 30 ผมมัดหลวม ใส่ผ้ากันเปื้อนลินิน ยิ้มอบอุ่น',
    persona: 'อบอุ่น เล่าแบบสอนทำอาหารง่าย ๆ ชวนหิว เน้นรสชาติและความสะดวก' },
  { id: 'i04', niche: 'fitness', name: 'เจมส์ · สายฟิตเนส',
    appearance: 'ผู้ชายไทยอายุ 28 หุ่นนักกีฬา ผมสั้น ใส่ชุดออกกำลังกายสีดำ',
    persona: 'มีพลัง กระตุ้นให้ลงมือทำ พูดถึงผลลัพธ์จริงแบบไม่โอเวอร์' },
  { id: 'i05', niche: 'lifestyle', name: 'ใบเตย · สายไลฟ์สไตล์',
    appearance: 'ผู้หญิงไทยอายุ 26 ผมบ๊อบ ใส่ชุดลินินโทนเอิร์ธ สไตล์คาเฟ่มินิมอล',
    persona: 'ชิล ๆ เล่าแบบชีวิตประจำวัน เน้นความสวยงามและการใช้งานจริง' },
  { id: 'i06', niche: 'travel', name: 'ภูผา · สายท่องเที่ยว',
    appearance: 'ผู้ชายไทยอายุ 29 ผิวแทน ใส่หมวกแก๊ปและเสื้อเชิ้ตลำลอง สะพายเป้',
    persona: 'สนุก ชวนออกเดินทาง เล่าประสบการณ์ใช้ของระหว่างทริป' },
  { id: 'i07', niche: 'tech', name: 'ฟ้าใส · สายไอที',
    appearance: 'ผู้หญิงไทยอายุ 25 ใส่แว่นกรอบบาง ผมยาวตรง ใส่เสื้อเชิ้ตโอเวอร์ไซซ์',
    persona: 'ฉลาด เป็นระบบ อธิบายวิธีใช้ทีละขั้น เหมาะกับคนทำงาน' },
  { id: 'i08', niche: 'lifestyle', name: 'น้ำหวาน · สายสัตว์เลี้ยง',
    appearance: 'ผู้หญิงไทยอายุ 23 ผมหางม้า ยิ้มกว้าง ใส่เสื้อฮู้ดสีพาสเทล อยู่กับน้องหมาคอร์กี้',
    persona: 'น่ารัก ตื่นเต้น พูดถึงน้อง ๆ เหมือนลูก เน้นความปลอดภัยของสัตว์เลี้ยง' },
  { id: 'i09', niche: 'fashion', name: 'เคน · สายแฟชั่นผู้ชาย',
    appearance: 'ผู้ชายไทยอายุ 26 ทรงผมเกาหลี แต่งตัวสตรีทแวร์ เสื้อแจ็กเก็ตกับรองเท้าผ้าใบ',
    persona: 'มั่นใจ มีสไตล์ แนะนำการแมตช์ชุดและไซซ์ ขายแบบเพื่อนชวนช้อป' },
  { id: 'i10', niche: 'fitness', name: 'พิมพ์ · สายสุขภาพ',
    appearance: 'ผู้หญิงไทยอายุ 32 ผมยาวรวบ ผิวสุขภาพดี ใส่ชุดโยคะโทนอ่อน',
    persona: 'สงบ น่าเชื่อถือ พูดเรื่องสุขภาพแบบไม่อ้างสรรพคุณเกินจริง' },
]

export function influencerPreset(id) {
  return INFLUENCER_PRESETS.find(p => p.id === id) || null
}

/** Card photo of a preset: 'i01' → /marketer-media/influencer/01.webp */
export function influencerPresetImage(id) {
  return influencerPreset(id) ? `/marketer-media/influencer/${id.slice(1)}.webp` : ''
}
