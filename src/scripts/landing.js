(function () {
  var root = document.documentElement;

  /* ---------- Sky toggle: sunrise → day → sunset → night ---------- */
  var ORDER = ['sunrise', 'day', 'sunset', 'night'];
  var LABEL = { sunrise: 'Sunrise', day: 'Day', sunset: 'Sunset', night: 'Night' };
  var BAR = { sunrise: '#93acd9', day: '#a8d8f0', sunset: '#5a6aa6', night: '#070d24' };
  var btn = document.querySelector('.theme-toggle');
  var meta = document.querySelector('meta[name="theme-color"]');

  function next(t) { return ORDER[(ORDER.indexOf(t) + 1) % ORDER.length]; }

  function sync() {
    var t = root.dataset.theme;
    btn.querySelector('.label').textContent = LABEL[t];
    btn.setAttribute('aria-label', 'Sky: ' + LABEL[t] + '. Switch to ' + LABEL[next(t)]);
    btn.title = 'Switch to ' + LABEL[next(t)].toLowerCase();
    meta.setAttribute('content', BAR[t]);
  }

  btn.addEventListener('click', function () {
    var t = next(root.dataset.theme);
    root.dataset.theme = t;
    try { localStorage.setItem('sky', t); } catch (e) { /* private mode */ }
    sync();
  });
  sync();

  /* ---------- Star field: random dots drawn with box-shadow ---------- */
  function starfield(el, n) {
    var s = [];
    for (var i = 0; i < n; i++) {
      var x = (Math.random() * 100).toFixed(2);
      var y = (Math.random() * 62).toFixed(2); // keep stars above the hills
      var a = (0.4 + Math.random() * 0.6).toFixed(2);
      s.push(x + 'vw ' + y + 'vh 0 0 rgba(255,255,255,' + a + ')');
    }
    el.style.boxShadow = s.join(',');
  }
  starfield(document.querySelector('.stars'), 140);
  starfield(document.querySelector('.stars2'), 40);

  /* ---------- Shooting stars: move to a new random spot after every pass ---------- */
  function place(wrap) {
    // stay in the band above the text column / to the right, where the eye wanders
    wrap.style.setProperty('--mx', (5 + Math.random() * 70).toFixed(1) + 'vw');
    wrap.style.setProperty('--my', (3 + Math.random() * 30).toFixed(1) + 'vh');
    wrap.style.setProperty('--ma', (8 + Math.random() * 26).toFixed(1) + 'deg');
  }
  document.querySelectorAll('.meteor').forEach(function (m) {
    place(m.parentNode);
    m.addEventListener('animationiteration', function () { place(m.parentNode); });
  });
})();
