// Clip library on the home page (#reel, markup from creative/unsloth-reel/build-reel.cjs).
// Tabs filter the cards by product; only the first rows show until "ดูอีก N คลิป" is pressed,
// so the page stays short on a phone. #p-review, #p-drama, #p-live and #p-bot open their tab.
(function () {
  'use strict';
  var root = document.querySelector('[data-gallery]');
  if (!root) return;
  var tabs = Array.prototype.slice.call(root.querySelectorAll('[data-tab]'));
  var panels = Array.prototype.slice.call(root.querySelectorAll('[data-panel]'));
  var cards = Array.prototype.slice.call(root.querySelectorAll('.g-grid > .g-card'));
  var more = root.querySelector('[data-more]');
  var moreCount = root.querySelector('[data-more-count]');
  var phone = window.matchMedia('(max-width: 760px)');
  var current = 'all';
  var expanded = false;

  function limit() {
    if (expanded) return Infinity;
    return phone.matches ? 6 : 10;
  }

  function render() {
    var shown = 0;
    var total = 0;
    cards.forEach(function (card) {
      var match = current === 'all' || card.getAttribute('data-cat') === current;
      if (match) total++;
      var visible = match && shown < limit();
      if (visible) shown++;
      card.hidden = !visible;
      if (!visible) {
        var v = card.querySelector('video');
        if (v) v.pause();
      }
    });
    if (more) {
      more.hidden = total - shown <= 0;
      if (moreCount) moreCount.textContent = String(total - shown);
    }
    tabs.forEach(function (t) { t.setAttribute('aria-pressed', t.getAttribute('data-tab') === current ? 'true' : 'false'); });
    panels.forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== current; });
  }

  function select(id) {
    if (!tabs.some(function (t) { return t.getAttribute('data-tab') === id; })) return;
    current = id;
    expanded = false;
    render();
  }

  tabs.forEach(function (t) {
    t.addEventListener('click', function () { select(t.getAttribute('data-tab')); });
  });
  if (more) {
    more.addEventListener('click', function () {
      var firstHidden = cards.filter(function (c) { return c.hidden && (current === 'all' || c.getAttribute('data-cat') === current); })[0];
      expanded = true;
      render();
      var link = firstHidden && firstHidden.querySelector('a, button');
      if (link) link.focus({ preventScroll: true });
    });
  }

  function fromHash() {
    var m = /^#p-(review|drama|live|bot)$/.exec(location.hash);
    if (m) select(m[1]);
  }
  window.addEventListener('hashchange', fromHash);
  if (phone.addEventListener) phone.addEventListener('change', render);
  else if (phone.addListener) phone.addListener(render);
  render();
  root.setAttribute('data-ready', '');
  fromHash();
})();
