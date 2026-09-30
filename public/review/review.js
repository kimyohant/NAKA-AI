// Affiliate review page: send the brief (text only) to the queue, poll until the script and
// voiceover are ready, then render the clip in this browser from the photos on this device.
(function () {
  'use strict';

  const MAX_IMAGES = 6;
  const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
  const POLL_MS = 3000;
  const demo = new URLSearchParams(location.search).get('demo') === '1';

  const $ = (id) => document.getElementById(id);
  const form = $('review-form');
  const fileInput = $('review-images');
  const panel = $('review-panel');
  const status = $('panel-status');
  const errorBox = $('form-error');

  let photos = []; // { file, url }
  let result = null; // { script, audio }
  let pollTimer = null;
  let videoUrl = null;

  $('year').textContent = new Date().getFullYear();
  if (demo) $('demo-note').hidden = false;
  const prefilledName = new URLSearchParams(location.search).get('name');
  if (prefilledName) $('review-name').value = prefilledName.slice(0, 160);
  const savedJobId = !demo && new URLSearchParams(location.search).get('job');
  if (savedJobId) {
    showWorking('กำลังตรวจสถานะงานเดิม…');
    poll(savedJobId, true);
  }

  function show(el, visible) { el.hidden = !visible; }
  function setError(message) { errorBox.textContent = message || ''; }

  fileInput.addEventListener('change', () => {
    setError('');
    const files = Array.from(fileInput.files || []);
    const rejected = files.filter((f) => !/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > MAX_IMAGE_BYTES);
    if (rejected.length) setError('ใช้ได้เฉพาะรูป JPG, PNG หรือ WebP ขนาดไม่เกิน 15 MB');
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    photos = files.filter((f) => !rejected.includes(f)).slice(0, MAX_IMAGES).map((file) => ({ file, url: URL.createObjectURL(file) }));
    if (files.length > MAX_IMAGES) setError(`ใช้ได้สูงสุด ${MAX_IMAGES} รูป นาคาเลือก ${MAX_IMAGES} รูปแรกให้`);
    const list = $('thumbs');
    list.replaceChildren(...photos.map((p, i) => {
      const li = document.createElement('li');
      const img = document.createElement('img');
      img.src = p.url;
      img.alt = `รูปสินค้าที่ ${i + 1}`;
      const tag = document.createElement('span');
      tag.textContent = i + 1;
      li.append(img, tag);
      return li;
    }));
  });

  function readBrief() {
    const data = Object.fromEntries(new FormData(form));
    const brief = {
      productName: String(data.productName || '').trim(),
      details: String(data.details || '').trim(),
      price: String(data.price || '').trim() || undefined,
      affiliateUrl: String(data.affiliateUrl || '').trim() || undefined,
      channel: data.channel,
      tone: data.tone,
      imageCount: photos.length,
    };
    if (!photos.length && !demo) return { error: 'กรุณาเลือกรูปสินค้าอย่างน้อย 1 รูป' };
    if (!brief.productName || !brief.details) return { error: 'กรุณากรอกชื่อสินค้าและจุดเด่นจริงของสินค้า' };
    if (brief.affiliateUrl && !/^https:\/\//i.test(brief.affiliateUrl)) return { error: 'ลิงก์ affiliate ต้องขึ้นต้นด้วย https://' };
    if (demo && !photos.length) brief.imageCount = 2;
    return { brief };
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setError('');
    const { brief, error } = readBrief();
    if (error) return setError(error);
    $('review-submit').disabled = true;
    try {
      if (demo) {
        showWorking('โหมดทดลอง: ใช้บทตัวอย่าง');
        showReady(demoResult(brief));
        return;
      }
      const response = await fetch('/api/affiliate/reviews', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(brief),
      });
      if (response.status === 401) {
        location.href = '/login/?next=/review/';
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || (response.status === 404 ? 'ระบบคลิปรีวิวยังไม่เปิดให้ใช้งาน' : 'ส่งงานไม่สำเร็จ ลองอีกครั้ง'));
      const currentUrl = new URL(location.href);
      currentUrl.searchParams.set('job', body.jobId);
      history.replaceState(null, '', currentUrl.pathname + currentUrl.search + currentUrl.hash);
      showWorking('ส่งงานให้นาคาแล้ว');
      poll(body.jobId);
    } catch (err) {
      setError(err.message || 'ส่งงานไม่สำเร็จ ลองอีกครั้ง');
      $('review-submit').disabled = false;
    }
  });

  function showWorking(message) {
    show(form, false);
    show(panel, true);
    status.textContent = message;
  }

  function poll(jobId, immediate = false) {
    clearTimeout(pollTimer);
    const check = async () => {
      try {
        const response = await fetch(`/api/affiliate/reviews/${encodeURIComponent(jobId)}`, { credentials: 'same-origin' });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'ตรวจสถานะงานไม่สำเร็จ');
        if (body.status === 'done') return showReady(body.result);
        if (body.status === 'failed') return fail(body.error);
        status.textContent = body.status === 'running'
          ? 'นาคากำลังเขียนบทและพากย์เสียง…'
          : body.ahead > 0 ? `รอคิว มี ${body.ahead} งานก่อนหน้า` : 'รอคิว นาคาจะเริ่มในไม่ช้า';
      } catch (err) {
        status.textContent = `${err.message} กำลังลองใหม่…`;
      }
      poll(jobId);
    };
    if (immediate) void check();
    else pollTimer = setTimeout(check, POLL_MS);
  }

  function fail(message) {
    status.textContent = message || 'นาคาสร้างคลิปไม่สำเร็จ ลองใหม่อีกครั้งได้เลย';
    show($('start-over'), true);
  }

  function showReady(output) {
    result = output;
    status.textContent = 'บทและเสียงพากย์พร้อมแล้ว ตรวจบทก่อน แล้วกดสร้างวิดีโอ';
    const list = $('scene-list');
    list.replaceChildren(...output.script.scenes.map((scene) => {
      const li = document.createElement('li');
      const text = document.createElement('b');
      text.textContent = scene.onScreenText;
      li.append(text, ` — ${scene.voiceover}`);
      return li;
    }));
    show(list, true);
    show($('render-button'), true);
    show($('render-hint'), true);
    $('caption-text').value = [output.script.postCaption, output.script.hashtags.join(' ')].filter(Boolean).join('\n\n');
    show($('caption-field'), true);
    show($('start-over'), true);
  }

  async function loadImages() {
    if (photos.length) return Promise.all(photos.map((p) => createImageBitmap(p.file)));
    // Demo without uploads: the site's own sample photos.
    return Promise.all(['/assets/soap-campaign.png', '/assets/naka-plush-sales.png'].map(async (src) => {
      const blob = await (await fetch(src)).blob();
      return createImageBitmap(blob);
    }));
  }

  $('render-button').addEventListener('click', async () => {
    if (!window.NakaReviewRender.pickMimeType()) {
      return setError('เบราว์เซอร์นี้สร้างวิดีโอไม่ได้ ลองใช้ Chrome, Edge หรือ Safari รุ่นใหม่');
    }
    setError('');
    const button = $('render-button');
    button.disabled = true;
    show($('progress'), true);
    show($('render-preview'), true);
    show($('result'), false);
    status.textContent = 'กำลังสร้างวิดีโอ…';
    try {
      const images = await loadImages();
      const { blob, mimeType } = await window.NakaReviewRender.renderReview({
        images, script: result.script, audio: result.audio.map((a) => a.base64 ?? a), preview: $('render-preview'),
        onProgress: (f) => { $('progress-bar').style.width = `${Math.round(f * 100)}%`; },
      });
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      videoUrl = URL.createObjectURL(blob);
      $('result-video').src = videoUrl;
      const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
      const link = $('download-link');
      link.href = videoUrl;
      link.download = `naka-review.${ext}`;
      show($('result'), true);
      status.textContent = ext === 'mp4'
        ? 'คลิปพร้อมแล้ว ตรวจก่อนโพสต์นะ'
        : 'คลิปพร้อมแล้ว (ไฟล์ WebM) ถ้าแพลตฟอร์มไม่รับไฟล์นี้ ลองสร้างใหม่ใน Chrome หรือ Safari รุ่นล่าสุดซึ่งบันทึกเป็น MP4 ได้';
    } catch (err) {
      console.error(err);
      setError('สร้างวิดีโอไม่สำเร็จ ลองอีกครั้ง หรือเปลี่ยนเบราว์เซอร์');
    } finally {
      button.disabled = false;
      show($('progress'), false);
      show($('render-preview'), false);
      $('render-preview').replaceChildren();
    }
  });

  $('copy-caption').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('caption-text').value);
      $('copy-caption').textContent = 'คัดลอกแล้ว ✓';
    } catch {
      $('caption-text').select();
      $('copy-caption').textContent = 'กด Ctrl+C เพื่อคัดลอก';
    }
  });

  $('start-over').addEventListener('click', () => {
    clearTimeout(pollTimer);
    result = null;
    for (const id of ['scene-list', 'render-button', 'render-hint', 'result', 'caption-field', 'start-over', 'progress', 'render-preview']) show($(id), false);
    show(panel, false);
    show(form, true);
    $('review-submit').disabled = false;
    setError('');
  });

  /** Demo mode: a fixed script and quiet tones sized like spoken lines, so rendering can be tried for free. */
  function demoResult(brief) {
    const scenes = [
      { voiceover: `ใครกำลังหา${brief.productName}อยู่ ดูอันนี้ก่อน`, onScreenText: 'ของมันต้องมี', imageIndex: 0, motion: 'zoom_in' },
      { voiceover: brief.details.slice(0, 120), onScreenText: 'จุดเด่นจริง', imageIndex: 1 % brief.imageCount, motion: 'pan_left' },
      { voiceover: brief.price ? `ราคา ${brief.price}` : 'รายละเอียดครบในโพสต์', onScreenText: brief.price || 'ดูรายละเอียด', imageIndex: 0, motion: 'zoom_out' },
      { voiceover: 'สนใจกดลิงก์ในโพสต์ได้เลย', onScreenText: 'ลิงก์ในโพสต์', imageIndex: 1 % brief.imageCount, motion: 'pan_right' },
    ];
    return {
      script: {
        hook: brief.productName.slice(0, 40), scenes,
        postCaption: `${brief.productName}\n${brief.details}${brief.affiliateUrl ? `\n\n🛒 ${brief.affiliateUrl}` : ''}`,
        hashtags: ['#รีวิว', '#ของดีบอกต่อ'],
      },
      audio: scenes.map((s) => toneWav(Math.min(6, 1.2 + s.voiceover.length * 0.06))),
    };
  }

  function toneWav(seconds) {
    const rate = 22050;
    const n = Math.floor(seconds * rate);
    const buffer = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buffer);
    const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const env = Math.min(1, i / 2000, (n - i) / 2000);
      v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 330 * i / rate) * 2500 * env, true);
    }
    return buffer;
  }
})();
