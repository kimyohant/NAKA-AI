const { execFileSync } = require('child_process')
const ffprobe = require('C:/Users/natta/huobao-drama/backend/node_modules/ffprobe-static/path')
for (const f of [
  'C:/Users/natta/huobao-drama/data/static/merged/45e84eec-9362-4023-9fe5-2d8ebad3d475.mp4',
  'C:/Users/natta/huobao-drama/data/static/videos/44000370-68fd-4244-8815-ce2b8d1e9db0.mp4',
]) {
  try {
    const out = execFileSync(ffprobe, ['-v', 'quiet', '-show_entries', 'format=duration,size:stream=codec_name,width,height', '-of', 'json', f]).toString()
    const j = JSON.parse(out)
    const v = (j.streams || []).find(s => s.codec_type === 'video') || {}
    console.log(f.split('/').pop(), '→', Math.round(j.format.duration) + 's,', Math.round(j.format.size / 1024) + 'KB,', v.codec_name, v.width + 'x' + v.height)
  } catch (e) { console.log(f.split('/').pop(), 'ERR', String(e).slice(0, 80)) }
}
