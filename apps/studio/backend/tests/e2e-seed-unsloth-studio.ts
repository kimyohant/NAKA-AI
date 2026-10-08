/**
 * Seed scratch DB สำหรับทดสอบ e2e กับ unsloth server จริง (รันด้วย tsx ชี้ SQLITE_PATH ที่ scratch)
 * สร้าง: drama + episode (video config = unsloth) + studio project (2 ช็อต, keyframe สมมุติเสร็จแล้ว)
 * บทพูด/keyframe เป็นภาษาไทยตาม brief — ไม่สร้างงานจริงในสคริปต์นี้
 */
import { db, getInsertId, schema } from '../src/core/db/index.js'
import { eq } from 'drizzle-orm'
import { now } from '../src/core/http/response.js'

const ts = now()

const dramaRes = db.insert(schema.dramas).values({
  title: 'E2E unsloth เซรั่มวิตซี',
  style: 'UGC realistic',
  aspectRatio: '9:16',
  status: 'draft',
  createdAt: ts,
  updatedAt: ts,
}).run()
const dramaId = getInsertId(dramaRes)

const episodeRes = db.insert(schema.episodes).values({
  dramaId,
  episodeNumber: 1,
  title: 'E2E unsloth เซรั่มวิตซี',
  status: 'draft',
  resolution: '720p',
  imageConfigId: 2, // dummy openai (ไม่ถูกเรียก — keyframe seed เป็น completed แล้ว)
  videoConfigId: 1, // unsloth
  createdAt: ts,
  updatedAt: ts,
}).run()
const episodeId = getInsertId(episodeRes)

const projectRes = db.insert(schema.studioProjects).values({
  title: 'E2E unsloth เซรั่มวิตซี',
  productName: 'เซรั่มวิตซี NAKA',
  productDescription: 'เซรั่มบำรุงผิวหน้าสำหรับทดสอบระบบ',
  templateId: 'lifestyle_showcase',
  language: 'th',
  market: 'TH',
  platform: 'tiktok',
  aspectRatio: '9:16',
  durationSec: 11,
  aiDisclosure: true,
  captions: false, // โฟกัสที่ adapter วิดีโอ — ไม่ดึงเรื่องฟอนต์ไทยของ libass เข้ามาเทส
  status: 'script_ready',
  dramaId,
  episodeId,
  createdAt: ts,
  updatedAt: ts,
}).run()
const projectId = getInsertId(projectRes)

const shots = [
  {
    storyboardNumber: 1,
    role: 'scene1',
    description: 'มือถือถ่ายจริงในห้องนอนแสงธรรมชาติ หญิงไทยยกเซรั่มขึ้นโชว์ใกล้เลนส์แล้วยิ้ม',
    duration: 5,
    firstFrame: 'static/images/kf-hook.png',
    videoPrompt: 'UGC smartphone selfie video, Thai woman holds a small serum bottle close to the camera, smiles naturally, bright bedroom daylight. She speaks Thai: "เซรั่มตัวนี้ดีจริงค่ะ ผิวใสขึ้นเยอะเลย". Natural handheld movement, vertical video.',
    dialogue: 'เซรั่มตัวนี้ดีจริงค่ะ ผิวใสขึ้นเยอะเลย',
  },
  {
    storyboardNumber: 2,
    role: 'packshot',
    description: 'แพ็คเกจเซรั่มวางบนโต๊ะไม้ กล้องค่อย ๆ เข้าใกล้ แสงนุ่ม มีป้าย flash sale เบลอ ๆ หลัง',
    duration: 6,
    firstFrame: 'static/images/kf-pack.png',
    videoPrompt: 'Product packshot video: a serum bottle on a wooden table, camera slowly pushes in, soft warm lighting, blurred Thai flash-sale sign in the background. A calm female voice says in Thai: "ลด 50% วันนี้เท่านั้นค่ะ". Clean commercial look, vertical video.',
    dialogue: 'ลด 50% วันนี้เท่านั้นค่ะ',
  },
]

for (const shot of shots) {
  const sbRes = db.insert(schema.storyboards).values({
    episodeId,
    storyboardNumber: shot.storyboardNumber,
    title: shot.role,
    description: shot.description,
    duration: shot.duration,
    imagePrompt: `keyframe: ${shot.description}`,
    videoPrompt: shot.videoPrompt,
    firstFrameImage: shot.firstFrame,
    status: 'pending',
    createdAt: ts,
    updatedAt: ts,
  }).run()
  const storyboardId = getInsertId(sbRes)

  db.insert(schema.studioShots).values({
    storyboardId,
    projectId,
    role: shot.role,
    dialogue: shot.dialogue,
    onScreenText: null,
  }).run()

  // keyframe ถือว่าเสร็จแล้ว (seed ไฟล์ลง static ก่อนหน้า) — auto-render จะข้าม stage keyframes
  const imageTaskRes = db.insert(schema.sysTask).values({
    type: 'image',
    storyboardId,
    dramaId,
    provider: 'openai',
    configId: 2,
    params: JSON.stringify({ frameType: 'first_frame' }),
    status: 'completed',
    localPath: shot.firstFrame,
    estimatedCostThb: 0,
    createdAt: ts,
    updatedAt: ts,
  }).run()
  const imageTaskId = getInsertId(imageTaskRes)

  // readiness ของ video: candidate slot ต้องถูก "เลือก" ผ่าน storyboard_media_selections
  db.insert(schema.storyboardMediaSelections).values({
    storyboardId,
    slot: 'first_frame',
    taskId: imageTaskId,
    selectedAt: ts,
  }).run()

  console.log(`shot ${shot.storyboardNumber}: storyboard=${storyboardId}`)
}

console.log(`project=${projectId} drama=${dramaId} episode=${episodeId}`)
process.exit(0)
