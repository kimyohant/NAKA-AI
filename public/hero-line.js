// Full-width hero "Naka line" (styles in hero-line.css). Every position is a pure function of the
// clock, so one requestAnimationFrame loop drives the belt, items, machine light and arms. The loop
// stops while the hero is offscreen or the tab is hidden; reduced motion draws one still frame.
(function () {
  'use strict';

  var hero = document.querySelector('.hero-line');
  if (!hero) return;
  var scene = hero.querySelector('.hl-scene');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var conn = navigator.connection || {};
  var lightData = conn.saveData || /2g/.test(conn.effectiveType || '');

  // What comes out of the machine. Videos are real samples on the site; live and bot use their card art.
  var KINDS = [
    { tag: 'คลิปรีวิว', video: '/assets/hero/hero-review.mp4', poster: '/assets/hero/hero-review.jpg' },
    { tag: 'ละครสั้น AI', video: '/assets/hero/hero-drama-01.mp4', poster: '/assets/hero/hero-drama-01.jpg' },
    { tag: 'AI Live', img: '/assets/card-live.jpg', extra: '<span class="hl-badge">LIVE</span>' },
    { tag: 'ละครสั้น AI', video: '/assets/hero/hero-drama-03.mp4', poster: '/assets/hero/hero-drama-03.jpg' },
    { tag: 'แชทบอท', img: '/assets/card-bot.jpg', extra: '<p class="hl-bubble me">ก้อนละกี่กรัมคะ</p><p class="hl-bubble bot">100 กรัมค่ะ</p>' },
    { tag: 'ละครสั้น AI', video: '/assets/hero/hero-drama-05.mp4', poster: '/assets/hero/hero-drama-05.jpg' }
  ];
  var ICONS = {
    TikTok: '<svg viewBox="0 0 48 48"><path d="M30 6c1 5 4 8 9 8.5v7c-3.4 0-6.4-1-9-2.8V32a11 11 0 1 1-11-11c.7 0 1.4 0 2 .2v7.3a4 4 0 1 0 2 3.5V6z" fill="#0d1b33"/><path d="M30 6c1 5 4 8 9 8.5" fill="none" stroke="#14b3d6" stroke-width="2.5"/></svg>',
    Facebook: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="#2459d6"/><path d="M26.5 38V26h4l.6-4.6h-4.6v-3c0-1.3.4-2.2 2.3-2.2h2.4v-4.1c-.4 0-1.9-.2-3.5-.2-3.5 0-5.8 2.1-5.8 6v3.5h-3.9V26h3.9v12z" fill="#fff"/></svg>',
    Instagram: '<svg viewBox="0 0 48 48"><rect x="6" y="6" width="36" height="36" rx="11" fill="none" stroke="#c13584" stroke-width="4"/><circle cx="24" cy="24" r="8" fill="none" stroke="#c13584" stroke-width="4"/><circle cx="34.5" cy="13.5" r="2.5" fill="#c13584"/></svg>',
    Shopee: '<svg viewBox="0 0 48 48"><path d="M9 16h30l-2.2 24a3 3 0 0 1-3 2.7H14.2a3 3 0 0 1-3-2.7z" fill="#ee4d2d"/><path d="M17 16a7 7 0 0 1 14 0" fill="none" stroke="#ee4d2d" stroke-width="3.2"/><path d="M28 24.5c-1-1-2.3-1.5-3.9-1.5-2.2 0-3.6 1.1-3.6 2.7 0 3.7 7.7 2.2 7.7 6.2 0 1.8-1.7 3-4.1 3-1.8 0-3.4-.7-4.4-1.8" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>'
  };

  // ---------- build ----------
  var belt = scene.querySelector('.hl-belt');
  var rollers = scene.querySelector('.hl-rollers');
  var machine = scene.querySelector('.hl-machine');
  var naka = scene.querySelector('.hl-naka');
  var backLayer = scene.querySelector('[data-hl-back]');
  var itemLayer = scene.querySelector('[data-hl-items]');
  var frontLayer = scene.querySelector('[data-hl-front]');

  var G = {}; // geometry, recomputed on resize
  var items = [];
  var bins = [];

  function screenHtml(kind) {
    var media = kind.video
      ? '<video muted loop playsinline preload="none" disablepictureinpicture poster="' + kind.poster + '" data-src="' + kind.video + '"></video>'
      : '<img src="' + kind.img + '" alt="" loading="lazy" decoding="async">';
    return '<span class="hl-tag">' + kind.tag + '</span><div class="hl-screen">' + media + (kind.extra || '') + '</div>';
  }

  function buildBins(names) {
    backLayer.innerHTML = ''; frontLayer.innerHTML = ''; bins = [];
    names.forEach(function (name) {
      var back = document.createElement('div'); back.className = 'hl-binback';
      var front = document.createElement('div'); front.className = 'hl-binfront';
      front.innerHTML = ICONS[name] + '<span>' + name + '</span>';
      backLayer.appendChild(back); frontLayer.appendChild(front);
      bins.push({ back: back, front: front, x: 0 });
    });
  }

  function buildItems(n) {
    itemLayer.innerHTML = ''; items = [];
    for (var i = 0; i < n; i++) {
      var el = document.createElement('div');
      el.className = 'hl-item';
      var kind = KINDS[i % KINDS.length];
      el.innerHTML = '<div class="hl-box"><img src="/assets/soap-640.jpg" alt="" decoding="async"></div><div class="hl-phone">' + screenHtml(kind) + '</div>';
      itemLayer.appendChild(el);
      items.push({ el: el, video: el.querySelector('video'), phone: null, playing: false, bin: 0 });
    }
  }

  function layout() {
    var W = scene.clientWidth;
    var k = W >= 1200 ? 1 : Math.max(.56, W / 1200);
    scene.style.setProperty('--k', k.toFixed(4));
    hero.style.setProperty('--ka', Math.min(1, Math.max(.7, W / 1500)).toFixed(4));
    var names = W < 700 ? ['TikTok', 'Shopee'] : ['TikTok', 'Facebook', 'Instagram', 'Shopee'];
    if (bins.length !== names.length) buildBins(names);
    var binW = 108 * k, gap = 12 * k;
    var binsStart = W - 24 * k - names.length * binW - (names.length - 1) * gap;
    bins.forEach(function (b, i) {
      b.x = binsStart + i * (binW + gap) + binW / 2;
      b.back.style.left = b.front.style.left = (b.x - binW / 2) + 'px';
    });
    var mx = Math.max(W * .22, 120 * k);
    machine.style.left = (mx - 130 * k) + 'px'; // housing centred on mx
    var beltEnd = binsStart - 30 * k;
    belt.style.width = (beltEnd + 20 * k) + 'px';
    var spacing = (W < 700 ? 230 : 190) * k;
    var start = -90 * k;
    var hopMax = bins[bins.length - 1].x - beltEnd + 80 * k;
    var drop = 220 * k;
    var n = Math.ceil((beltEnd - start + hopMax + drop + 60 * k) / spacing);
    G = { W: W, k: k, mx: mx, beltEnd: beltEnd, beltY: 300 * k, spacing: spacing, start: start, drop: drop, L: n * spacing, speed: 62 * k };
    if (items.length !== n) buildItems(n);
    items.forEach(function (it, i) { it.bin = i % bins.length; });
  }

  // ---------- motion ----------
  function eio(p) { return p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
  function ei(p) { return p * p; }
  // Hermite ease: leaves at slope a (so the hop keeps the belt's speed) and lands with zero speed.
  function hop(u, a) { return a * u + (3 - 2 * a) * u * u + (a - 2) * u * u * u; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  var xs = [];
  function placeItems(t) {
    var glow = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var p = ((t * G.speed + i * G.spacing) % G.L + G.L) % G.L;
      var x = G.start + p, y = G.beltY, r = 0, visible = true;
      var bin = bins[it.bin];
      if (x > G.beltEnd) {
        // hop from the belt end into the target bin, then drop below its front panel
        var s = x - G.beltEnd, span = bin.x - G.beltEnd, len = span + 80 * G.k;
        if (s < len) {
          var u = s / len;
          x = G.beltEnd + span * hop(u, len / span);
          y = G.beltY - 100 * G.k * Math.sin(Math.PI * Math.min(1, u * 1.15) * .5);
          r = 9 * Math.sin(Math.PI * u);
        } else {
          var d = Math.min(1, (s - len) / G.drop);
          x = bin.x;
          y = G.beltY - 100 * G.k + 340 * G.k * ei(d);
          visible = d < 1;
        }
      }
      var isPhone = x > G.mx;
      if (isPhone !== it.phone) { it.phone = isPhone; it.el.classList.toggle('is-phone', isPhone); }
      // emergence from the exit portal: 0 inside the machine, 1 once the phone is fully out
      var e = Math.round(clamp01((x - G.mx - 110 * G.k) / (110 * G.k)) * 100) / 100;
      if (e !== it.e) { it.e = e; it.el.style.setProperty('--e', e); }
      xs[i] = x;
      it.el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)' + (r ? ' rotate(' + r.toFixed(2) + 'deg)' : '');
      it.el.style.visibility = visible ? 'visible' : 'hidden';
      var dx = (x - G.mx) / (70 * G.k);
      glow = Math.max(glow, Math.exp(-dx * dx));
      // start decoding while the item is still inside the machine so playback is running when it appears
      syncVideo(it, visible && x > G.mx - 40 * G.k && x < G.W + 60);
    }
    machine.style.setProperty('--glow', glow.toFixed(3));
    drawMachine(t, glow);
  }

  // ---------- machine (SVG, 262 x 330 units, housing centred at x 130) ----------
  // Pearl shell, dark glass with a spinning AI core and HUD, laser-scan portals at both ends.
  var M = null;
  function buildMachine() {
    var dots = '', leds = '', stream = '';
    for (var i = 0; i < 9; i++) leds += '<circle data-led cx="' + (62 + i * 17) + '" cy="250" r="2.2" fill="#5fe0ff"/>';
    for (var j = 0; j < 9; j++) stream += '<circle data-dot r="' + (j % 3 ? 1.4 : 2.1) + '" fill="#9ff0ff"/>';
    var bars = '';
    ['บท', 'เสียง', 'คลิป'].forEach(function (label, b) {
      var y = 136 + b * 16;
      bars += '<text x="150" y="' + (y - 3) + '" font-size="6.8" fill="#bfe9fb">' + label + '</text>' +
        '<rect x="174" y="' + (y - 7.5) + '" width="40" height="4" rx="2" fill="#1a2b5c"/>' +
        '<rect data-bar x="174" y="' + (y - 7.5) + '" width="10" height="4" rx="2" fill="url(#hm-cy)"/>';
    });
    var svg = '<svg class="hl-msvg" viewBox="0 0 262 330">' +
      '<defs>' +
        '<linearGradient id="hm-shell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#eef3fb"/><stop offset="1" stop-color="#d3ddee"/></linearGradient>' +
        '<linearGradient id="hm-shellside" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#dfe7f4"/><stop offset=".5" stop-color="#ffffff"/><stop offset="1" stop-color="#d3ddee"/></linearGradient>' +
        '<linearGradient id="hm-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#13285e"/><stop offset=".6" stop-color="#0a1638"/><stop offset="1" stop-color="#060d24"/></linearGradient>' +
        '<linearGradient id="hm-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5fe0ff"/><stop offset=".5" stop-color="#3d6cf0"/><stop offset="1" stop-color="#5fe0ff"/></linearGradient>' +
        '<linearGradient id="hm-cy" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3d6cf0"/><stop offset="1" stop-color="#5fe0ff"/></linearGradient>' +
        '<radialGradient id="hm-orb" cx=".42" cy=".38" r=".62"><stop offset="0" stop-color="#ffffff"/><stop offset=".3" stop-color="#9ff0ff"/><stop offset=".7" stop-color="#2f8df0"/><stop offset="1" stop-color="#2459d6" stop-opacity="0"/></radialGradient>' +
        '<radialGradient id="hm-under"><stop offset="0" stop-color="#14b3d6" stop-opacity=".55"/><stop offset="1" stop-color="#14b3d6" stop-opacity="0"/></radialGradient>' +
        '<linearGradient id="hm-laser" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5fe0ff" stop-opacity="0"/><stop offset=".5" stop-color="#d8fbff"/><stop offset="1" stop-color="#5fe0ff" stop-opacity="0"/></linearGradient>' +
        '<linearGradient id="hm-exit" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#14b3d6" stop-opacity=".85"/><stop offset="1" stop-color="#c9f3ff"/></linearGradient>' +
        '<pattern id="hm-grid" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" stroke="#5fe0ff" stroke-opacity=".09" stroke-width=".6"/></pattern>' +
        '<filter id="hm-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2"/></filter>' +
        '<clipPath id="hm-panel"><rect x="34" y="104" width="190" height="132" rx="22"/></clipPath>' +
      '</defs>' +
      // underglow on the belt
      '<ellipse class="hl-halo" cx="131" cy="270" rx="122" ry="12" fill="url(#hm-under)"/>' +
      // intake portal (left) with a vertical laser plane and a sweeping scan line
      '<rect x="0" y="146" width="32" height="122" rx="12" fill="url(#hm-shellside)" stroke="#d3ddee"/>' +
      '<rect x="6" y="158" width="20" height="104" rx="7" fill="#050b1f"/>' +
      '<rect data-laser="in" x="11" y="158" width="10" height="104" fill="url(#hm-laser)"/>' +
      '<rect data-scan="in" x="7" y="160" width="18" height="1.6" rx=".8" fill="#9ff0ff"/>' +
      // exit portal (right, full height)
      '<rect x="230" y="60" width="32" height="208" rx="14" fill="url(#hm-shellside)" stroke="#d3ddee"/>' +
      '<rect x="236" y="72" width="20" height="190" rx="8" fill="#050b1f"/>' +
      '<rect class="hl-mexit" x="236" y="72" width="20" height="190" rx="8" fill="url(#hm-exit)"/>' +
      '<rect data-laser="out" x="241" y="72" width="10" height="190" fill="url(#hm-laser)"/>' +
      // housing
      '<rect x="18" y="58" width="222" height="206" rx="30" fill="url(#hm-shell)" stroke="#d3ddee" stroke-width="1.2"/>' +
      '<path d="M48 60.5h162" stroke="#fff" stroke-width="2" stroke-linecap="round"/>' +
      '<rect data-topbar x="66" y="64" width="126" height="3.4" rx="1.7" fill="#5fe0ff"/>' +
      '<rect x="66" y="64" width="126" height="3.4" rx="1.7" fill="#5fe0ff" filter="url(#hm-blur)" opacity=".8"/>' +
      '<image href="/logo.svg?v=4" x="92" y="74" width="22" height="22"/>' +
      '<text x="119" y="91" font-size="15.5" fill="#0d1b33" letter-spacing="-.6">naka-ai</text>' +
      // glass panel
      '<rect x="34" y="104" width="190" height="132" rx="22" fill="url(#hm-glass)"/>' +
      '<g clip-path="url(#hm-panel)">' +
        '<rect x="34" y="104" width="190" height="132" fill="url(#hm-grid)"/>' +
        '<g>' + stream + '</g>' +
        '<circle cx="88" cy="170" r="30" fill="#2f8df0" opacity=".18" filter="url(#hm-blur)"/>' +
        '<g data-ring="a"><circle r="25" fill="none" stroke="#5fe0ff" stroke-width="1.6" stroke-dasharray="10 6"/></g>' +
        '<g data-ring="b"><circle r="33" fill="none" stroke="#3d6cf0" stroke-width="2.4" stroke-dasharray="44 18" stroke-linecap="round"/></g>' +
        '<g data-ring="c"><circle r="41" fill="none" stroke="#9ff0ff" stroke-opacity=".7" stroke-width="1.2" stroke-dasharray="1 5" stroke-linecap="round"/></g>' +
        '<circle data-orb cx="88" cy="170" r="17" fill="url(#hm-orb)"/>' +
        '<line x1="142" y1="116" x2="142" y2="224" stroke="#5fe0ff" stroke-opacity=".18"/>' +
        '<text x="150" y="121" font-size="6.4" fill="#5fe0ff" letter-spacing="1.4">NAKA CORE</text>' + bars +
        '<path data-wave fill="none" stroke="#5fe0ff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="M34 104h90L60 236H34z" fill="#fff" opacity=".045"/>' +
      '</g>' +
      '<rect x="34" y="104" width="190" height="132" rx="22" fill="none" stroke="url(#hm-rim)" stroke-width="1.8" opacity=".85"/>' +
      // base strip with chasing LEDs, then the clamp onto the belt
      '<rect x="50" y="245" width="158" height="10" rx="5" fill="#0b1630"/>' + leds +
      '<rect x="40" y="262" width="182" height="10" rx="5" fill="#0d1b33"/>' +
      '<rect x="56" y="266" width="150" height="1.6" rx=".8" fill="#5fe0ff" opacity=".9"/>' +
      // hover pad for Naka
      '<ellipse cx="130" cy="57" rx="36" ry="6.5" fill="#fff" stroke="#d3ddee"/>' +
      '<ellipse data-pad cx="130" cy="56.5" rx="30" ry="4.2" fill="none" stroke="#5fe0ff" stroke-width="1.6"/>' +
    '</svg>';
    machine.insertAdjacentHTML('afterbegin', svg);
    var one = function (sel) { return machine.querySelector(sel); };
    var all = function (sel) { return Array.prototype.slice.call(machine.querySelectorAll(sel)); };
    M = {
      ra: one('[data-ring="a"]'), rb: one('[data-ring="b"]'), rc: one('[data-ring="c"]'), orb: one('[data-orb]'),
      bars: all('[data-bar]'), wave: one('[data-wave]'), dots: all('[data-dot]'), leds: all('[data-led]'),
      topbar: one('[data-topbar]'), pad: one('[data-pad]'),
      lin: one('[data-laser="in"]'), lout: one('[data-laser="out"]'), scan: one('[data-scan="in"]')
    };
  }
  // 0..1 while an item is within reach of a portal edge
  function near(edge) {
    var f = 0;
    for (var i = 0; i < xs.length; i++) { var d = Math.abs(xs[i] - edge) / (60 * G.k); if (d < 1) f = Math.max(f, 1 - d); }
    return f;
  }
  function drawMachine(t, glow) {
    if (!M) return;
    M.ra.setAttribute('transform', 'translate(88 170) rotate(' + ((t * 70) % 360).toFixed(1) + ')');
    M.rb.setAttribute('transform', 'translate(88 170) rotate(' + ((-t * 40) % 360).toFixed(1) + ')');
    M.rc.setAttribute('transform', 'translate(88 170) rotate(' + ((t * 16) % 360).toFixed(1) + ')');
    var pulse = 1 + .14 * glow + .05 * Math.sin(t * 3.2);
    M.orb.setAttribute('transform', 'translate(88 170) scale(' + pulse.toFixed(3) + ') translate(-88 -170)');
    for (var b = 0; b < M.bars.length; b++) {
      var p = (t * .32 + b * .27) % 1;
      M.bars[b].setAttribute('width', (4 + 36 * (p < .85 ? p / .85 : 1)).toFixed(1));
    }
    var d = '';
    for (var i = 0; i <= 16; i++) {
      var x = 150 + i * 4, env = Math.sin(Math.PI * i / 16);
      d += (i ? 'L' : 'M') + x + ' ' + (206 + env * (2.5 + 8 * glow) * Math.sin(t * 7 + i * .8)).toFixed(1);
    }
    M.wave.setAttribute('d', d);
    for (var j = 0; j < M.dots.length; j++) {
      var u = ((t * .38 + j / M.dots.length) % 1);
      var dx = 40 + u * 180;
      M.dots[j].setAttribute('cx', dx.toFixed(1));
      M.dots[j].setAttribute('cy', (170 + 13 * Math.sin(u * 7 + j * 1.9)).toFixed(1));
      M.dots[j].setAttribute('opacity', (Math.sin(Math.PI * u) * (.3 + .7 * glow)).toFixed(3));
    }
    var chase = (t * 9) % M.leds.length;
    for (var l = 0; l < M.leds.length; l++) {
      var g = Math.max(0, 1 - Math.abs(l - chase) / 2);
      M.leds[l].setAttribute('opacity', (.22 + .78 * g).toFixed(3));
    }
    M.topbar.setAttribute('opacity', (.55 + .35 * glow + .1 * Math.sin(t * 2.4)).toFixed(3));
    M.pad.setAttribute('opacity', (.5 + .5 * Math.abs(Math.sin(t * 1.6))).toFixed(3));
    var fin = near(G.mx - 120 * G.k), fout = near(G.mx + 120 * G.k);
    M.lin.setAttribute('opacity', (.3 + .7 * fin).toFixed(3));
    M.lout.setAttribute('opacity', (.3 + .7 * fout).toFixed(3));
    M.scan.setAttribute('y', (160 + 99 * ((t * 1.4) % 1)).toFixed(1));
    M.scan.setAttribute('opacity', (.35 + .65 * fin).toFixed(3));
  }

  var videosOn = false;
  function syncVideo(it, want) {
    var v = it.video;
    if (!v) return;
    want = want && videosOn && running;
    if (want === it.playing) return;
    it.playing = want;
    if (want) {
      if (!v.src) v.src = v.getAttribute('data-src');
      var pr = v.play(); if (pr && pr.catch) pr.catch(function () {});
    } else v.pause();
  }

  // ---------- arms ----------
  var arms = [];
  function armSvg(side) {
    var held = side === 'l'
      ? '<rect class="held-box" x="-36" y="0" width="72" height="62" rx="6"/><clipPath id="hl-clip-soap"><circle cx="0" cy="31" r="21"/></clipPath><image href="/assets/soap-640.jpg" x="-21" y="10" width="42" height="42" clip-path="url(#hl-clip-soap)"/><circle cx="0" cy="31" r="21" fill="none" stroke="#fff" stroke-width="3"/>'
      : '<rect class="held-phone" x="-34" y="0" width="68" height="120" rx="12"/><clipPath id="hl-clip-ph"><rect x="-30" y="4" width="60" height="112" rx="9"/></clipPath><image href="/showcase/drama/drama-02.jpg" x="-30" y="4" width="60" height="112" preserveAspectRatio="xMidYMid slice" clip-path="url(#hl-clip-ph)"/>';
    return '<svg class="hl-arm hl-arm-' + side + '" viewBox="0 0 420 400" aria-hidden="true">' +
      (side === 'l' ? '<defs><linearGradient id="hl-shell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#f1f5fc"/><stop offset="1" stop-color="#d9e3f2"/></linearGradient></defs>' : '') +
      '<rect class="mount" x="-60" y="-10" width="96" height="84" rx="14"/>' +
      '<g data-a1><rect class="seg" x="-30" y="-30" width="230" height="60" rx="30"/><line class="seg-line" x1="40" y1="-14" x2="170" y2="-14"/>' +
        '<circle class="joint" r="34"/><circle class="ring" r="21"/><circle class="cap" r="9"/>' +
        '<g data-a2><rect class="seg" x="-24" y="-24" width="190" height="48" rx="24"/><line class="seg-line" x1="34" y1="-11" x2="140" y2="-11"/>' +
          '<circle class="joint" r="29"/><circle class="ring" r="17"/><circle class="cap" r="7"/>' +
          '<g data-a3><circle class="joint" r="22"/><circle class="ring" r="12"/><rect class="claw" x="12" y="-26" width="22" height="52" rx="7"/>' +
            '<g data-ca><rect class="claw" x="0" y="-6" width="44" height="12" rx="6"/></g><g data-cb><rect class="claw" x="0" y="-6" width="44" height="12" rx="6"/></g>' +
            '<g data-held>' + held + '</g>' +
          '</g></g></g></svg>';
  }
  function buildArms() {
    if (window.innerWidth <= 1100) return;
    ['l', 'r'].forEach(function (side) {
      hero.insertAdjacentHTML('afterbegin', armSvg(side));
      var svg = hero.querySelector('.hl-arm-' + side);
      arms.push({ side: side, a1: svg.querySelector('[data-a1]'), a2: svg.querySelector('[data-a2]'), a3: svg.querySelector('[data-a3]'),
        ca: svg.querySelector('[data-ca]'), cb: svg.querySelector('[data-cb]'), held: svg.querySelector('[data-held]') });
    });
  }
  function placeArms(t) {
    arms.forEach(function (a, i) {
      var ph = i * 2.1;
      var a1 = 30 + 7 * Math.sin(t * .7 + ph);
      var a2 = 44 + 12 * Math.sin(t * .7 + ph + 1.1);
      var a3 = 90 - a1 - a2 + 6 * Math.sin(t * 1.3 + ph);
      var grip = 10 + 4 * Math.sin(t * 1.3 + ph + .6);
      a.a1.setAttribute('transform', 'translate(-12,32) rotate(' + a1.toFixed(2) + ')');
      a.a2.setAttribute('transform', 'translate(200,0) rotate(' + a2.toFixed(2) + ')');
      a.a3.setAttribute('transform', 'translate(166,0) rotate(' + a3.toFixed(2) + ')');
      a.ca.setAttribute('transform', 'translate(32,-16) rotate(' + (-grip).toFixed(2) + ')');
      a.cb.setAttribute('transform', 'translate(32,16) rotate(' + grip.toFixed(2) + ')');
      var up = -(a1 + a2 + a3);
      a.held.setAttribute('transform', 'translate(66,0) rotate(' + up.toFixed(2) + ')' + (a.side === 'r' ? ' scale(-1,1)' : ''));
    });
  }

  function draw(t) {
    rollers.style.backgroundPosition = ((t * G.speed) % (46 * G.k)).toFixed(1) + 'px 50%';
    placeItems(t);
    placeArms(t);
    naka.style.transform = 'translateY(' + (-3 * Math.abs(Math.sin(t * 2.2))).toFixed(2) + 'px) rotate(' + (3 * Math.sin(t * 1.1)).toFixed(2) + 'deg)';
  }

  // ---------- loop ----------
  var running = false, raf = 0, clock = 6, last = 0, inView = true;
  function frame(now) {
    if (!running) return;
    clock += Math.min(.05, (now - last) / 1000);
    last = now;
    draw(clock);
    raf = requestAnimationFrame(frame);
  }
  function setRunning(on) {
    on = on && !reduced && inView && !document.hidden;
    if (on === running) return;
    running = on;
    if (on) { last = performance.now(); raf = requestAnimationFrame(frame); }
    else { cancelAnimationFrame(raf); items.forEach(function (it) { syncVideo(it, false); }); }
  }

  buildMachine();
  layout();
  buildArms();
  draw(clock);
  if (reduced) return;

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) { inView = entries[0].isIntersecting; setRunning(true); }).observe(scene);
  }
  document.addEventListener('visibilitychange', function () { setRunning(true); });
  var rt = 0;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { layout(); draw(clock); }, 120); });
  // videos start shortly after first paint (not on window load, which slow assets can hold back), never on save-data or 2g
  if (!lightData) setTimeout(function () { videosOn = true; }, 1200);
  setRunning(true);
})();
