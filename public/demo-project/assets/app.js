// Counts the hero stats up once the page is visible.
(function () {
  var nodes = document.querySelectorAll('[data-count]');
  var start = performance.now();
  var duration = 1100;
  function format(n) {
    return n >= 1000 ? Math.round(n / 1000) + 'k' : String(Math.round(n));
  }
  function tick(now) {
    var t = Math.min(1, (now - start) / duration);
    var eased = 1 - Math.pow(1 - t, 3);
    nodes.forEach(function (node) {
      node.textContent = format(Number(node.getAttribute('data-count')) * eased);
    });
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
