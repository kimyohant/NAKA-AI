(() => {
  const menu = document.querySelector('.menu-button');
  const mobileNav = document.querySelector('#mobile-nav');
  const videos = [...document.querySelectorAll('.sample-video')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const toggle = document.querySelector('.video-toggle');
  const header = document.querySelector('.site-header');

  function syncHeaderAction() {
    header.classList.toggle('is-scrolled', scrollY > 240);
  }
  addEventListener('scroll', syncHeaderAction, { passive: true });
  syncHeaderAction();

  const sectionLinks = [...document.querySelectorAll('.desktop-nav a[href^="#"], .mobile-nav a[href^="#"]')];
  const trackedSections = [...new Set(sectionLinks.map(link => link.getAttribute('href')))]
    .map(href => ({ href, section: document.querySelector(href) }));
  function syncSectionNav() {
    let current = '';
    const threshold = header.getBoundingClientRect().height + 100;
    trackedSections.forEach(({ href, section }) => {
      if (section && section.getBoundingClientRect().top <= threshold) current = href;
    });
    sectionLinks.forEach(link => {
      if (link.getAttribute('href') === current) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  addEventListener('scroll', syncSectionNav, { passive: true });
  addEventListener('resize', syncSectionNav);
  syncSectionNav();

  function setMenuOpen(open) {
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'ปิดเมนู' : 'เปิดเมนู');
    mobileNav.hidden = !open;
  }
  menu?.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') !== 'true';
    setMenuOpen(open);
  });
  mobileNav?.addEventListener('click', event => {
    if (event.target.closest('a')) {
      setMenuOpen(false);
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !mobileNav.hidden) {
      setMenuOpen(false);
      menu.focus();
    }
  });

  function syncVideoControl() {
    const playing = !videos[0].paused;
    toggle.textContent = playing ? 'Ⅱ' : '▶';
    toggle.setAttribute('aria-label', playing ? 'พักวิดีโอตัวอย่าง' : 'เล่นวิดีโอตัวอย่าง');
  }
  function applyMotionPreference() {
    if (reduced.matches) videos.forEach(video => video.pause());
    else videos.forEach(video => video.play().catch(() => {}));
    syncVideoControl();
  }
  toggle?.addEventListener('click', () => {
    if (videos[0].paused) videos.forEach(video => video.play().catch(() => {}));
    else videos.forEach(video => video.pause());
    syncVideoControl();
  });
  reduced.addEventListener('change', applyMotionPreference);
  applyMotionPreference();

  const serviceGrid = document.querySelector('.team-grid');
  const serviceCards = [...document.querySelectorAll('.team-card[data-service]')];
  const detail = document.querySelector('#service-detail');
  const serviceContent = {
    sales: {
      eyebrow: '01 / คลิปขายสินค้า',
      title: 'เริ่มจากรูปสินค้า แล้วได้คลิปพร้อมขาย',
      description: 'นาคาช่วยเรียบเรียงจุดเด่นสินค้า ทำภาพเคลื่อนไหวและเสียงพากย์เป็นคลิปแนวตั้ง คุณตรวจงานก่อนนำไปโพสต์ได้',
      steps: ['รูปและข้อมูลสินค้า', 'คลิปแนวตั้งพร้อมเสียงพากย์', 'ตรวจและโพสต์บนช่องทางของร้าน'],
      action: 'ลองสร้างคลิปขาย',
      href: '/create/?workflow=sales'
    },
    drama: {
      eyebrow: '02 / ละครสั้น AI',
      title: 'ให้เรื่องเล่าพาคนดูมารู้จักสินค้า',
      description: 'นาคาช่วยวางพล็อต สร้างตัวละคร ฉาก และเสียงพากย์ แล้วเรนเดอร์เป็นวิดีโอสั้นแนวตั้งสำหรับร้านของคุณ',
      steps: ['ไอเดียหรือจุดเด่นสินค้า', 'พล็อต ตัวละคร และฉาก', 'ละครสั้นพร้อมนำไปโพสต์'],
      action: 'เริ่มทำละครสั้น',
      href: '/create/?workflow=drama'
    },
    live: {
      eyebrow: '03 / AI Live',
      title: 'มีพิธีกรไลฟ์ แม้คุณไม่อยู่หน้ากล้อง',
      description: 'อวตารและเสียงพากย์ AI ช่วยแนะนำสินค้า พูดคุยกับคนดู และพาร้านขายของผ่านไลฟ์ได้',
      steps: ['ข้อมูลสินค้าและรูปแบบไลฟ์', 'อวตารกับบทพูดของร้าน', 'ไลฟ์ขายและตอบคำถามคนดู'],
      action: 'เริ่ม AI Live',
      href: '/create/?workflow=live'
    },
    bot: {
      eyebrow: '04 / ตอบลูกค้าอัตโนมัติ',
      title: 'คำถามเข้ามา นาคาช่วยตอบต่อ',
      description: 'ผู้ช่วย AI ใช้ข้อมูลและน้ำเสียงของร้านตอบคอมเมนต์กับข้อความบนช่องทางขาย และส่งต่อให้คุณเมื่อคำถามต้องตัดสินใจเอง',
      steps: ['ข้อมูลสินค้าและน้ำเสียงร้าน', 'ตอบคอมเมนต์กับข้อความ', 'ส่งต่อคำถามที่ต้องให้คุณช่วย'],
      action: 'เริ่มตั้งค่าผู้ช่วยตอบ',
      href: '/create/?workflow=bot'
    }
  };
  let selectedService = 'sales';
  let detailAnimation;

  function selectService(key, reveal = false) {
    if (!serviceContent[key]) return;
    if (key !== selectedService) {
      selectedService = key;
      serviceCards.forEach(card => {
        const active = card.dataset.service === key;
        card.classList.toggle('is-selected', active);
        const button = card.querySelector('.service-select');
        button.setAttribute('aria-pressed', String(active));
        button.textContent = active ? 'กำลังดูอยู่' : 'ดูรายละเอียด';
      });
      const content = serviceContent[key];
      document.querySelector('#service-detail-eyebrow').textContent = content.eyebrow;
      document.querySelector('#service-detail-title').textContent = content.title;
      document.querySelector('#service-detail-description').textContent = content.description;
      document.querySelector('#service-detail-steps').replaceChildren(...content.steps.map(step => {
        const item = document.createElement('li');
        item.textContent = step;
        return item;
      }));
      const action = document.querySelector('#service-detail-cta');
      action.href = content.href;
      action.innerHTML = `${content.action} <span aria-hidden="true">↗</span>`;
      detailAnimation?.cancel();
      if (!reduced.matches) {
        detailAnimation = detail.animate(
          [{ opacity: .65, transform: 'translateY(7px)' }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: 200, easing: 'cubic-bezier(.22, 1, .36, 1)' }
        );
      }
    }
    if (reveal && matchMedia('(max-width: 760px)').matches) {
      serviceCards.find(card => card.dataset.service === key)?.scrollIntoView({ behavior: reduced.matches ? 'instant' : 'smooth', block: 'nearest', inline: 'start' });
    }
  }

  serviceGrid?.addEventListener('click', event => {
    const button = event.target.closest('.service-select');
    if (button) {
      selectService(button.dataset.select, false);
      detail.scrollIntoView({ behavior: reduced.matches ? 'instant' : 'smooth', block: 'nearest' });
    }
  });
  serviceGrid?.addEventListener('keydown', event => {
    if (!event.target.matches('.service-select') || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const index = serviceCards.findIndex(card => card.dataset.service === event.target.dataset.select);
    const next = Math.max(0, Math.min(serviceCards.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
    const target = serviceCards[next].querySelector('.service-select');
    target.focus();
    selectService(target.dataset.select, true);
  });
  document.querySelectorAll('.service-rail-arrow').forEach(arrow => arrow.addEventListener('click', () => {
    const index = serviceCards.findIndex(card => card.dataset.service === selectedService);
    const next = Math.max(0, Math.min(serviceCards.length - 1, index + (arrow.dataset.direction === 'next' ? 1 : -1)));
    selectService(serviceCards[next].dataset.service, true);
  }));

  const benefitGrid = document.querySelector('.assurance-grid');
  const benefitCards = [...document.querySelectorAll('.benefit-card')];
  benefitCards.forEach(card => card.addEventListener('toggle', () => {
    if (card.open) benefitCards.filter(other => other !== card).forEach(other => { other.open = false; });
  }));
  document.querySelectorAll('.benefit-rail-arrow').forEach(arrow => arrow.addEventListener('click', () => {
    if (!benefitGrid || !benefitCards.length) return;
    const gap = parseFloat(getComputedStyle(benefitGrid).columnGap) || 0;
    const step = benefitCards[0].getBoundingClientRect().width + gap;
    const index = Math.round(benefitGrid.scrollLeft / step);
    const next = Math.max(0, Math.min(benefitCards.length - 1, index + (arrow.dataset.direction === 'next' ? 1 : -1)));
    benefitGrid.scrollTo({ left: next * step, behavior: reduced.matches ? 'instant' : 'smooth' });
  }));

  const flowStage = document.querySelector('.flow-stage');
  const flowFrame = document.querySelector('#flow-frame');
  const flowToggle = document.querySelector('.flow-motion-toggle');
  const flowButtons = [...document.querySelectorAll('.flow-step')];
  const flowCaptions = [
    'นาคาจำชื่อร้าน ช่องทางขาย และน้ำเสียงที่คุณเลือก',
    'ใส่รูป ราคา และจุดเด่นสินค้าให้นาคาช่วยเล่าเรื่อง',
    'ได้คลิปขาย แล้วต่อยอดสู่ไลฟ์และการตอบลูกค้า'
  ];
  let flowUserPaused = reduced.matches;
  let flowVisible = false;
  const flowState = { phase: 0, paused: true };
  window.nakaFlowState = flowState;
  let flowStarted = false;
  let flowTimer;

  function syncFlowActivity() {
    flowState.paused = flowUserPaused || !flowVisible || document.hidden;
  }
  function syncFlowToggle() {
    flowToggle?.setAttribute('aria-pressed', String(flowUserPaused));
    if (flowToggle) flowToggle.textContent = flowUserPaused ? 'เล่นภาพเคลื่อนไหว' : 'พักภาพเคลื่อนไหว';
  }
  function resetFlow() {
    clearTimeout(flowTimer);
    flowStarted = false;
    flowFrame.hidden = true;
    flowFrame.removeAttribute('src');
    flowStage.classList.remove('is-ready');
    flowUserPaused = true;
    syncFlowActivity();
    syncFlowToggle();
  }
  function startFlow() {
    if (!flowFrame || flowStarted || flowUserPaused || !flowVisible) return;
    flowStarted = true;
    flowFrame.hidden = false;
    flowFrame.src = '/flow/';
    flowTimer = setTimeout(resetFlow, 45000);
  }
  if (flowStage) {
    flowButtons.forEach(button => button.addEventListener('click', () => {
      const phase = Number(button.dataset.phase);
      flowState.phase = phase;
      flowStage.dataset.phase = String(phase);
      flowButtons.forEach(item => {
        const active = item === button;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-pressed', String(active));
      });
      document.querySelector('#flow-caption').textContent = flowCaptions[phase];
    }));
    flowToggle.addEventListener('click', () => {
      flowUserPaused = !flowUserPaused;
      syncFlowActivity();
      syncFlowToggle();
      if (!flowUserPaused) startFlow();
    });
    reduced.addEventListener('change', () => {
      flowUserPaused = reduced.matches;
      syncFlowActivity();
      syncFlowToggle();
      if (!flowUserPaused) startFlow();
    });
    document.addEventListener('visibilitychange', syncFlowActivity);
    addEventListener('message', event => {
      if (event.origin !== location.origin || event.source !== flowFrame.contentWindow) return;
      if (event.data?.type === 'naka-flow-ready') {
        clearTimeout(flowTimer);
        flowStage.classList.add('is-ready');
      } else if (event.data?.type === 'naka-flow-error') resetFlow();
    });
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        flowVisible = entries.some(entry => entry.isIntersecting);
        syncFlowActivity();
        if (flowVisible) startFlow();
      }, { rootMargin: '200px' });
      observer.observe(flowStage);
    } else {
      flowVisible = true;
      syncFlowActivity();
      startFlow();
    }
    syncFlowToggle();
  }

  document.querySelector('#year').textContent = new Date().getFullYear();
})();
