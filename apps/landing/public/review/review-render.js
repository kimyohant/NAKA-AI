// Renders an affiliate review clip in the browser: product photos with camera motion,
// on-screen text and the Thai voiceover, recorded to a 9:16 video with MediaRecorder.
// Recording runs in real time, so a 30-second clip takes about 30 seconds.
(function () {
  'use strict';

  const WIDTH = 1080;
  const HEIGHT = 1920;
  const FPS = 30;
  const SCENE_GAP = 0.35; // seconds of breathing room after each line
  const TAIL = 0.8; // hold the last frame after the voiceover ends
  const FADE = 0.3;
  const FONT = '"IBM Plex Sans Thai", "Anuphan", sans-serif';

  const MIME_TYPES = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];

  function pickMimeType() {
    if (typeof MediaRecorder === 'undefined') return null;
    return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || null;
  }

  function base64ToBuffer(base64) {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return bytes.buffer;
  }

  /** Thai has no spaces between words, so break on word segments, not spaces. */
  function wrapText(ctx, text, maxWidth) {
    const pieces = typeof Intl !== 'undefined' && Intl.Segmenter
      ? Array.from(new Intl.Segmenter('th', { granularity: 'word' }).segment(text), (s) => s.segment)
      : Array.from(text);
    const lines = [];
    let line = '';
    for (const piece of pieces) {
      const next = line + piece;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line.trim());
        line = piece.trimStart();
      } else {
        line = next;
      }
    }
    if (line.trim()) lines.push(line.trim());
    return lines;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCover(ctx, img, w, h) {
    const scale = Math.max(w / img.width, h / img.height) * 1.15;
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  /** Ken Burns motion on the product photo inside a rounded frame. */
  function drawProduct(ctx, img, motion, p) {
    const frame = { x: 60, y: 300, w: WIDTH - 120, h: 1180 };
    const ease = p * p * (3 - 2 * p);
    let zoom = 1.08;
    let shift = 0;
    if (motion === 'zoom_in') zoom = 1 + 0.14 * ease;
    if (motion === 'zoom_out') zoom = 1.14 - 0.14 * ease;
    if (motion === 'pan_left') shift = 0.05 - 0.1 * ease;
    if (motion === 'pan_right') shift = -0.05 + 0.1 * ease;

    const fit = Math.min(frame.w / img.width, frame.h / img.height) * zoom;
    const dw = img.width * fit;
    const dh = img.height * fit;
    ctx.save();
    roundRect(ctx, frame.x, frame.y, frame.w, frame.h, 48);
    ctx.fillStyle = 'rgba(8, 20, 46, 0.35)';
    ctx.fill();
    ctx.clip();
    ctx.drawImage(img, frame.x + (frame.w - dw) / 2 + shift * frame.w, frame.y + (frame.h - dh) / 2, dw, dh);
    ctx.restore();
  }

  function drawCaption(ctx, text, centerY, size, style) {
    ctx.font = `700 ${size}px ${FONT}`;
    const lines = wrapText(ctx, text, WIDTH - 200);
    const lineHeight = size * 1.35;
    const boxH = lines.length * lineHeight + size * 0.7;
    const boxW = Math.min(WIDTH - 120, Math.max(...lines.map((l) => ctx.measureText(l).width)) + size * 1.4);
    const top = centerY - boxH / 2;
    roundRect(ctx, (WIDTH - boxW) / 2, top, boxW, boxH, size * 0.45);
    ctx.fillStyle = style === 'hook' ? '#eaf3ff' : 'rgba(9, 23, 54, 0.86)';
    ctx.fill();
    ctx.fillStyle = style === 'hook' ? '#102655' : '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((line, i) => ctx.fillText(line, WIDTH / 2, top + size * 0.35 + lineHeight * (i + 0.5)));
  }

  function drawFrame(ctx, t, plan) {
    let index = plan.scenes.findIndex((s) => t < s.start + s.duration);
    if (index === -1) index = plan.scenes.length - 1;
    const scene = plan.scenes[index];
    const img = plan.images[scene.imageIndex] || plan.images[0];
    const p = Math.min(1, Math.max(0, (t - scene.start) / scene.duration));

    ctx.globalAlpha = 1;
    ctx.fillStyle = '#091736';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.save();
    ctx.filter = 'blur(40px) brightness(0.55)';
    drawCover(ctx, img, WIDTH, HEIGHT);
    ctx.restore();

    const fadeIn = index === 0 ? 1 : Math.min(1, (t - scene.start) / FADE);
    ctx.globalAlpha = fadeIn;
    drawProduct(ctx, img, scene.motion, p);
    ctx.globalAlpha = 1;

    if (index === 0) drawCaption(ctx, plan.hook, 170, 76, 'hook');
    drawCaption(ctx, scene.onScreenText, 1650, 64, 'caption');

    // Progress bar so viewers know the clip is short.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.fillRect(0, 0, WIDTH, 10);
    ctx.fillStyle = '#8cdbfa';
    ctx.fillRect(0, 0, WIDTH * Math.min(1, t / plan.total), 10);
  }

  /**
   * Frame clock. requestAnimationFrame stops in a hidden tab, which would freeze the recording
   * if the seller switches tabs; a worker's timer keeps running, so prefer it.
   */
  function startTicker(fps) {
    const ticker = { onTick: null, stop: null };
    const fire = () => { if (ticker.onTick) ticker.onTick(); };
    try {
      const source = `setInterval(() => postMessage(0), ${Math.round(1000 / fps)});`;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.onmessage = fire;
      ticker.stop = () => worker.terminate();
    } catch {
      let running = true;
      const loop = () => { if (!running) return; fire(); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
      ticker.stop = () => { running = false; };
    }
    return ticker;
  }

  /**
   * @param {object} job
   * @param {(HTMLImageElement|ImageBitmap)[]} job.images
   * @param {{hook: string, scenes: {onScreenText: string, imageIndex: number, motion: string}[]}} job.script
   * @param {(string|ArrayBuffer)[]} job.audio base64 MP3 per scene, or raw audio bytes
   * @param {(fraction: number) => void} [job.onProgress]
   * @param {HTMLElement} [job.preview] shows the canvas while it records
   * @returns {Promise<{blob: Blob, mimeType: string, duration: number}>}
   */
  async function renderReview({ images, script, audio, onProgress, preview }) {
    const mimeType = pickMimeType();
    if (!mimeType) throw new Error('unsupported');
    if (document.fonts && document.fonts.load) await document.fonts.load(`700 64px ${FONT}`).catch(() => {});

    const ac = new AudioContext();
    await ac.resume();
    const buffers = await Promise.all(audio.map((clip) => ac.decodeAudioData(typeof clip === 'string' ? base64ToBuffer(clip) : clip.slice(0))));

    let cursor = 0;
    const scenes = script.scenes.map((scene, i) => {
      const duration = buffers[i].duration + SCENE_GAP + (i === script.scenes.length - 1 ? TAIL : 0);
      const planned = { ...scene, start: cursor, duration, buffer: buffers[i] };
      cursor += duration;
      return planned;
    });
    const plan = { images, hook: script.hook, scenes, total: cursor };

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');
    drawFrame(ctx, 0, plan);
    if (preview) preview.replaceChildren(canvas);

    const destination = ac.createMediaStreamDestination();
    const stream = new MediaStream([
      ...canvas.captureStream(FPS).getVideoTracks(),
      ...destination.stream.getAudioTracks(),
    ]);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 128_000 });
    const chunks = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    const stopped = new Promise((resolve, reject) => {
      recorder.onstop = resolve;
      recorder.onerror = (event) => reject(event.error || new Error('recorder failed'));
    });

    const startAt = ac.currentTime + 0.15;
    for (const scene of scenes) {
      const source = ac.createBufferSource();
      source.buffer = scene.buffer;
      source.connect(destination);
      source.start(startAt + scene.start);
    }
    recorder.start(250);

    // The audio clock drives the picture, so frames stay in sync with the voice.
    const ticker = startTicker(FPS);
    await new Promise((resolve) => {
      ticker.onTick = () => {
        const t = Math.max(0, ac.currentTime - startAt);
        drawFrame(ctx, Math.min(t, plan.total), plan);
        if (onProgress) onProgress(Math.min(1, t / plan.total));
        if (t >= plan.total) resolve();
      };
    });
    ticker.stop();
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());
    await ac.close();

    return { blob: new Blob(chunks, { type: mimeType.split(';')[0] }), mimeType, duration: plan.total };
  }

  window.NakaReviewRender = { renderReview, pickMimeType, wrapText };
})();
