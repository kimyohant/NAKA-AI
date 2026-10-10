// The current announcement from the back office (GET /api/announcement, src/content/announcements.ts), shown as one
// line at the top of the page. Closing it hides that announcement in this browser; a new one shows again.
// /account-menu.js loads it on the pages customers use (home, /app/, login). It never breaks a page: any failure = no banner.
(function () {
  'use strict';
  var KEY = 'naka_announce_closed';
  function closed() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function remember(id) { try { localStorage.setItem(KEY, id); } catch (e) { /* this visit only */ } }
  var TONE = { info: ['#eef4ff', '#15264a', '#235be8'], promo: ['#fff4db', '#4a3200', '#8a5a00'], warning: ['#fbe7e5', '#5c140d', '#b42318'] };

  function show(a) {
    var tone = TONE[a.tone] || TONE.info;
    var bar = document.createElement('div');
    bar.className = 'naka-announce';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'ประกาศ');
    bar.style.cssText = 'position:relative;z-index:40;display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;' +
      'padding:8px 52px 8px 16px;background:' + tone[0] + ';color:' + tone[1] + ';border-bottom:1px solid rgba(0,0,0,.08);' +
      'font:500 14px/1.5 Anuphan,"Sarabun",system-ui,sans-serif;text-align:center';
    var text = document.createElement('span');
    text.textContent = a.message;
    bar.append(text);
    if (a.linkUrl) {
      var link = document.createElement('a');
      link.href = a.linkUrl; link.textContent = a.linkLabel || 'ดูรายละเอียด';
      if (/^https:\/\//.test(a.linkUrl) && new URL(a.linkUrl).origin !== location.origin) { link.target = '_blank'; link.rel = 'noopener'; }
      link.style.cssText = 'color:' + tone[2] + ';font-weight:700;text-underline-offset:3px';
      bar.append(link);
    }
    var close = document.createElement('button');
    close.type = 'button'; close.setAttribute('aria-label', 'ปิดประกาศ'); close.textContent = '×';
    close.style.cssText = 'position:absolute;right:4px;top:50%;transform:translateY(-50%);width:44px;height:44px;border:0;background:none;' +
      'color:inherit;font-size:22px;line-height:1;cursor:pointer';
    close.addEventListener('click', function () { remember(a.id); bar.remove(); });
    bar.append(close);
    // after a skip link, so that stays the first thing a keyboard reaches
    var skip = document.querySelector('body > .skip-link, body > a[href="#main"]');
    if (skip) skip.after(bar); else document.body.prepend(bar);
  }

  function start() {
    fetch('/api/announcement', { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (body) { var a = body && body.announcement; if (a && a.id !== closed()) show(a); })
      .catch(function () { /* no banner */ });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
