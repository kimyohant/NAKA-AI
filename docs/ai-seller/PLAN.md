# AI นักขาย (AI Seller): แผนงาน

เมนู `/seller`: ทำโพสต์ขายสินค้าจากวิดีโอรีวิว พร้อมรูปสินค้า ลิงก์สินค้า (หรือ affiliate) และคอมเมนต์ปักหมุด
AI เขียนแคปชั่นแบบสบาย ๆ แยกตามช่องทาง: TikTok, Shopee, Facebook, Instagram

## เฟส 1 (ทำแล้ว)

1. **สินค้า**: ใส่ชื่อ ราคา ลิงก์ และลิงก์ affiliate ปุ่ม "ดึงข้อมูล" ใช้ ingest เดียวกับ Marketer/Studio (กัน SSRF) รูปสินค้าได้สูงสุด 9 รูป
2. **วิดีโอ**: อัปโหลดเอง หรือเลือกวิดีโอที่รวมคลิปเสร็จแล้วจาก Product Studio (คลังสกิล)
3. **แคปชั่นและช่องทาง**: เลือกช่องทาง สไตล์ (casual/fun/pro/urgent) ภาษา และโน้ตถึง AI แล้ว agent `seller_copywriter` คืน JSON ต่อช่องทาง `{caption, hashtags[], comment}`
4. **พร้อมโพสต์**: ตัวอย่างหน้าตาโพสต์ แก้ข้อความได้ (autosave) ปุ่มคัดลอกแคปชั่น+แฮชแท็ก ปุ่มคัดลอกคอมเมนต์+ลิงก์ ดาวน์โหลดวิดีโอ/รูป และลิงก์ไปหน้าโพสต์ของแต่ละแพลตฟอร์ม

หลักการ:
- ลิงก์ไม่ผ่าน LLM: backend ต่อท้ายคอมเมนต์เอง (affiliate มาก่อนลิงก์สินค้า) และ prompt ห้ามเขียน URL
- AI ใช้เฉพาะข้อมูลที่ผู้ใช้ใส่ ห้ามแต่งราคา ส่วนลด หรือสรรพคุณ
- สร้างข้อความใหม่เฉพาะช่องทางที่เลือก ช่องทางอื่นที่แก้มือไว้จะไม่ถูกทับ

## API: `/api/v1/seller`

| Method | Path | หน้าที่ |
|---|---|---|
| GET | `/options` | ช่องทาง / สไตล์ / ภาษา / จำนวนแฮชแท็กสูงสุด |
| GET | `/posts` | รายการโพสต์ (ใหม่ → เก่า) |
| POST | `/posts` | สร้างโพสต์ (ต้องมี productName หรือ productUrl) |
| GET | `/posts/:id` | รายละเอียด + `ready` (ข้อความพร้อมคัดลอก) |
| PUT | `/posts/:id` | แก้ไข (ส่งเฉพาะฟิลด์ที่เปลี่ยน) |
| DELETE | `/posts/:id` | soft delete |
| POST | `/posts/:id/generate` | AI เขียนแคปชั่น (sync) |
| POST | `/ingest-url` | ดึงข้อมูลสินค้าจากลิงก์ |
| GET | `/studio-videos` | วิดีโอที่รวมคลิปเสร็จแล้วใน Product Studio |

ตาราง `seller_posts` (migration v18) error codes: `E_SELLER_NEEDS_PRODUCT`, `E_SELLER_NO_CHANNEL`, `E_SELLER_COPY`

## เฟส 2 (ยังไม่ทำ): โพสต์อัตโนมัติ

ต้องตรวจเงื่อนไข API ล่าสุดของแต่ละแพลตฟอร์มก่อนลงมือ:
- Facebook Page / Instagram (Business หรือ Creator): Graph API โพสต์วิดีโอ/Reels และคอมเมนต์ได้ จึงควรทำก่อน
- TikTok Content Posting API: แอปต้องผ่าน audit ก่อน ถ้ายังไม่ผ่านจะโพสต์ได้แบบ private เท่านั้น
- Shopee: Open Platform เน้นการจัดการร้าน ส่วน Shopee Video อาจต้องโพสต์เองในแอป
- ต้องมี: เชื่อมบัญชี (OAuth) เก็บ token อย่างปลอดภัย คิวตั้งเวลาโพสต์ สถานะโพสต์และ retry
