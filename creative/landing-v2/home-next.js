(() => {
  const menu = document.querySelector('.menu-button');
  const mobileNav = document.querySelector('#mobile-nav');
  const videos = [...document.querySelectorAll('.sample-video')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const toggle = document.querySelector('.video-toggle');

  menu?.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'ปิดเมนู' : 'เปิดเมนู');
    mobileNav.hidden = !open;
  });
  mobileNav?.addEventListener('click', event => {
    if (event.target.closest('a')) {
      mobileNav.hidden = true;
      menu.setAttribute('aria-expanded', 'false');
      menu.setAttribute('aria-label', 'เปิดเมนู');
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
  document.querySelector('#year').textContent = new Date().getFullYear();
})();
