// Landing page behavior: product dropdowns, mobile menu, sample rails, videos that load and
// play only while on screen, and chat demos that type themselves out. Reduced motion shows
// everything still.
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  // ---- product dropdowns: click or keyboard opens, hover opens on devices that hover ----
  var triggers = Array.prototype.slice.call(document.querySelectorAll('.nav-trigger'));
  function panelOf(trigger) { return document.getElementById(trigger.getAttribute('aria-controls')); }
  function setPanel(trigger, open) {
    trigger.setAttribute('aria-expanded', String(open));
    panelOf(trigger).hidden = !open;
  }
  function closeAll(except) { triggers.forEach(function (t) { if (t !== except) setPanel(t, false); }); }
  var canHover = window.matchMedia('(hover: hover)').matches;
  triggers.forEach(function (trigger) {
    var item = trigger.parentElement;
    var closeTimer = null;
    trigger.addEventListener('click', function () {
      var open = trigger.getAttribute('aria-expanded') !== 'true';
      closeAll(trigger);
      setPanel(trigger, open);
    });
    if (canHover) {
      item.addEventListener('mouseenter', function () { clearTimeout(closeTimer); closeAll(trigger); setPanel(trigger, true); });
      item.addEventListener('mouseleave', function () { closeTimer = setTimeout(function () { setPanel(trigger, false); }, 180); });
    }
    panelOf(trigger).addEventListener('click', function (event) { if (event.target.closest('a')) setPanel(trigger, false); });
  });
  document.addEventListener('click', function (event) { if (!event.target.closest('.nav-item')) closeAll(); });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    var open = triggers.find(function (t) { return t.getAttribute('aria-expanded') === 'true'; });
    if (open) { setPanel(open, false); open.focus(); }
  });

  // ---- mobile menu ----
  var menuButton = document.querySelector('.menu-button');
  var mobileNav = document.getElementById('mobile-nav');
  if (menuButton && mobileNav) {
    var setOpen = function (open) {
      mobileNav.hidden = !open;
      menuButton.setAttribute('aria-expanded', String(open));
      menuButton.setAttribute('aria-label', open ? 'ปิดเมนู' : 'เปิดเมนู');
    };
    menuButton.addEventListener('click', function () { setOpen(mobileNav.hidden); });
    mobileNav.addEventListener('click', function (event) { if (event.target.closest('a')) setOpen(false); });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !mobileNav.hidden) { setOpen(false); menuButton.focus(); }
    });
  }

  // ---- product walls: the "make your own" card spans the cells left in the last row ----
  var walls = Array.prototype.slice.call(document.querySelectorAll('.prod-wall'));
  function fillWalls() {
    walls.forEach(function (wall) {
      var slot = wall.querySelector('.tpl-create');
      if (!slot) return;
      var cols = getComputedStyle(wall).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
      var cells = wall.children.length; // every card takes one cell, the slot included
      slot.style.setProperty('--slot', 1 + (cols - (cells % cols)) % cols);
    });
  }
  if (walls.length) {
    fillWalls();
    var wallTimer = 0;
    window.addEventListener('resize', function () { clearTimeout(wallTimer); wallTimer = setTimeout(fillWalls, 100); });
  }

  // ---- rail arrows ----
  document.querySelectorAll('.rail-arrow').forEach(function (button) {
    button.addEventListener('click', function () {
      var rail = document.getElementById(button.dataset.rail);
      if (!rail) return;
      var card = rail.querySelector('.tpl');
      var step = card ? card.getBoundingClientRect().width + 18 : 260;
      rail.scrollBy({ left: step * 2 * Number(button.dataset.direction), behavior: reduced ? 'auto' : 'smooth' });
    });
  });

  // ---- sample videos: nothing downloads until a card is near the screen ----
  var videos = Array.prototype.slice.call(document.querySelectorAll('video[data-autoplay], video[autoplay]'));
  if (reduced) {
    videos.forEach(function (v) { v.removeAttribute('autoplay'); v.pause(); });
  } else if ('IntersectionObserver' in window) {
    var videoObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var v = entry.target;
        if (entry.isIntersecting) { v.play().catch(function () {}); } else { v.pause(); }
      });
    }, { threshold: 0.35 });
    videos.forEach(function (v) { videoObserver.observe(v); });
  }

  // ---- reel sound: AI clips carry their own Thai audio; one clip is heard at a time ----
  var soundButtons = Array.prototype.slice.call(document.querySelectorAll('.reel-sound'));
  function setSound(button, on) {
    var v = button.parentNode.querySelector('video');
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.setAttribute('aria-label', button.getAttribute('aria-label').replace(/^(เปิด|ปิด)/, on ? 'ปิด' : 'เปิด'));
    if (!v) return;
    v.muted = !on;
    if (on) { v.currentTime = 0; v.play().catch(function () {}); }
  }
  soundButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      var on = button.getAttribute('aria-pressed') !== 'true';
      soundButtons.forEach(function (b) { if (b !== button && b.getAttribute('aria-pressed') === 'true') setSound(b, false); });
      setSound(button, on);
    });
  });

  // ---- chat demos: reveal messages one by one when the card scrolls into view ----
  var chats = Array.prototype.slice.call(document.querySelectorAll('[data-chat]'));
  function playChat(card) {
    var lines = Array.prototype.slice.call(card.querySelectorAll('.chat-log li'));
    lines.forEach(function (li) { li.classList.add('is-pending'); });
    lines.forEach(function (li, i) {
      setTimeout(function () { li.classList.remove('is-pending'); }, 450 + i * 900);
    });
  }
  if (!reduced && 'IntersectionObserver' in window) {
    var chatObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        chatObserver.unobserve(entry.target);
        playChat(entry.target);
      });
    }, { threshold: 0.5 });
    chats.forEach(function (card) { chatObserver.observe(card); });
  }
})();

// ---- social showcase: filter the wall by platform ----
(function () {
  'use strict';
  var buttons = Array.prototype.slice.call(document.querySelectorAll('.platform-filter button'));
  var posts = Array.prototype.slice.call(document.querySelectorAll('.social-grid .post'));
  buttons.forEach(function (button) {
    button.addEventListener('click', function () {
      var filter = button.dataset.filter;
      buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b === button)); });
      posts.forEach(function (post) {
        var show = filter === 'all' || post.dataset.platform === filter;
        post.hidden = !show;
        var video = post.querySelector('video');
        if (video && !show) video.pause();
      });
    });
  });
})();

// ---- pricing: switch monthly / yearly figures ----
(function () {
  'use strict';
  var buttons = Array.prototype.slice.call(document.querySelectorAll('.billing-toggle button'));
  buttons.forEach(function (button) {
    button.addEventListener('click', function () {
      var mode = button.dataset.billing;
      buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b === button)); });
      document.querySelectorAll('.plan [data-monthly]').forEach(function (el) { el.textContent = el.dataset[mode]; });
      // Carry the chosen billing period to the checkout page.
      document.querySelectorAll('.plan-cta[data-plan]').forEach(function (a) { a.href = '/app/billing/?plan=' + a.dataset.plan + '&period=' + mode; });
    });
  });
})();

// ---- pricing: live names, prices and credits from /api/plans (edited in /admin/system/) ----
// The HTML keeps today's figures as the fallback; a plan taken off sale is hidden, a new one is added.
(function () {
  'use strict';
  var grid = document.querySelector('#pricing .plan-grid');
  if (!grid || !window.fetch) return;
  var baht = function (n) { return Math.round(n).toLocaleString('en-US'); };
  function fill(article, plan) {
    article.querySelector('h3').textContent = plan.name;
    var amount = article.querySelector('.amount');
    amount.dataset.monthly = baht(plan.monthly);
    amount.dataset.yearly = baht(plan.yearly / 12);
    article.querySelector('.plan-bill').dataset.yearly = 'ชำระ ฿' + baht(plan.yearly) + ' ต่อปี';
    var credits = article.querySelector('li b');
    if (credits) credits.textContent = plan.monthlyCredits.toLocaleString('en-US') + ' เครดิต';
    article.querySelectorAll('li').forEach(function (li) {
      if (!li.querySelector('*') && /ครั้งละ \d+ งาน/.test(li.textContent)) li.textContent = li.textContent.replace(/ครั้งละ \d+ งาน/, 'ครั้งละ ' + plan.parallelJobs + ' งาน');
    });
    var cta = article.querySelector('.plan-cta');
    cta.dataset.plan = plan.id;
  }
  fetch('/api/plans', { headers: { Accept: 'application/json' } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
    if (!data || !Array.isArray(data.plans) || !data.plans.length) return;
    var byId = {};
    data.plans.forEach(function (p) { byId[p.id] = p; });
    var articles = Array.prototype.slice.call(grid.querySelectorAll('.plan'));
    var template = grid.querySelector('.plan:not(.plan-featured)');
    articles.forEach(function (article) {
      var id = article.querySelector('.plan-cta').dataset.plan;
      if (byId[id]) { fill(article, byId[id]); delete byId[id]; } else article.style.display = 'none'; // .plan sets display, so not [hidden]
    });
    // Packages added in the panel get a card in price order, with the basics they include.
    data.plans.forEach(function (plan) {
      if (!byId[plan.id] || !template) return;
      var card = template.cloneNode(true);
      card.querySelector('.plan-for').textContent = 'แพ็กเกจ ' + plan.name;
      card.querySelector('ul').innerHTML = '<li><b></b>ต่อเดือน</li><li>คลิปรีวิว affiliate + เสียงพากย์ไทย</li><li>สร้างได้ครั้งละ 1 งาน</li>';
      fill(card, plan);
      grid.appendChild(card);
    });
    var pressed = document.querySelector('.billing-toggle [aria-pressed="true"]');
    var mode = pressed ? pressed.dataset.billing : 'monthly';
    grid.querySelectorAll('.plan [data-monthly]').forEach(function (el) { el.textContent = el.dataset[mode]; });
    grid.querySelectorAll('.plan-cta[data-plan]').forEach(function (a) { a.href = '/app/billing/?plan=' + a.dataset.plan + '&period=' + mode; });
  }).catch(function () { /* keep the built-in figures */ });
})();
