'use strict';
/* Service card artwork drawn on canvas. Shared by the 3D scene (as textures)
   and the service demo panel, so each workflow has one consistent visual. */
(function (root) {
  const FONT = '"Anuphan", "IBM Plex Sans Thai", system-ui, sans-serif';
  const cards = {
    sales: { no: '01', title: 'คลิปขายของ', sub: 'Shopee · Facebook · TikTok · Instagram', hue: ['#2f6bff', '#123a9e'] },
    drama: { no: '02', title: 'ละครสั้น AI', sub: 'พล็อต · บท · ฉาก', hue: ['#2a8bd8', '#0f3f78'] },
    bot:   { no: '03', title: 'บอตช่วยขาย', sub: 'คอมเมนต์ · ข้อความ', hue: ['#4a63f0', '#1c2a8a'] },
    live:  { no: '04', title: 'AI Live', sub: 'บทพิธีกร · ลำดับรายการ', hue: ['#5a55e8', '#231c78'] }
  };

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function glow(ctx, color, blur) { ctx.shadowColor = color; ctx.shadowBlur = blur; }
  function noGlow(ctx) { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; }

  function naga(ctx, cx, cy, s) {
    // Rounded plush face in the same white/cobalt palette as the hero mascot.
    ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
    ctx.fillStyle = '#4d83cc';
    ctx.beginPath(); ctx.moveTo(-24, -28); ctx.quadraticCurveTo(-32, -60, -13, -74); ctx.quadraticCurveTo(-6, -51, 0, -44); ctx.quadraticCurveTo(8, -70, 27, -68); ctx.quadraticCurveTo(23, -45, 16, -32); ctx.fill();
    ctx.fillStyle = '#f6f5f0';
    ctx.beginPath(); ctx.ellipse(0, 0, 44, 39, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d4e5f3';
    ctx.beginPath(); ctx.ellipse(0, 18, 27, 14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#18336e';
    [-16, 16].forEach(ex => { ctx.beginPath(); ctx.ellipse(ex, -4, 6, 10, 0, 0, Math.PI * 2); ctx.fill(); });
    ctx.fillStyle = '#fff';
    [-18, 14].forEach(ex => { ctx.beginPath(); ctx.arc(ex, -8, 2.4, 0, Math.PI * 2); ctx.fill(); });
    ctx.strokeStyle = '#42699e'; ctx.lineWidth = 2.8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, 11, 9, .15, Math.PI - .15); ctx.stroke();
    ctx.fillStyle = '#f1aec0';
    [-30, 30].forEach(ex => { ctx.beginPath(); ctx.ellipse(ex, 12, 5, 3, 0, 0, Math.PI * 2); ctx.fill(); });
    ctx.restore();
  }

  const scenes = {
    sales(ctx, x, y, w, h) {
      // Vertical clip preview with product and play control.
      const pw = h * .62, px = x + (w - pw) / 2;
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, '#dfeaff'); g.addColorStop(1, '#9dbcf5');
      rr(ctx, px, y, pw, h, 26); ctx.fillStyle = g; ctx.fill();
      ctx.save(); rr(ctx, px, y, pw, h, 26); ctx.clip();
      ctx.fillStyle = '#ffffff'; rr(ctx, px + pw * .36, y + h * .34, pw * .28, h * .4, 12); ctx.fill();
      ctx.fillStyle = '#b9c3d4'; rr(ctx, px + pw * .39, y + h * .28, pw * .22, h * .08, 6); ctx.fill();
      ctx.fillStyle = '#2f6bff'; ctx.fillRect(px + pw * .36, y + h * .5, pw * .28, h * .06);
      ctx.fillStyle = '#10256ecc'; ctx.beginPath(); ctx.arc(px + pw / 2, y + h * .55, 34, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(px + pw / 2 - 10, y + h * .55 - 16); ctx.lineTo(px + pw / 2 + 18, y + h * .55); ctx.lineTo(px + pw / 2 - 10, y + h * .55 + 16); ctx.fill();
      ctx.fillStyle = '#10256e40'; ctx.fillRect(px + 22, y + h - 34, pw - 44, 6);
      ctx.fillStyle = '#2f6bff'; ctx.fillRect(px + 22, y + h - 34, (pw - 44) * .62, 6);
      ctx.restore();
      ['#ee4d2d', '#1877f2', '#111111', '#d6249f'].forEach((c, i) => {
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(px + pw + 34, y + 40 + i * 44, 14, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = 3; ctx.stroke();
      });
    },
    drama(ctx, x, y, w, h) {
      // Three scene frames on a film strip.
      const fw = (w - 40) / 3, fh = h * .64, fy = y + h * .16;
      ctx.fillStyle = '#081634'; rr(ctx, x, y, w, h, 20); ctx.fill();
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = '#ffffff30';
        rr(ctx, x + 14 + i * (w - 28) / 14, y + 12, 16, 12, 3); ctx.fill();
        rr(ctx, x + 14 + i * (w - 28) / 14, y + h - 24, 16, 12, 3); ctx.fill();
      }
      const tones = [['#ffd6a8', '#f08a5d'], ['#a8d8ff', '#3b6fd8'], ['#ffc2e0', '#8a4fd8']];
      tones.forEach((t, i) => {
        const fx = x + 10 + i * (fw + 10);
        const g = ctx.createLinearGradient(fx, fy, fx, fy + fh);
        g.addColorStop(0, t[0]); g.addColorStop(1, t[1]);
        rr(ctx, fx, fy, fw, fh, 12); ctx.fillStyle = g; ctx.fill();
        ctx.fillStyle = '#10256ecc';
        ctx.beginPath(); ctx.arc(fx + fw * .38, fy + fh * .52, fh * .12, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(fx + fw * .38 - fh * .1, fy + fh * .62, fh * .2, fh * .38);
        if (i !== 1) { ctx.beginPath(); ctx.arc(fx + fw * .68, fy + fh * .5, fh * .11, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(fx + fw * .68 - fh * .09, fy + fh * .6, fh * .18, fh * .4); }
        ctx.fillStyle = '#fff'; ctx.font = `600 ${Math.round(h * .085)}px ${FONT}`;
        ctx.fillText(`ฉาก ${i + 1}`, fx + 12, fy + h * .1);
      });
    },
    bot(ctx, x, y, w, h) {
      // A real-looking exchange that ends with a human handoff option.
      const bubble = (text, bx, by, bw, mine) => {
        ctx.font = `500 ${Math.round(h * .085)}px ${FONT}`;
        rr(ctx, bx, by, bw, h * .2, 22);
        ctx.fillStyle = mine ? '#2f6bff' : '#ffffff'; ctx.fill();
        ctx.fillStyle = mine ? '#ffffff' : '#10234a';
        ctx.fillText(text, bx + 22, by + h * .13);
      };
      ctx.fillStyle = '#e8f0ff'; ctx.beginPath(); ctx.arc(x + 26, y + h * .12, 22, 0, Math.PI * 2); ctx.fill();
      bubble('ราคาเท่าไรคะ?', x + 60, y + h * .02, w * .5, false);
      naga(ctx, x + w - 30, y + h * .42, .5);
      bubble('กล่องละ 129 บาทค่ะ', x + w * .26, y + h * .32, w * .6, true);
      bubble('ส่งต่อแอดมินได้ทันที', x + 60, y + h * .62, w * .62, false);
      ctx.fillStyle = '#7ff0ff'; [0, 1, 2].forEach(i => { ctx.beginPath(); ctx.arc(x + w * .32 + i * 22, y + h * .93, 7, 0, Math.PI * 2); ctx.fill(); });
    },
    live(ctx, x, y, w, h) {
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, '#2b3aa8'); g.addColorStop(1, '#6b3fd0');
      rr(ctx, x, y, w, h, 22); ctx.fillStyle = g; ctx.fill();
      ctx.save(); rr(ctx, x, y, w, h, 22); ctx.clip();
      const spot = ctx.createRadialGradient(x + w * .55, y + h * .1, 10, x + w * .55, y + h * .6, h);
      spot.addColorStop(0, '#ffffff55'); spot.addColorStop(1, '#ffffff00');
      ctx.fillStyle = spot; ctx.fillRect(x, y, w, h);
      naga(ctx, x + w * .56, y + h * .56, 1.15);
      ctx.fillStyle = '#ffffff'; rr(ctx, x + w * .2, y + h * .55, w * .1, h * .3, 8); ctx.fill();
      ctx.fillStyle = '#b9c3d4'; rr(ctx, x + w * .215, y + h * .5, w * .07, h * .07, 4); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#ff3b5c'; rr(ctx, x + 18, y + 18, 96, 40, 10); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `700 24px ${FONT}`; ctx.fillText('LIVE', x + 36, y + 46);
      ctx.fillStyle = '#ff6b8a';
      [[.86, .72, 1], [.9, .52, .7], [.82, .36, .5]].forEach(([hx, hy, s]) => {
        const cx = x + w * hx, cy = y + h * hy, r = 16 * s;
        ctx.beginPath(); ctx.moveTo(cx, cy + r);
        ctx.bezierCurveTo(cx - r * 2, cy - r * .4, cx - r * .8, cy - r * 1.8, cx, cy - r * .6);
        ctx.bezierCurveTo(cx + r * .8, cy - r * 1.8, cx + r * 2, cy - r * .4, cx, cy + r); ctx.fill();
      });
    }
  };

  /** Draws the card for `key` onto a canvas of any size. */
  function draw(canvas, key, options = {}) {
    const card = cards[key];
    if (!card) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height, u = W / 1024;
    ctx.clearRect(0, 0, W, H);
    ctx.save(); ctx.scale(u, u);
    const w = 1024, h = H / u, pad = 44;
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, card.hue[0]); bg.addColorStop(1, card.hue[1]);
    rr(ctx, 4, 4, w - 8, h - 8, 46); ctx.fillStyle = bg; ctx.fill();
    ctx.save(); rr(ctx, 4, 4, w - 8, h - 8, 46); ctx.clip();
    const sheen = ctx.createLinearGradient(0, 0, w * .7, h);
    sheen.addColorStop(0, '#ffffff38'); sheen.addColorStop(.45, '#ffffff08'); sheen.addColorStop(1, '#ffffff00');
    ctx.fillStyle = sheen; ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = .12; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
    for (let gx = 0; gx < w; gx += 48) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
    for (let gy = 0; gy < h; gy += 48) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.restore();
    rr(ctx, 4, 4, w - 8, h - 8, 46); ctx.lineWidth = 4; ctx.strokeStyle = options.active ? '#bfe6ff' : '#ffffff55'; ctx.stroke();

    ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'alphabetic';
    ctx.font = `600 30px ui-monospace, "SFMono-Regular", Consolas, monospace`;
    ctx.globalAlpha = .7; ctx.fillText(card.no, pad, pad + 34); ctx.globalAlpha = 1;
    ctx.font = `600 64px ${FONT}`; ctx.fillText(card.title, pad, h - pad - 58);
    ctx.font = `500 26px ${FONT}`; ctx.fillStyle = '#dbe8ff'; ctx.fillText(card.sub, pad, h - pad - 12);
    scenes[key](ctx, w * .44, pad + 6, w * .52, h * .58);
    ctx.restore();
  }

  root.NakaCardArt = { cards, draw, keys: Object.keys(cards), fontReady: () =>
    (document.fonts ? Promise.all([document.fonts.load(`600 64px ${FONT}`, 'ก'), document.fonts.load(`500 26px ${FONT}`, 'ก')]).catch(() => {}) : Promise.resolve()) };
})(window);
