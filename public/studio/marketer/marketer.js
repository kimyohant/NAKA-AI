// AI marketer (studio 05): one composer, four starters, a task history and the Thai trending
// gallery. Every task is a queued job (1 credit, refunded on failure); clips are made by /review/.
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const ICONS = { chart: '📊', search: '🔎', doc: '📝', chat: '💬', video: '🎬', money: '💰', calendar: '📅' };
  const KIND_LABEL = { insight: '01 · วิเคราะห์การตลาด', bulk: '04 · สร้างโฆษณาหลายแบบ', recreate: '03 · ทำซ้ำคลิปไวรัล' };
  const STATUS_LABEL = { queued: 'อยู่ในคิว', running: 'กำลังทำ', done: 'เสร็จแล้ว', failed: 'ไม่สำเร็จ' };
  const REVIEW_CHANNELS = ['tiktok', 'facebook', 'instagram', 'shopee'];
  const DRAFT_KEY = 'naka_marketer_draft_v1';
  const POLL_MS = 3000;
  const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
  const FRAME_COUNT = 8;
  const MAX_FRAME_CHARS = 200000;

  let config = null;
  let signedIn = false;
  let composerTemplate = null; // template id the composer text came from
  let recreateSource = null; // { frames, seconds, previews } from an upload, or { trending } from the gallery
  let pollTimer = null;
  const taskContext = new Map(); // jobId → { productName, channel } for handoffs

  function el(tag, props, ...kids) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) node.append(kid instanceof Node ? kid : String(kid));
    return node;
  }
  function toast(message) {
    const box = $('#toast');
    box.textContent = message; box.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { box.hidden = true; }, 4200);
  }
  function setStatus(id, message, error) { const node = $(id); node.textContent = message || ''; node.classList.toggle('error', !!error); }
  const short = (n) => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(n);

  async function api(path, options) {
    const init = { credentials: 'same-origin', cache: 'no-store', ...(options || {}) };
    if (init.body !== undefined) { init.method = init.method || 'POST'; init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(init.body); }
    let response;
    try { response = await fetch(path, init); } catch { return { ok: false, status: 0, data: { error: 'เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่' } }; }
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  }

  // ---------- account ----------

  async function loadAccount() {
    const result = await api('/api/auth/me');
    signedIn = result.ok;
    $('#signin-link').hidden = signedIn;
    $('#credit-chip').hidden = !signedIn;
    if (signedIn) $('#credit-count').textContent = String(result.data.credits ?? 0);
    $('#tasks-section').hidden = !signedIn;
    if (signedIn) loadTasks();
  }
  function needSignIn() {
    if (signedIn) return false;
    saveDraft();
    toast('กรุณาเข้าสู่ระบบก่อน กำลังพาไปหน้าเข้าสู่ระบบ…');
    setTimeout(() => { location.href = '/login/?next=' + encodeURIComponent(location.pathname); }, 900);
    return true;
  }
  function saveDraft() {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ text: $('#composer-text').value, template: composerTemplate })); } catch { /* private mode */ }
  }
  function restoreDraft() {
    try {
      const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
      sessionStorage.removeItem(DRAFT_KEY);
      if (draft && typeof draft.text === 'string') { $('#composer-text').value = draft.text; setComposerTemplate(draft.template); }
    } catch { /* ignore */ }
  }
  function explainFailure(result) {
    if (result.status === 401) { signedIn = false; needSignIn(); return 'กรุณาเข้าสู่ระบบก่อน'; }
    if (result.status === 402) return 'เครดิตไม่พอ เติมเครดิตได้ที่หน้าแพ็กเกจ';
    return result.data.error || 'ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง';
  }

  // ---------- config, composer, chips ----------

  function fillSelect(select, entries, keep) {
    const first = keep ? [...select.options].slice(0, 1) : [];
    select.replaceChildren(...first, ...entries.map(([value, label]) => el('option', { value, text: label })));
  }

  function setComposerTemplate(id) {
    composerTemplate = id && config && config.templates.some((t) => t.id === id) ? id : null;
    const template = composerTemplate && config.templates.find((t) => t.id === composerTemplate);
    $('#composer-template').hidden = !template;
    $('#composer-template').textContent = template ? `แม่แบบ: ${template.title} · แก้ข้อความในวงเล็บ [ ] ให้ตรงกับร้านคุณ` : '';
    document.querySelectorAll('.chip').forEach((chip) => chip.classList.toggle('on', chip.dataset.template === composerTemplate));
  }

  function renderChips() {
    const groups = Object.entries(config.groups).map(([group, label]) => el('div', { class: 'chip-group' },
      el('p', { text: label }),
      el('div', {}, config.templates.filter((t) => t.group === group).map((t) => el('button', { type: 'button', class: 'chip', 'data-template': t.id,
        onclick: () => { $('#composer-text').value = t.prompt; setComposerTemplate(t.id); $('#composer-text').focus(); } },
      el('i', { 'aria-hidden': 'true', text: ICONS[t.icon] || '✨' }), t.title)))));
    $('#chip-groups').replaceChildren(...groups);
  }

  $('#composer-text').addEventListener('input', () => { if (!$('#composer-text').value.trim()) setComposerTemplate(null); });
  $('#composer').addEventListener('submit', async (event) => {
    event.preventDefault();
    const prompt = $('#composer-text').value.trim();
    if (!prompt) { setStatus('#composer-status', 'พิมพ์งานที่อยากให้นาคาทำก่อน', true); $('#composer-text').focus(); return; }
    if (needSignIn()) return;
    const button = $('#composer .mk-send');
    button.disabled = true; setStatus('#composer-status', 'กำลังส่งงาน…');
    const result = await api('/api/marketer/tasks/insight', { body: { templateId: composerTemplate, prompt,
      expert: $('#composer-expert').value, category: $('#composer-category').value || undefined } });
    button.disabled = false;
    if (!result.ok) { setStatus('#composer-status', explainFailure(result), true); return; }
    setStatus('#composer-status', '');
    $('#composer-text').value = ''; setComposerTemplate(null);
    startTask(result.data.jobId, 'insight', {});
  });

  // ---------- 01 insight ----------

  function shuffleTemplates() {
    const picks = [...config.templates].sort(() => Math.random() - 0.5).slice(0, 6);
    $('#suggest-grid').replaceChildren(...picks.map((t) => el('button', { type: 'button', 'aria-pressed': 'false', 'data-template': t.id,
      onclick: (event) => {
        $('#insight-prompt').value = t.prompt;
        $('#insight-form').dataset.template = t.id;
        $('#suggest-grid').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === event.currentTarget)));
        $('#insight-prompt').focus();
      } }, el('i', { 'aria-hidden': 'true', text: ICONS[t.icon] || '✨' }), t.title)));
  }
  $('#shuffle-templates').addEventListener('click', shuffleTemplates);
  $('#insight-prompt').addEventListener('input', () => { if (!$('#insight-prompt').value.trim()) delete $('#insight-form').dataset.template; });
  $('#insight-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const prompt = $('#insight-prompt').value.trim();
    if (!prompt) { $('#insight-error').textContent = 'เลือกหัวข้อหรือพิมพ์สิ่งที่อยากรู้ก่อน'; return; }
    if (needSignIn()) return;
    await submitTask('insight', { templateId: $('#insight-form').dataset.template || null, prompt, expert: $('#insight-expert').value,
      category: $('#insight-category').value || undefined, productName: $('#insight-product').value.trim() || undefined },
    '#insight-form', '#insight-error', '#insight-dialog', { productName: $('#insight-product').value.trim() });
  });

  async function submitTask(kind, body, formSel, errorSel, dialogSel, context) {
    const button = $(formSel).querySelector('.mk-primary');
    $(errorSel).textContent = '';
    button.disabled = true;
    const result = await api(`/api/marketer/tasks/${kind}`, { body });
    button.disabled = false;
    if (!result.ok) { $(errorSel).textContent = explainFailure(result); return false; }
    $(dialogSel).close();
    startTask(result.data.jobId, kind, context);
    return true;
  }

  // ---------- 02 URL → video ----------

  $('#url-fetch').addEventListener('submit', async (event) => {
    event.preventDefault();
    const url = $('#url-input').value.trim();
    if (!/^https:\/\//i.test(url)) { setStatus('#url-status', 'วางลิงก์ที่ขึ้นต้นด้วย https://', true); return; }
    if (needSignIn()) return;
    $('#url-fetch-button').disabled = true; setStatus('#url-status', 'กำลังอ่านหน้าสินค้า…');
    const result = await api('/api/marketer/product', { body: { url } });
    $('#url-fetch-button').disabled = false;
    const product = result.ok ? result.data : { url, productName: '', description: '', price: '', images: [] };
    setStatus('#url-status', result.ok ? `อ่านจาก ${product.site} แล้ว ตรวจและแก้ข้อมูลก่อนสร้างคลิป` : `${explainFailure(result)} · กรอกข้อมูลเองด้านล่างได้`, !result.ok);
    $('#url-name').value = product.productName || '';
    $('#url-price').value = product.price || '';
    $('#url-details').value = product.description || '';
    $('#url-link').value = product.url || url;
    $('#url-images').replaceChildren(...product.images.map((src, i) => el('label', { title: `รูปที่ ${i + 1}` },
      el('input', { type: 'checkbox', checked: true, value: src, 'aria-label': `ใช้รูปที่ ${i + 1}` }),
      el('img', { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }))));
    $('#url-form').hidden = false;
  });
  $('#url-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = $('#url-name').value.trim();
    const facts = [$('#url-selling').value.trim() && `จุดขายหลัก: ${$('#url-selling').value.trim()}`,
      $('#url-audience').value.trim() && `กลุ่มลูกค้า: ${$('#url-audience').value.trim()}`, $('#url-details').value.trim()].filter(Boolean).join('\n');
    if (!name || !facts) { $('#url-error').textContent = 'กรุณากรอกชื่อสินค้าและจุดเด่นของสินค้า'; return; }
    const link = $('#url-link').value.trim();
    if (link && !/^https:\/\//i.test(link)) { $('#url-error').textContent = 'ลิงก์ในแคปชันต้องขึ้นต้นด้วย https://'; return; }
    toReview({ productName: name, details: facts, price: $('#url-price').value.trim(), affiliateUrl: link,
      channel: $('#url-channel').value, tone: $('#url-tone').value,
      images: [...$('#url-images').querySelectorAll('input:checked')].map((input) => input.value) });
  });

  function toReview(data) {
    const handoff = { ...data, productName: (data.productName || '').slice(0, 160), details: (data.details || '').slice(0, 3000),
      channel: REVIEW_CHANNELS.includes(data.channel) ? data.channel : 'tiktok' };
    try { sessionStorage.setItem('naka_review_handoff', JSON.stringify(handoff)); } catch { /* the page still opens with the name */ }
    location.href = '/review/?name=' + encodeURIComponent(handoff.productName);
  }

  // ---------- 03 recreate ----------

  function waitFor(node, event) { return new Promise((resolve, reject) => { node.addEventListener(event, resolve, { once: true }); node.addEventListener('error', () => reject(new Error('อ่านคลิปนี้ไม่ได้ ลองไฟล์ MP4')), { once: true }); }); }

  /** Eight evenly spaced stills, scaled to 512 px, as JPEG base64. The video never leaves the device. */
  async function extractFrames(file) {
    const url = URL.createObjectURL(file);
    const video = el('video', { muted: true, playsinline: true, preload: 'auto' });
    video.muted = true; video.src = url;
    try {
      await waitFor(video, 'loadedmetadata');
      const seconds = video.duration;
      if (!Number.isFinite(seconds) || seconds < 2 || seconds > 90) throw new Error('คลิปต้องยาว 2–90 วินาที');
      const scale = Math.min(1, 512 / Math.max(video.videoWidth, video.videoHeight));
      const canvas = el('canvas', { width: Math.round(video.videoWidth * scale), height: Math.round(video.videoHeight * scale) });
      const ctx = canvas.getContext('2d');
      const frames = [], previews = [];
      for (let i = 0; i < FRAME_COUNT; i++) {
        video.currentTime = Math.min(seconds - 0.05, ((i + 0.5) * seconds) / FRAME_COUNT);
        await waitFor(video, 'seeked');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        let quality = 0.72, dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length - dataUrl.indexOf(',') - 1 > MAX_FRAME_CHARS && quality > 0.3) { quality -= 0.12; dataUrl = canvas.toDataURL('image/jpeg', quality); }
        previews.push(dataUrl); frames.push(dataUrl.slice(dataUrl.indexOf(',') + 1));
      }
      return { frames, previews, seconds: Math.round(seconds) };
    } finally { URL.revokeObjectURL(url); }
  }

  $('#recreate-video').addEventListener('change', async () => {
    const file = $('#recreate-video').files[0];
    $('#recreate-error').textContent = '';
    $('#frame-strip').replaceChildren();
    recreateSource = null;
    if (!file) return;
    if (file.size > MAX_VIDEO_BYTES) { $('#recreate-error').textContent = 'คลิปต้องไม่เกิน 50 MB'; return; }
    $('#frame-strip').replaceChildren(el('small', { text: 'กำลังแยกภาพจากคลิป…' }));
    try {
      recreateSource = await extractFrames(file);
      $('#frame-strip').replaceChildren(...recreateSource.previews.map((src, i) => el('img', { src, alt: `ภาพที่ ${i + 1} จากคลิป` })));
    } catch (error) { $('#frame-strip').replaceChildren(); $('#recreate-error').textContent = error.message; }
  });

  function openRecreate(video) {
    recreateSource = video ? { trending: video } : null;
    $('#recreate-video').value = ''; $('#frame-strip').replaceChildren();
    $('#source-upload').hidden = !!video;
    $('#source-picked').hidden = !video;
    if (video) {
      $('#recreate-caption').value = video.title || '';
      $('#source-picked').replaceChildren(
        video.thumbnail ? el('img', { src: video.thumbnail, alt: '', referrerpolicy: 'no-referrer' }) : el('span', { class: 'tv-blank', text: '▶' }),
        el('span', {}, el('strong', { text: 'คลิปต้นแบบจากคลิปมาแรง' }), el('br'), `${short(video.views)} วิว` + (video.revenue !== null ? ` · ยอดขาย ฿${short(video.revenue)}` : ''),
          el('br'), el('small', { text: 'วิเคราะห์จากแคปชันและตัวเลข · อัปโหลดคลิปจะแยกช็อตได้แม่นกว่า' })),
        el('button', { type: 'button', class: 'text-button', text: 'อัปโหลดคลิปแทน', onclick: () => openRecreate(null) }));
    }
    if (!$('#recreate-dialog').open) $('#recreate-dialog').showModal();
  }

  $('#recreate-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const productName = $('#recreate-product').value.trim();
    const newContent = $('#recreate-new').value.trim();
    const caption = $('#recreate-caption').value.trim();
    if (!recreateSource && !caption) { $('#recreate-error').textContent = 'เลือกคลิปต้นแบบ หรือวางแคปชันของคลิปไวรัล'; return; }
    if (!productName || !newContent) { $('#recreate-error').textContent = 'กรอกชื่อสินค้าและสิ่งที่อยากให้คลิปใหม่แสดง'; return; }
    if (needSignIn()) return;
    const source = recreateSource || {};
    const channel = $('#recreate-channel').value;
    await submitTask('recreate', { mode: new FormData($('#recreate-form')).get('mode'), frames: source.frames || [], seconds: source.seconds,
      trendingId: source.trending ? source.trending.id : undefined, sourceUrl: source.trending ? source.trending.url : undefined,
      caption, productName, productDetails: $('#recreate-details').value.trim(), newContent, channel },
    '#recreate-form', '#recreate-error', '#recreate-dialog', { productName, channel, details: $('#recreate-details').value.trim() });
  });

  // ---------- 04 bulk ----------

  let bulkCount = 4;
  const setCount = (n) => { bulkCount = Math.min(10, Math.max(1, n)); $('#bulk-count').textContent = String(bulkCount); };
  $('#bulk-minus').addEventListener('click', () => setCount(bulkCount - 1));
  $('#bulk-plus').addEventListener('click', () => setCount(bulkCount + 1));
  $('#bulk-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const productName = $('#bulk-product').value.trim();
    const brief = $('#bulk-brief').value.trim();
    if (!productName || !brief) { $('#bulk-error').textContent = 'กรอกชื่อสินค้าและบรีฟ'; return; }
    if (needSignIn()) return;
    const channel = $('#bulk-channel').value;
    await submitTask('bulk', { productName, brief, channel, tone: $('#bulk-tone').value,
      duration: Number(new FormData($('#bulk-form')).get('duration')), count: bulkCount },
    '#bulk-form', '#bulk-error', '#bulk-dialog', { productName, channel, tone: $('#bulk-tone').value });
  });

  // ---------- tasks and results ----------

  async function loadTasks() {
    const result = await api('/api/marketer/tasks');
    if (!result.ok) return;
    const list = result.data.tasks;
    $('#task-list').replaceChildren(...(list.length ? list.map((task) => el('li', {}, el('button', { type: 'button', onclick: () => startTask(task.id, task.kind, null, task.title) },
      el('span', { class: 'line-no', text: KIND_LABEL[task.kind].slice(0, 2) }),
      el('span', {}, el('strong', { text: task.title }), el('small', { text: new Date(task.createdAt.replace(' ', 'T') + 'Z').toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) })),
      el('span', { class: `badge ${task.status}`, text: STATUS_LABEL[task.status] }))))
      : [el('li', { class: 'trending-empty', text: 'ยังไม่มีงาน ลองเริ่มจากการ์ดด้านบน' })]));
  }
  $('#refresh-tasks').addEventListener('click', loadTasks);

  function startTask(jobId, kind, context, title) {
    if (context) taskContext.set(jobId, context);
    $('#result-kind').textContent = KIND_LABEL[kind] || '';
    $('#result-title').textContent = title || 'กำลังทำงาน';
    $('#result-body').replaceChildren(el('div', { class: 'result-loading' }, el('div', { class: 'loading-ring' }), el('p', { id: 'result-wait', text: 'ส่งงานแล้ว นาคากำลังเริ่ม…' })));
    if (!$('#result-dialog').open) $('#result-dialog').showModal();
    clearTimeout(pollTimer);
    poll(jobId, kind);
    if (signedIn) { loadTasks(); loadAccount(); }
  }

  async function poll(jobId, kind) {
    if (!$('#result-dialog').open) return;
    const result = await api(`/api/marketer/tasks/${jobId}`);
    if (!result.ok) { $('#result-body').replaceChildren(el('p', { class: 'field-error', text: explainFailure(result) })); return; }
    const task = result.data;
    if (task.status === 'done') { renderResult(jobId, task.kind, task.output, task.productName); loadTasks(); return; }
    if (task.status === 'failed') {
      $('#result-title').textContent = 'งานนี้ไม่สำเร็จ';
      $('#result-body').replaceChildren(el('p', { class: 'field-error', text: task.error }));
      loadTasks(); loadAccount(); return;
    }
    const wait = $('#result-wait');
    if (wait) wait.textContent = task.status === 'running' ? 'นาคากำลังคิดและเขียน ใช้เวลาราว 30–90 วินาที…' : `อยู่ในคิว${task.ahead ? ` (ก่อนหน้า ${task.ahead} งาน)` : ''}…`;
    pollTimer = setTimeout(() => poll(jobId, kind), POLL_MS);
  }
  $('#result-dialog').addEventListener('close', () => clearTimeout(pollTimer));

  function copyButton(getText) {
    return el('button', { type: 'button', class: 'button secondary', text: 'คัดลอก', onclick: async (event) => {
      try { await navigator.clipboard.writeText(getText()); event.currentTarget.textContent = 'คัดลอกแล้ว ✓'; } catch { toast('คัดลอกไม่สำเร็จ'); }
    } });
  }
  function shotsTable(shots) {
    return el('table', { class: 'shots' }, el('thead', {}, el('tr', {}, ['เวลา', 'ช็อต / ภาพ', 'ข้อความบนจอ', 'บทพูด'].map((h) => el('th', { text: h })))),
      el('tbody', {}, (shots || []).map((s) => el('tr', {}, el('td', { text: s.time }), el('td', {}, el('strong', { text: s.shot }), el('br'), s.visual),
        el('td', { text: s.onScreenText }), el('td', { text: s.voiceover })))));
  }
  const shotsText = (shots) => (shots || []).map((s) => `[${s.time}] ${s.shot} — ${s.visual}${s.onScreenText ? ` | จอ: ${s.onScreenText}` : ''}${s.voiceover ? ` | พูด: ${s.voiceover}` : ''}`).join('\n');

  function renderResult(jobId, kind, output, productName) {
    const ctx = { ...(taskContext.get(jobId) || {}), productName: (taskContext.get(jobId) || {}).productName || productName || '' };
    const body = $('#result-body');
    if (kind === 'insight') {
      $('#result-title').textContent = output.title;
      const text = () => [output.title, output.summary, ...output.sections.map((s) => `\n${s.heading}\n${s.points.map((p) => `- ${p}`).join('\n')}`),
        '\nสิ่งที่ควรทำ', ...output.actions.map((a, i) => `${i + 1}. ${a.title} (${a.when}) — ${a.detail}`)].join('\n');
      body.replaceChildren(el('article', { class: 'report' },
        el('p', { class: 'summary', text: output.summary }),
        output.sections.map((s) => [el('h3', { text: s.heading }), el('ul', {}, s.points.map((p) => el('li', { text: p })))]),
        el('h3', { text: 'สิ่งที่ควรทำต่อ' }),
        el('ol', { class: 'actions-list' }, output.actions.map((a) => el('li', {}, el('strong', {}, a.title, el('span', { class: 'when', text: a.when })), a.detail))),
        output.caveats.length ? el('p', { class: 'caveats', text: 'ข้อควรระวัง: ' + output.caveats.join(' · ') }) : null,
        el('div', { class: 'result-actions' }, copyButton(text))));
      return;
    }
    if (kind === 'bulk') {
      $('#result-title').textContent = `${output.plans.length} แผนโฆษณา${ctx.productName ? ` · ${ctx.productName}` : ''}`;
      body.replaceChildren(...output.plans.map((plan, i) => el('section', { class: 'plan-card' },
        el('header', {}, el('h3', { text: `${i + 1}. ${plan.angle}` }), el('small', { text: plan.audience })),
        el('p', { class: 'hook', text: `ฮุก: ${plan.hook}` }), shotsTable(plan.shots),
        el('p', { class: 'caption-box', text: `${plan.caption}\n${plan.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}` }),
        el('div', { class: 'result-actions' },
          copyButton(() => `${plan.angle}\nฮุก: ${plan.hook}\n${shotsText(plan.shots)}\n\n${plan.caption}\n${plan.hashtags.join(' ')}\n${plan.cta}`),
          el('button', { type: 'button', class: 'button primary', text: 'ทำเป็นคลิปรีวิว →', onclick: () => toReview({
            productName: ctx.productName || plan.angle, channel: ctx.channel, tone: ctx.tone,
            details: `มุมขาย: ${plan.angle}\nกลุ่มลูกค้า: ${plan.audience}\nฮุกที่อยากใช้: ${plan.hook}\nประเด็นในคลิป: ${plan.shots.map((s) => s.voiceover).filter(Boolean).join(' / ')}\nคำชวนซื้อ: ${plan.cta}` }) })))));
      return;
    }
    $('#result-title').textContent = output.remake.title;
    const original = output.original, remake = output.remake;
    body.replaceChildren(
      el('div', { class: 'report' },
        el('h3', { text: 'ถอดสูตรคลิปต้นแบบ' }),
        el('p', { class: 'summary', text: `ฮุก: ${original.hook}` }),
        el('div', { class: 'two-col' }, el('p', {}, el('strong', { text: 'โครงเรื่อง' }), el('br'), original.structure), el('p', {}, el('strong', { text: 'จังหวะ' }), el('br'), original.pacing)),
        el('ul', {}, original.whyItWorks.map((w) => el('li', { text: w }))),
        shotsTable(original.shots),
        el('h3', { text: 'คลิปใหม่ของคุณ' }),
        el('p', { class: 'hook', text: `ฮุก: ${remake.hook}` }),
        shotsTable(remake.shots),
        el('p', { class: 'caption-box', text: `${remake.caption}\n${remake.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}` }),
        remake.productionNotes.length ? [el('h3', { text: 'เตรียมถ่าย' }), el('ul', {}, remake.productionNotes.map((n) => el('li', { text: n })))] : null),
      el('div', { class: 'result-actions' },
        copyButton(() => `${remake.title}\nฮุก: ${remake.hook}\n${shotsText(remake.shots)}\n\n${remake.caption}\n${remake.hashtags.join(' ')}`),
        el('button', { type: 'button', class: 'button primary', text: 'ทำเป็นคลิปรีวิวจากรูปสินค้า →', onclick: () => toReview({
          productName: ctx.productName, channel: ctx.channel,
          details: `${ctx.details ? ctx.details + '\n' : ''}ฮุกที่อยากใช้: ${remake.hook}\nประเด็นในคลิป: ${remake.shots.map((s) => s.voiceover).filter(Boolean).join(' / ')}` }) })));
  }

  // ---------- trending ----------

  let trendingVersion = 0;
  async function loadTrending() {
    const version = ++trendingVersion;
    const params = new URLSearchParams([...new FormData($('#filters'))].filter(([, v]) => v));
    setStatus('#trending-status', 'กำลังโหลดคลิปมาแรง…');
    const result = await api(`/api/marketer/trending?${params}`);
    if (version !== trendingVersion) return;
    if (!result.ok) { setStatus('#trending-status', explainFailure(result), true); return; }
    setStatus('#trending-status', '');
    const videos = result.data.videos;
    $('#trending-grid').replaceChildren(...(videos.length ? videos.map(trendingCard)
      : [el('li', { class: 'trending-empty', text: 'ยังไม่มีคลิปในตัวกรองนี้ ลองเปลี่ยนหมวดหรือช่วงเวลา' })]));
  }
  function trendingCard(video) {
    const cover = video.thumbnail ? el('img', { src: video.thumbnail, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer',
      onerror: (event) => event.currentTarget.replaceWith(el('span', { class: 'tv-blank', 'aria-hidden': 'true', text: '▶' })) })
      : el('span', { class: 'tv-blank', 'aria-hidden': 'true', text: '▶' });
    return el('li', { class: 'tv' }, cover,
      el('div', { class: 'tv-top' }, el('span', { class: 'tv-tag', text: video.region }), el('span', { class: 'tv-tag', text: video.categoryLabel })),
      el('div', { class: 'tv-body' },
        el('div', { class: 'tv-stats' },
          video.revenue !== null ? el('span', {}, el('b', { text: `฿${short(video.revenue)}` }), el('small', { text: 'ยอดขาย' })) : null,
          el('span', {}, el('b', { text: short(video.views) }), el('small', { text: 'วิว' })),
          video.engagement ? el('span', {}, el('b', { text: `${video.engagement}%` }), el('small', { text: 'เอนเกจ' })) : null),
        el('p', { class: 'tv-title', text: video.title || video.productName || 'คลิปขายของ' }),
        el('div', { class: 'tv-actions' },
          el('button', { type: 'button', text: 'ทำซ้ำ', onclick: () => openRecreate(video) }),
          el('a', { href: video.url, target: '_blank', rel: 'noopener noreferrer', text: 'ดูคลิป ↗' }))));
  }
  $('#filters').addEventListener('change', loadTrending);
  $('#filters').addEventListener('reset', () => setTimeout(loadTrending));

  // ---------- start ----------

  document.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.open;
    if (id === 'recreate-dialog') return openRecreate(null);
    if (id === 'insight-dialog') shuffleTemplates();
    $('#' + id).showModal();
  }));

  (async function init() {
    const result = await api('/api/marketer/config');
    if (!result.ok) { setStatus('#composer-status', explainFailure(result), true); $('#composer .mk-send').disabled = true; return; }
    config = result.data;
    const experts = Object.entries(config.experts);
    fillSelect($('#composer-expert'), experts);
    fillSelect($('#insight-expert'), experts);
    const categories = Object.entries(config.categories);
    [$('#composer-category'), $('#insight-category'), $('#filters [name=category]')].forEach((s) => fillSelect(s, categories, true));
    $('#composer-cost').textContent = config.ai ? `${config.cost} เครดิตต่องาน` : 'ระบบ AI ยังไม่เปิดใช้งาน';
    renderChips();
    restoreDraft();
    loadTrending();
    loadAccount();
  })();
})();
