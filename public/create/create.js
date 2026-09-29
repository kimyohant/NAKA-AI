(() => {
  const form = document.querySelector('#brief-form');
  const imageInput = document.querySelector('#product-image');
  const preview = document.querySelector('#preview');
  const prompt = document.querySelector('#upload-prompt');
  const status = document.querySelector('#copy-status');
  const jobs = {
    sales: {
      name: 'คลิปขาย',
      heading: 'รูปสินค้าของคุณ<br><em>คือจุดเริ่มต้น</em>',
      intro: 'เตรียมรูปและจุดเด่นสินค้า คัดลอกบรีฟ แล้วโทรคุยกับทีมงานเพื่อเริ่มคลิปแรก',
      nameLabel: 'ชื่อสินค้า',
      namePlaceholder: 'เช่น สบู่สมุนไพรกลิ่นมะลิ',
      detailsLabel: 'จุดเด่นที่อยากให้คนจำ',
      detailsPlaceholder: 'เล่าของจริงสั้น ๆ เช่น กลิ่น วัสดุ ขนาด หรือวิธีใช้',
      uploadTitle: 'เลือกรูปสินค้า',
      uploadHelp: 'JPG, PNG หรือ WebP · แสดงตัวอย่างบนเครื่องนี้',
      channelLabel: 'ขายบนช่องทางไหน',
      submit: 'คัดลอกบรีฟคลิปขาย',
      showUpload: true
    },
    drama: {
      name: 'ละครสั้น',
      heading: 'เล่าเรื่องร้านคุณ<br><em>เป็นละครสั้น AI</em>',
      intro: 'บอกพล็อต ตัวละคร และแนวเรื่องที่อยากได้ แล้วคุยกับทีมเพื่อเริ่มทำวิดีโอ',
      nameLabel: 'ชื่อเรื่องหรือสินค้า',
      namePlaceholder: 'เช่น จดหมายจากร้านของแม่',
      detailsLabel: 'พล็อต ตัวละคร และตอนจบ',
      detailsPlaceholder: 'เล่าเรื่องที่อยากให้เกิดขึ้น มีใครบ้าง และอยากให้จบอย่างไร',
      uploadTitle: 'เพิ่มภาพอ้างอิง (ถ้ามี)',
      uploadHelp: 'ภาพสินค้า ตัวละคร หรือบรรยากาศ · อยู่บนเครื่องนี้',
      channelLabel: 'อยากลงช่องทางไหน',
      submit: 'คัดลอกบรีฟละครสั้น',
      showUpload: true
    },
    live: {
      name: 'AI Live',
      heading: 'ไลฟ์ขายของ<br><em>โดยไม่ต้องออกกล้อง</em>',
      intro: 'บอกสินค้า รูปแบบรายการ และช่องทางไลฟ์ แล้วคุยกับทีมเพื่อจัดพิธีกร AI',
      nameLabel: 'ชื่อรายการหรือสินค้า',
      namePlaceholder: 'เช่น ไลฟ์ของขวัญชิ้นเล็กจากร้านละมุน',
      detailsLabel: 'สินค้าที่จะโชว์และรูปแบบไลฟ์',
      detailsPlaceholder: 'บอกสินค้า ราคา ระยะเวลา บุคลิกพิธีกร และคำถามที่อยากให้ตอบ',
      uploadTitle: 'เพิ่มภาพสินค้า (ถ้ามี)',
      uploadHelp: 'JPG, PNG หรือ WebP · อยู่บนเครื่องนี้',
      channelLabel: 'อยากไลฟ์บนช่องทางไหน',
      submit: 'คัดลอกบรีฟ AI Live',
      showUpload: true
    },
    bot: {
      name: 'ผู้ช่วยตอบลูกค้า',
      heading: 'ลูกค้าถาม<br><em>นาคาช่วยตอบ</em>',
      intro: 'บอกข้อมูลสินค้า คำถามที่พบบ่อย และกรณีที่ต้องส่งต่อให้ร้าน แล้วคุยกับทีมเพื่อตั้งค่าผู้ช่วย',
      nameLabel: 'ชื่อร้านหรือสินค้า',
      namePlaceholder: 'เช่น ร้านละมุน · สบู่กลิ่นมะลิ',
      detailsLabel: 'ข้อมูลและกติกาการตอบลูกค้า',
      detailsPlaceholder: 'ราคา วิธีสั่งซื้อ ค่าส่ง คำถามที่พบบ่อย และเรื่องที่ให้คนในร้านตอบเอง',
      channelLabel: 'ลูกค้าทักจากช่องทางไหน',
      submit: 'คัดลอกบรีฟผู้ช่วยตอบ',
      showUpload: false
    }
  };
  const requested = new URLSearchParams(location.search).get('workflow') || 'sales';
  const workflow = Object.hasOwn(jobs, requested) ? requested : 'sales';
  const job = jobs[workflow];
  document.querySelector('#page-heading').innerHTML = job.heading;
  document.querySelector('#workflow-intro').textContent = job.intro;
  document.querySelector('#name-label').textContent = job.nameLabel;
  document.querySelector('#product-name').placeholder = job.namePlaceholder;
  const prefilledName = new URLSearchParams(location.search).get('name');
  if (prefilledName) document.querySelector('#product-name').value = prefilledName.slice(0, 120);
  document.querySelector('#details-label').textContent = job.detailsLabel;
  document.querySelector('#product-details').placeholder = job.detailsPlaceholder;
  document.querySelector('#channel-label').textContent = job.channelLabel;
  document.querySelector('#submit-label').textContent = job.submit;
  document.querySelector('#upload-control').hidden = !job.showUpload;
  imageInput.hidden = !job.showUpload;
  if (job.showUpload) {
    document.querySelector('#upload-title').textContent = job.uploadTitle;
    document.querySelector('#upload-help').textContent = job.uploadHelp;
  } else {
    status.textContent = 'คัดลอกบรีฟแล้วคุยกับทีมเพื่อเชื่อมช่องทางและตั้งค่าคำตอบ';
  }
  document.querySelectorAll('[data-workflow]').forEach(link => {
    if (link.dataset.workflow === workflow) link.setAttribute('aria-current', 'page');
  });
  document.title = 'เริ่ม' + job.name + ' · naka-ai';

  let previewURL;
  imageInput.addEventListener('change', () => {
    if (previewURL) { URL.revokeObjectURL(previewURL); previewURL = undefined; }
    const file = imageInput.files?.[0];
    if (!file) { preview.hidden = true; prompt.hidden = false; return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) {
      imageInput.value = '';
      preview.hidden = true;
      prompt.hidden = false;
      status.textContent = 'กรุณาเลือกภาพ JPG, PNG หรือ WebP ขนาดไม่เกิน 15 MB';
      return;
    }
    previewURL = URL.createObjectURL(file);
    preview.src = previewURL;
    preview.alt = 'ภาพตัวอย่าง ' + file.name;
    preview.hidden = false;
    prompt.hidden = true;
    status.textContent = 'รูปแสดงบนเครื่องของคุณเท่านั้น กรุณาส่งรูปให้ทีมงานในช่องทางที่ตกลงกัน';
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const lines = [
      'NAKA-AI Tech · บรีฟ' + job.name,
      job.nameLabel + ': ' + data.get('productName'),
      job.detailsLabel + ': ' + data.get('details'),
      job.channelLabel + ': ' + data.get('channel')
    ];
    if (job.showUpload) lines.push('ภาพอ้างอิง: ' + (imageInput.files?.[0]?.name || 'จะส่งให้ทีมงานภายหลัง'));
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      status.textContent = 'คัดลอกบรีฟแล้ว โทร 0892788587 เพื่อคุยรายละเอียดกับทีมงาน';
    } catch {
      status.textContent = 'เบราว์เซอร์คัดลอกอัตโนมัติไม่ได้ กรุณาโทร 0892788587 เพื่อแจ้งบรีฟ';
    }
  });
  document.querySelector('#year').textContent = new Date().getFullYear();
  addEventListener('pagehide', () => { if (previewURL) URL.revokeObjectURL(previewURL); });
})();
