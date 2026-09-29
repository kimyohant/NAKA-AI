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
