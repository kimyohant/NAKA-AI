// Shared glass-nav behavior: settle the bar into its denser tint once the
// page scrolls, so content stays legible behind it on every page.
(function () {
  var nav = document.querySelector('.glass-nav');
  if (!nav) return;
  var ticking = false;
  function update() {
    ticking = false;
    var y = window.scrollY || document.documentElement.scrollTop || 0;
    nav.classList.toggle('is-dense', y > 12);
  }
  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
  update();
})();
