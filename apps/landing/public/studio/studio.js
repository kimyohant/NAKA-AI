(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const form = $('#product-form');
  const params = new URLSearchParams(window.location.search);
  const { workflows, channels } = window.NakaWorkflows;
  const requestedWorkflow = params.get('workflow');
  const workflow = Object.hasOwn(workflows, requestedWorkflow) ? requestedWorkflow : 'sales';
  const config = workflows[workflow];
  const draftKey = `naka_studio_draft_${workflow}_v2`;
  const brandKey = 'naka_studio_brand_v1';
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const state = { mode: 'demo', tab: 'captions', result: null, brand: { brandName: '', brandVoice: '' }, busy: false, imageURL: '', product: null };
  let draftTimer;
  let toastTimer;
  let persistWarning = false;

  const storageRead = (key) => {
    try { return localStorage.getItem(key); } catch { return null; }
  };
  const readJSON = (key) => {
    try { const value = JSON.parse(storageRead(key)); return value && typeof value === 'object' && !Array.isArray(value) ? value : null; } catch { return null; }
  };
  const token = () => storageRead('naka_admin') || '';
  const announce = (message) => { $('#live-status').textContent = message; };
  function toast(message) {
    clearTimeout(toastTimer);
    $('#toast').textContent = message;
    $('#toast').hidden = false;
    toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500);
  }
  function setMode(mode) {
    state.mode = mode;
    const ai = mode === 'ai';
    $('.mode-bar').classList.toggle('ai', ai);
    $('#mode-label').replaceChildren();
    const dot = document.createElement('span');
    dot.className = 'status-dot';
    dot.setAttribute('aria-hidden', 'true');
    $('#mode-label').append(dot, ai ? 'โหมด AI · สำหรับเจ้าของร้าน' : 'โหมดทดลอง · สร้างจากแม่แบบ');
    $('#mode-description').textContent = ai ? 'ใช้ข้อมูลสินค้าและความจำร้านสร้างคอนเทนต์ด้วย AI' : 'ทดลองได้ทันที ข้อความชุดนี้ยังไม่ได้สร้างด้วย AI';
    $('#switch-mode').hidden = !token();
    $('#switch-mode').textContent = ai ? 'ใช้โหมดทดลอง' : 'กลับไปใช้ AI';
    $('#generate-label').textContent = ai ? 'เสกชุดคอนเทนต์ด้วย AI' : 'เสกชุดคอนเทนต์ทดลอง';
  }
  function readForm() {
    const data = new FormData(form);
    return {
      workflow,
      productName: String(data.get('productName') || '').trim(),
      details: String(data.get('details') || '').trim(),
      price: String(data.get('price') || '').trim(),
      tone: String(data.get('tone') || 'friendly'),
      channel: String(data.get('channel') || 'facebook'),
    };
  }
  function saveDraft() {
    clearTimeout(draftTimer);
    try {
      localStorage.setItem(draftKey, JSON.stringify(readForm()));
      $('#draft-status').textContent = 'บันทึกแบบร่างในเบราว์เซอร์แล้ว';
      persistWarning = false;
    } catch {
      $('#draft-status').textContent = 'บันทึกอัตโนมัติไม่ได้ แบบร่างจะหายเมื่อปิดหน้า';
      if (!persistWarning) { announce('เบราว์เซอร์ไม่อนุญาตให้บันทึกแบบร่าง'); persistWarning = true; }
    }
  }
  function fillForm(data) {
    for (const key of ['productName', 'details', 'price']) {
      if (typeof data[key] === 'string') form.elements.namedItem(key).value = data[key].slice(0, key === 'details' ? 3000 : key === 'price' ? 80 : 160);
    }
    if (['friendly', 'premium', 'playful'].includes(data.tone)) form.elements.namedItem('tone').value = data.tone;
    if (config.channels.includes(data.channel)) form.elements.namedItem('channel').value = data.channel;
  }
  function useExample(quiet = false) {
    fillForm(config.example);
    $('#product-name').setCustomValidity('');
    $('#product-details').setCustomValidity('');
    saveDraft();
    if (!quiet) { toast('ใส่บรีฟตัวอย่างแล้ว ปรับรายละเอียดหรือเริ่มสร้างร่างได้เลย'); $('#product-name').focus({ preventScroll: true }); }
  }
  function selectTab(name, focus = false) {
    if (!tabs.some((tab) => tab.dataset.tab === name)) return;
    state.tab = name;
    tabs.forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      $(`#panel-${tab.dataset.tab}`).hidden = !active;
      if (active && focus) tab.focus();
    });
    const note = name === 'script' || name === 'imagePrompt' ? config.note : '';
    $('#tool-note').textContent = note;
    $('#tool-note').hidden = !note;
  }
  function demoContent(product) {
    const { productName: name, details, price, tone, channel, brandName } = product;
    const shop = brandName ? `จาก ${brandName}` : '';
    const priceLine = price ? `ราคา ${price}` : '';
    const call = channel === 'instagram' ? 'ส่งข้อความ DM มาสอบถามรายละเอียดเพิ่มเติมได้เลย' : 'ทักข้อความมาสอบถามรายละเอียดเพิ่มเติมได้เลย';
    const openers = {
      friendly: [`มารู้จัก ${name} ${shop}`.trim(), `กำลังมองหา ${name} อยู่หรือเปล่า?`, `อีกมุมของ ${name} ที่อยากเล่าให้ฟัง`],
      premium: [`${name} ${shop}`.trim(), `รายละเอียดของ ${name}`, `ทำความรู้จัก ${name}`],
      playful: [`วันนี้มี ${name} มาให้รู้จัก!`, `แวะมาดู ${name} กันสักนิด`, `ชวนเปิดกล่องเรื่องราวของ ${name}`],
    }[tone];
    const lines = (...items) => items.filter(Boolean).join('\n\n');
    const signature = brandName ? `ร้าน ${brandName}` : '';
    return {
      mode: 'demo',
      captions: [
        { title: 'เปิดตัวสินค้า', text: lines(openers[0], details, priceLine, call) },
        { title: 'ชวนทำความรู้จัก', text: lines(openers[1], `ข้อมูลสินค้าที่ร้านอยากบอก:\n${details}`, priceLine, call, signature) },
        { title: 'เล่ารายละเอียด', text: lines(openers[2], details, priceLine, `อยากรู้เพิ่มเติมเกี่ยวกับ ${name}?\n${call}`, signature) },
      ],
      script: `สคริปต์คลิปแนะนำสินค้า · ประมาณ 30–45 วินาที\nปรับเวลาตามความยาวของรายละเอียดสินค้า\n\nช่วงเปิด | 0–5 วินาที\nภาพ: วางสินค้าให้เห็นชื่อและบรรจุภัณฑ์ชัดเจน\nคำพูด: “${openers[0]}”\n\nช่วงเล่ารายละเอียด | 5–30 วินาที\nภาพ: ถ่ายมุมใกล้ของสินค้าให้สอดคล้องกับข้อมูลจริง\nคำพูด: “${details}”\n\nช่วงปิด | 30–45 วินาที\nภาพ: กลับมาที่สินค้าและพื้นที่ใส่ข้อความ\nคำพูด: “${[priceLine, call].filter(Boolean).join(' · ')}”\n\nก่อนถ่ายทำ: เลือกเฉพาะข้อเท็จจริงที่แสดงในภาพได้ และปรับคำพูดให้เป็นธรรมชาติ`,
      plan: [
        `โพสต์ที่ 1 · แนะนำสินค้า\nใช้ภาพ ${name} ที่เห็นรายละเอียดชัดเจน พร้อมแคปชันเปิดตัว${price ? ` และระบุราคา ${price}` : ''}\nเป้าหมาย: ให้คนรู้ว่าร้านกำลังนำเสนอสินค้าอะไร`,
        `โพสต์ที่ 2 · เล่าจุดเด่นจากข้อมูลจริง\nเลือกหนึ่งประเด็นจากข้อมูลนี้มาเล่า: ${details}\nทำเป็นภาพระยะใกล้หรือคลิปสั้น แล้วชวนลูกค้าถามสิ่งที่อยากรู้`,
        `โพสต์ที่ 3 · ตอบคำถามก่อนสั่งซื้อ\nรวบรวมคำถามที่ลูกค้าถามจริงเกี่ยวกับ ${name} แล้วตอบด้วยข้อมูลที่ร้านยืนยันได้\nปิดท้ายด้วยช่องทางสอบถาม: ${call}`,
      ],
      imagePrompt: `บรีฟภาพโปรโมต: ${name}\n${brandName ? `แบรนด์: ${brandName}\n` : ''}\nข้อมูลสินค้าที่ใช้ประกอบภาพ:\n${details}\n\nแนวทางภาพ:\nใช้ภาพสินค้าจริงเป็นภาพหลัก รักษารูปทรง สี ฉลาก และบรรจุภัณฑ์เดิม เลือกพื้นหลัง${tone === 'premium' ? 'เรียบ สีอ่อน แสงนุ่ม และเว้นพื้นที่ให้สินค้าเด่น' : tone === 'playful' ? 'สีสดใสที่เข้ากับสินค้า มีพื้นที่ว่างสำหรับข้อความ' : 'สบายตา แสงธรรมชาติ และจัดสินค้าให้น่าเข้าถึง'}\n\nพื้นที่ข้อความ:\nชื่อสินค้า: ${name}\n${priceLine || 'เว้นราคาจนกว่าร้านจะยืนยันข้อมูล'}\n\nสำหรับ ${NakaWorkflows.channels[channel] || 'Facebook'}: ตรวจขนาดภาพและพื้นที่ปลอดภัยของข้อความก่อนเผยแพร่\n\nข้อควรตรวจ: ไม่เพิ่มคำรับรอง คุณสมบัติ ส่วนผสม หรือโปรโมชันที่ไม่มีในข้อมูลสินค้า`,
    };
  }
  function validateResult(value) {
    return value && value.mode === 'ai' && Array.isArray(value.captions) && value.captions.length === 3 && value.captions.every((caption) => caption && typeof caption.title === 'string' && typeof caption.text === 'string' && caption.text.trim()) && typeof value.script === 'string' && value.script.trim() && Array.isArray(value.plan) && value.plan.length === 3 && value.plan.every((item) => typeof item === 'string' && item.trim()) && typeof value.imagePrompt === 'string' && value.imagePrompt.trim();
  }
  async function aiContent(product) {
    const authToken = token();
    if (!authToken) throw new Error('ยังไม่ได้เข้าสู่ระบบเจ้าของร้าน เปิดหลังร้านเพื่อเข้าสู่ระบบ หรือเลือกใช้โหมดทดลอง');
    if (!navigator.onLine) throw new Error('ขณะนี้ไม่มีการเชื่อมต่ออินเทอร์เน็ต ลองเชื่อมต่อแล้วสร้างอีกครั้ง หรือเลือกใช้โหมดทดลอง');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 65000);
    try {
      const response = await fetch('/api/admin/studio', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }, body: JSON.stringify(product), signal: controller.signal });
      let value;
      try { value = await response.json(); } catch { throw new Error('เซิร์ฟเวอร์ส่งข้อมูลกลับมาไม่สมบูรณ์ กรุณาลองใหม่อีกครั้ง'); }
      if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : 'สร้างคอนเทนต์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
      if (!validateResult(value)) throw new Error('คอนเทนต์ที่ได้รับยังไม่ครบถ้วน กรุณาลองสร้างใหม่อีกครั้ง');
      return value;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('รอนานกว่าที่คาดไว้ กรุณาลองสร้างใหม่อีกครั้ง');
      if (error instanceof TypeError) throw new Error('เชื่อมต่อบริการไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง');
      throw error;
    } finally { clearTimeout(timer); }
  }
  function setBusy(busy) {
    state.busy = busy;
    $('#product-fields').disabled = busy;
    $('#generate-button').disabled = busy;
    $('#fill-example').disabled = busy;
    $('#empty-example').disabled = busy;
    $('#switch-mode').disabled = busy;
    $('#open-brand').disabled = busy;
    $('.results-panel').setAttribute('aria-busy', String(busy));
    $('#loading-state').hidden = !busy;
    $('#empty-state').hidden = busy || !!state.result;
    $('#result-content').hidden = busy || !state.result;
    $('#download-all').hidden = busy || !state.result;
    if (busy) $('#generate-label').textContent = 'กำลังเตรียมคอนเทนต์…';
    else setMode(state.mode);
  }
  async function copyText(text, button) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      toast('คัดลอกข้อความแล้ว');
    } catch {
      const editor = button.closest('.editor-block').querySelector('textarea');
      editor.focus();
      editor.select();
      toast('เลือกข้อความให้แล้ว กดคัดลอกจากเมนูหรือ Ctrl/Cmd + C');
    }
  }
  function editorBlock({ container, title, value, index, id, onInput, long = false }) {
    const block = document.createElement('div');
    block.className = `editor-block${long ? ' long' : ''}`;
    const heading = document.createElement('div');
    heading.className = 'editor-heading';
    const label = document.createElement('label');
    label.htmlFor = id;
    const number = document.createElement('span');
    number.className = 'editor-number';
    number.textContent = String(index + 1).padStart(2, '0');
    number.setAttribute('aria-hidden', 'true');
    label.append(number, title);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'text-button copy-button';
    button.textContent = 'คัดลอก';
    button.setAttribute('aria-label', `คัดลอก${title}`);
    const textarea = document.createElement('textarea');
    textarea.className = 'editor-textarea';
    textarea.id = id;
    textarea.value = value;
    textarea.spellcheck = false;
    textarea.addEventListener('input', () => { onInput(textarea.value); $('#edit-status').textContent = 'แก้ไขแล้ว · ดาวน์โหลดเพื่อเก็บไว้'; });
    button.addEventListener('click', () => copyText(textarea.value, button));
    heading.append(label, button);
    block.append(heading, textarea);
    container.append(block);
  }
  function addPanelDescription(container, text) {
    const p = document.createElement('p');
    p.className = 'panel-description';
    p.textContent = text;
    container.append(p);
  }
  function renderResults() {
    const result = state.result;
    for (const name of ['captions', 'script', 'plan', 'imagePrompt']) $(`#panel-${name}`).replaceChildren();
    result.captions.forEach((caption, index) => editorBlock({ container: $('#panel-captions'), title: caption.title, value: caption.text, index, id: `caption-${index}`, onInput: (value) => { result.captions[index].text = value; } }));
    addPanelDescription($('#panel-script'), config.note);
    editorBlock({ container: $('#panel-script'), title: config.tabs[1], value: result.script, index: 0, id: 'script-editor', onInput: (value) => { result.script = value; }, long: true });
    addPanelDescription($('#panel-plan'), 'ตรวจรายละเอียดและปรับลำดับให้ตรงกับงานของคุณก่อนนำไปใช้');
    result.plan.forEach((item, index) => editorBlock({ container: $('#panel-plan'), title: `${config.tabs[2]} · ${index + 1}`, value: item, index, id: `plan-${index}`, onInput: (value) => { result.plan[index] = value; } }));
    addPanelDescription($('#panel-imagePrompt'), 'ผลลัพธ์จากสตูดิโอนี้เป็นข้อความสำหรับตรวจแก้ ก่อนส่งทีมไปผลิตสื่อ');
    editorBlock({ container: $('#panel-imagePrompt'), title: config.tabs[3], value: result.imagePrompt, index: 0, id: 'image-prompt-editor', onInput: (value) => { result.imagePrompt = value; }, long: true });
    if (result.mode === 'demo' && state.product.brandVoice) {
      const note = document.createElement('p');
      note.className = 'brand-voice-note';
      note.textContent = `น้ำเสียงที่ร้านบันทึกไว้ (ปรับข้อความตามนี้ได้เลย): ${state.product.brandVoice}`;
      $('#panel-captions').append(note);
    }
    $('#result-product').textContent = state.product.productName;
    $('#result-mode').textContent = result.mode === 'ai' ? 'สร้างด้วย AI' : 'สร้างจากแม่แบบทดลอง';
    $('#results-description').textContent = result.mode === 'ai' ? 'นาคาเตรียมให้แล้ว อ่านและปรับก่อนใช้ได้เลย' : 'ชุดตัวอย่างจากข้อมูลของคุณ ปรับต่อได้ทุกข้อความ';
    $('#edit-status').textContent = 'ผลงานยังไม่ถูกเผยแพร่';
    selectTab(state.tab);
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.busy) return;
    for (const selector of ['#product-name', '#product-details']) {
      const field = $(selector);
      field.setCustomValidity(field.value.trim() ? '' : 'กรุณากรอกข้อมูลในช่องนี้');
    }
    if (!form.reportValidity()) return;
    saveDraft();
    const product = { ...readForm(), ...state.brand };
    $('#generation-error').hidden = true;
    $('#loading-message').textContent = state.mode === 'ai' ? 'AI กำลังเรียบเรียงจากข้อมูลสินค้าและสไตล์ร้านของคุณ…' : 'กำลังจัดชุดข้อความจากแม่แบบและข้อมูลสินค้าของคุณ…';
    setBusy(true);
    announce('กำลังเตรียมคอนเทนต์');
    try {
      const result = state.mode === 'ai' ? await aiContent(product) : window.NakaWorkflows.demoContent(product, demoContent(product));
      state.result = result;
      state.product = product;
      renderResults();
      announce(state.mode === 'ai' ? 'AI เตรียมคอนเทนต์เรียบร้อยแล้ว' : 'สร้างชุดคอนเทนต์ทดลองเรียบร้อยแล้ว');
      toast(state.mode === 'ai' ? 'เสกให้แล้ว เลือกอ่านและปรับต่อได้เลย' : 'ชุดคอนเทนต์ทดลองพร้อมแล้ว');
      if (window.matchMedia('(max-width: 760px)').matches) $('.results-panel').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    } catch (error) {
      $('#error-message').textContent = error.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';
      $('#error-demo').hidden = state.mode !== 'ai';
      $('#generation-error').hidden = false;
      announce('สร้างคอนเทนต์ไม่สำเร็จ');
    } finally { setBusy(false); }
  });
  form.addEventListener('input', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) event.target.setCustomValidity('');
    if (event.target.id === 'product-image') return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 300);
  });
  form.addEventListener('change', (event) => { if (event.target.id !== 'product-image') saveDraft(); });
  $('#fill-example').addEventListener('click', () => useExample());
  $('#empty-example').addEventListener('click', () => { useExample(); $('#product-name').scrollIntoView({ block: 'center', behavior: 'smooth' }); });
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab.dataset.tab));
    tab.addEventListener('keydown', (event) => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      selectTab(tabs[next].dataset.tab, true);
    });
  });
  $('#switch-mode').addEventListener('click', () => { setMode(state.mode === 'ai' ? 'demo' : 'ai'); $('#generation-error').hidden = true; toast(state.mode === 'ai' ? 'เปลี่ยนเป็นโหมด AI แล้ว' : 'เปลี่ยนเป็นโหมดทดลองแล้ว'); });
  $('#error-demo').addEventListener('click', () => { setMode('demo'); $('#generation-error').hidden = true; toast('เปลี่ยนเป็นแม่แบบแล้ว กดเสกเพื่อสร้างชุดทดลอง'); $('#generate-button').focus(); });
  $('#download-all').addEventListener('click', () => {
    if (!state.result) return;
    const result = state.result;
    const text = [`naka-ai · ${config.name} · ${state.product.productName}`, result.mode === 'ai' ? 'สร้างด้วย AI · ตรวจสอบข้อมูลก่อนเผยแพร่' : 'สร้างจากแม่แบบทดลอง · ไม่ใช่ผลงานจาก AI', config.note, '', ...result.captions.flatMap((caption) => [caption.title, caption.text, '']), config.tabs[1], result.script, '', config.tabs[2], ...result.plan.flatMap((item) => [item, '']), config.tabs[3], result.imagePrompt].join('\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `naka-ai-${state.product.productName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').slice(0, 60) || 'content'}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('ดาวน์โหลดชุดคอนเทนต์แล้ว');
  });

  function updateBrandLabel() { $('#brand-button-label').textContent = state.brand.brandName ? `ร้าน ${state.brand.brandName}` : 'ความจำประจำร้าน'; }
  const dialog = $('#brand-dialog');
  $('#open-brand').addEventListener('click', () => {
    $('#brand-name').value = state.brand.brandName;
    $('#brand-voice').value = state.brand.brandVoice;
    $('#brand-error').hidden = true;
    dialog.showModal();
    $('#brand-name').focus();
  });
  const closeBrand = () => dialog.close();
  $('#close-brand').addEventListener('click', closeBrand);
  $('#cancel-brand').addEventListener('click', closeBrand);
  dialog.addEventListener('close', () => $('#open-brand').focus());
  $('#brand-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const brand = { brandName: $('#brand-name').value.trim(), brandVoice: $('#brand-voice').value.trim() };
    try {
      localStorage.setItem(brandKey, JSON.stringify(brand));
      state.brand = brand;
      updateBrandLabel();
      dialog.close();
      toast('บันทึกความจำร้านแล้ว ใช้กับคอนเทนต์ชุดถัดไป');
    } catch {
      $('#brand-error').textContent = 'เบราว์เซอร์ไม่อนุญาตให้บันทึก กรุณาเปิดการจัดเก็บข้อมูลในเครื่องแล้วลองอีกครั้ง';
      $('#brand-error').hidden = false;
    }
  });

  const clearImage = () => {
    if (state.imageURL) URL.revokeObjectURL(state.imageURL);
    state.imageURL = '';
    $('#product-image').value = '';
    $('#image-preview').removeAttribute('src');
    $('#image-preview-wrap').hidden = true;
  };
  $('#product-image').addEventListener('change', () => {
    const file = $('#product-image').files[0];
    $('#image-error').hidden = true;
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      $('#image-error').textContent = 'เลือกไฟล์ JPG, PNG หรือ WebP ขนาดไม่เกิน 10 MB';
      $('#image-error').hidden = false;
      $('#product-image').value = '';
      return;
    }
    if (state.imageURL) URL.revokeObjectURL(state.imageURL);
    state.imageURL = URL.createObjectURL(file);
    $('#image-preview').src = state.imageURL;
    $('#image-preview-wrap').hidden = false;
    announce('แนบภาพไว้ดูประกอบแล้ว ภาพนี้จะไม่ถูกส่งไปวิเคราะห์');
  });
  $('#image-preview').addEventListener('error', () => { clearImage(); $('#image-error').textContent = 'เปิดภาพนี้ไม่ได้ กรุณาเลือกไฟล์ภาพอื่น'; $('#image-error').hidden = false; });
  $('#remove-image').addEventListener('click', () => { clearImage(); $('#product-image').focus(); });
  window.addEventListener('pagehide', () => { if (draftTimer) saveDraft(); });
  window.addEventListener('storage', (event) => { if (event.key === 'naka_admin' && !state.busy) setMode(token() ? 'ai' : 'demo'); });

  document.title = `${config.name} · สตูดิโอ naka-ai`;
  document.querySelectorAll('[data-workflow]').forEach(link => {
    if (link.dataset.workflow === workflow) link.setAttribute('aria-current', 'page');
  });
  $('.page-heading h1').textContent = config.title;
  $('.page-heading .eyebrow').textContent = config.name;
  $('.intro').textContent = config.description;
  $('#workflow-note').textContent = config.note;
  $('#name-label').textContent = config.nameLabel;
  $('#details-label').textContent = config.detailsLabel;
  $('#product-name').placeholder = config.example.productName;
  $('#product-details').placeholder = config.placeholder;
  $('#details-help').textContent = workflow === 'drama' ? 'บอกปมเรื่อง ความยาว และตอนจบที่อยากได้ เพื่อใช้เป็นแนวทางของบท' : 'ใช้ข้อมูลที่ยืนยันได้และระบุสิ่งที่ต้องการให้ชัด';
  $('#product-price').closest('.field').hidden = workflow === 'drama';
  $('#product-channel').replaceChildren(...config.channels.map(channel => {
    const option = document.createElement('option'); option.value = channel; option.textContent = channels[channel]; return option;
  }));
  $('#brief-heading').lastChild.textContent = 'ใส่บรีฟของคุณ';
  $('#results-heading').lastChild.textContent = 'ร่างงานพร้อมให้ปรับต่อ';
  tabs.forEach((tab, index) => { tab.textContent = config.tabs[index]; });
  $('#empty-state h3').textContent = `เริ่ม${config.name}ชิ้นแรก`;
  $('#empty-state p').textContent = config.description;
  $('.output-preview').replaceChildren(...config.tabs.slice(1).map(label => { const span = document.createElement('span'); span.textContent = label; return span; }));
  $('#empty-example').textContent = 'ลองด้วยบรีฟตัวอย่าง →';
  const savedBrand = readJSON(brandKey);
  if (savedBrand) state.brand = { brandName: typeof savedBrand.brandName === 'string' ? savedBrand.brandName.slice(0, 160) : '', brandVoice: typeof savedBrand.brandVoice === 'string' ? savedBrand.brandVoice.slice(0, 1000) : '' };
  const savedDraft = readJSON(draftKey) || (workflow === 'sales' ? readJSON('naka_studio_draft_v1') : null);
  if (savedDraft) { fillForm(savedDraft); $('#draft-status').textContent = 'เปิดแบบร่างล่าสุดจากเบราว์เซอร์นี้แล้ว'; }
  if (params.get('example') === 'soap') useExample(true);
  const toolMap = { captions: 'captions', image: 'imagePrompt', video: 'script', plan: 'plan' };
  selectTab(toolMap[params.get('tool')] || 'script');
  updateBrandLabel();
  setMode(token() ? 'ai' : 'demo');
})();
