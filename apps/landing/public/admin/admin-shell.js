// The back office shell, shared by every /admin/ page (styles in /admin/admin.css):
// - one navigation list rendered twice: a sidebar on desktop, a top bar + bottom tab bar on phones. It is
//   built here from NAV, so the four pages can never drift apart, and it shows only once the page has
//   signed in (the page's #app is visible).
// - generic tabs: [data-adm-tabs] holding a [role="tablist"] of [role="tab"][aria-controls] buttons. Arrow keys
//   move between tabs; the last tab is remembered for this tab of the browser.
// - [data-adm-who]: an empty account chip filled from /api/admin/me (pages that do not show one themselves).
// Page scripts keep their own sign-in and data logic; nothing here talks to their state.
(function () {
  'use strict';
  var TOKEN_KEY = 'naka_admin_customers'; // the break-glass token, shared by all back-office pages (this tab only)
  var ICONS = {
    customers: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    system: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>',
    studio: '<rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M6 7h.01"/><path d="M6 17h.01"/>',
    bot: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 10h.01"/><path d="M12 10h.01"/><path d="M16 10h.01"/>',
  };
  var NAV = [
    { href: '/admin/customers/', label: 'ลูกค้า', long: 'จัดการลูกค้า', icon: 'customers' },
    { href: '/admin/system/', label: 'ตั้งค่าระบบ', long: 'ตั้งค่าระบบ', icon: 'system' },
    { href: '/admin/studio-system/', label: 'ระบบ Studio', long: 'ระบบ Studio', icon: 'studio' },
    { href: '/admin/', label: 'บอท LINE', long: 'บอทขายของ LINE', icon: 'bot' },
  ];

  function svg(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  }
  function el(tag, attrs, html) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (html != null) node.innerHTML = html;
    return node;
  }
  var path = location.pathname.replace(/index\.html$/, '');
  var current = NAV.find(function (item) { return item.href === '/admin/' ? path === '/admin/' : path.indexOf(item.href) === 0; }) || null;
  function link(item, long) {
    var a = el('a', { href: item.href }, svg(item.icon) + '<span>' + (long ? item.long : item.label) + '</span>');
    if (item === current) a.setAttribute('aria-current', 'page');
    return a;
  }

  function buildShell() {
    var side = el('aside', { class: 'adm-side', 'aria-label': 'หลังร้าน naka-ai' });
    side.append(el('a', { class: 'adm-brand', href: '/admin/customers/' },
      '<img src="/logo.svg?v=4" alt="" width="30" height="30"><span>naka-ai<small>หลังร้าน</small></span>'));
    var nav = el('nav', { class: 'adm-nav', 'aria-label': 'เมนูหลังร้าน' });
    NAV.forEach(function (item) { nav.append(link(item, true)); });
    side.append(nav, el('div', { class: 'adm-side-foot' }, '<a href="/" target="_blank" rel="noopener">ดูหน้าเว็บ naka-ai ↗</a>'));

    var top = el('header', { class: 'adm-topbar' },
      '<img src="/logo.svg?v=4" alt="" width="28" height="28"><b>naka-ai</b><span>หลังร้าน</span>');
    var bar = el('nav', { class: 'adm-tabbar', 'aria-label': 'เมนูหลังร้าน' });
    NAV.forEach(function (item) { bar.append(link(item, false)); });

    // after the skip link, so it stays the first thing a keyboard reaches
    var skip = document.querySelector('.skip-link');
    if (skip) skip.after(side, top); else document.body.prepend(side, top);
    document.body.append(bar);
    var main = document.querySelector('main');
    if (main) main.classList.add('adm-main');
  }

  // the menus appear once the page is signed in: its #app shows (hidden attribute or .hidden class)
  function watchSignIn() {
    var app = document.getElementById('app');
    if (!app) return;
    var sync = function () {
      var shown = !app.hidden && !app.classList.contains('hidden');
      document.body.classList.toggle('adm-in', shown);
      if (shown) fillWho();
    };
    new MutationObserver(sync).observe(app, { attributes: true, attributeFilter: ['hidden', 'class'] });
    sync();
  }

  var whoLoaded = false;
  function fillWho() {
    var chip = document.querySelector('[data-adm-who]');
    if (!chip || whoLoaded) return;
    whoLoaded = true;
    var token = '';
    try { token = sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { /* storage unavailable */ }
    fetch('/api/admin/me', { cache: 'no-store', headers: token ? { Authorization: 'Bearer ' + token } : {} })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (me) {
        if (!me) { whoLoaded = false; return; }
        chip.textContent = me.kind === 'token' ? 'เข้าด้วยโทเคนฉุกเฉิน' : 'เข้าระบบเป็น ' + me.label;
        chip.className = 'who' + (me.kind === 'token' ? ' token' : '');
      })
      .catch(function () { whoLoaded = false; });
  }

  // ---------- generic tabs ----------
  function setupTabs(root) {
    var list = root.querySelector('[role="tablist"]');
    if (!list) return;
    var tabs = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]'));
    var key = 'adm-tab:' + location.pathname + ':' + (root.id || root.getAttribute('data-adm-tabs'));
    function select(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        var panel = document.getElementById(t.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
      if (focus) tab.focus();
      try { sessionStorage.setItem(key, tab.id); } catch (e) { /* this visit only */ }
    }
    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { select(tab, false); });
      tab.addEventListener('keydown', function (event) {
        var step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (event.key === 'Home') { event.preventDefault(); select(tabs[0], true); }
        else if (event.key === 'End') { event.preventDefault(); select(tabs[tabs.length - 1], true); }
        else if (step) { event.preventDefault(); select(tabs[(i + step + tabs.length) % tabs.length], true); }
      });
    });
    var saved = null;
    try { saved = document.getElementById(sessionStorage.getItem(key) || ''); } catch (e) { /* storage unavailable */ }
    select(tabs.indexOf(saved) >= 0 ? saved : tabs.find(function (t) { return t.getAttribute('aria-selected') === 'true'; }) || tabs[0], false);
  }

  // a fade on the right edge of a tab row only while it really overflows
  function markOverflow() {
    document.querySelectorAll('.adm-tabs-wrap').forEach(function (wrap) {
      var list = wrap.querySelector('.tabs, [role="tablist"]');
      if (!list) return;
      var update = function () { wrap.classList.toggle('is-overflowing', list.scrollWidth - list.clientWidth - list.scrollLeft > 4); };
      list.addEventListener('scroll', update, { passive: true });
      window.addEventListener('resize', update);
      update();
    });
  }

  function start() {
    buildShell();
    document.querySelectorAll('[data-adm-tabs]').forEach(setupTabs);
    markOverflow();
    watchSignIn();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
