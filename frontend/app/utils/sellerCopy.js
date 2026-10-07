// AI นักขาย — ประกอบข้อความพร้อมโพสต์ฝั่ง frontend (ตรงกับ backend services/seller.ts composeChannel)
// เพื่อให้ปุ่มคัดลอกได้ข้อความล่าสุดทันทีระหว่างแก้ ไม่ต้องรอ autosave

export const SELLER_CHANNELS = ['tiktok', 'shopee', 'facebook', 'instagram']

/** หน้าเว็บสำหรับไปโพสต์เอง (Phase 1 ยังไม่โพสต์อัตโนมัติ) */
export const CHANNEL_POST_URLS = {
  tiktok: 'https://www.tiktok.com/upload',
  shopee: 'https://seller.shopee.co.th/',
  facebook: 'https://www.facebook.com/',
  instagram: 'https://www.instagram.com/',
}

/** "#a b, #c" → ['a', 'b', 'c'] (ไม่มี #, ไม่ซ้ำ) */
export function parseHashtags(text) {
  return [...new Set(String(text || '').split(/[\s,]+/).map(h => h.replace(/^#+/, '').replace(/#/g, '')).filter(Boolean))]
}

export function hashtagsText(tags) {
  return (tags || []).map(h => `#${h}`).join(' ')
}

/** affiliate มาก่อน ไม่มีใช้ลิงก์สินค้า */
export function postLink(post) {
  return (post?.affiliateUrl || '').trim() || (post?.productUrl || '').trim() || null
}

/** post = แคปชั่น + แฮชแท็ก, comment = คอมเมนต์ + ลิงก์ (ไม่ซ้ำถ้ามีลิงก์อยู่แล้ว) */
export function composeChannel(content, link) {
  const caption = String(content?.caption || '').trim()
  const tags = hashtagsText(content?.hashtags)
  const comment = String(content?.comment || '').trim()
  return {
    post: [caption, tags].filter(Boolean).join('\n\n'),
    comment: link && !comment.includes(link) ? [comment, link].filter(Boolean).join('\n') : comment,
  }
}
