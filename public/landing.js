// Landing page behavior: mobile menu, template rail arrows, and videos that only
// play while on screen (and not at all for reduced motion).
(function () {
  'use strict';

  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

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

  var rail = document.querySelector('.rail');
  document.querySelectorAll('.rail-arrow').forEach(function (button) {
    button.addEventListener('click', function () {
      if (!rail) return;
      var card = rail.querySelector('.tpl');
      var step = card ? card.getBoundingClientRect().width + 18 : 280;
      rail.scrollBy({ left: step * Number(button.dataset.direction), behavior: 'smooth' });
    });
  });

  var videos = Array.prototype.slice.call(document.querySelectorAll('video[autoplay]'));
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  function pauseAll() { videos.forEach(function (v) { v.pause(); }); }
  if (reduced.matches) {
    pauseAll();
  } else if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) entry.target.play().catch(function () {});
        else entry.target.pause();
      });
    }, { threshold: 0.2 });
    videos.forEach(function (v) { observer.observe(v); });
  }
  reduced.addEventListener && reduced.addEventListener('change', function (e) { if (e.matches) pauseAll(); });
})();
