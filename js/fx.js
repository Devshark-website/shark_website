/* SHARK Shop - เอฟเฟกต์อนิเมชัน / Animation effects */
(function () {
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- underwater background: bubbles, sparks, light rays ---- */
  function bg() {
    var c = document.getElementById('bg'); if (!c || reduce) return;
    var x = c.getContext('2d'), W, H, dots = [], sparks = [], t = 0;
    function size() {
      W = c.width = innerWidth; H = c.height = innerHeight;
      var n = Math.round(Math.min(70, W / 22));
      dots = []; for (var i = 0; i < n; i++) dots.push(mk(true));
    }
    function mk(rand) {
      return { x: Math.random() * W, y: rand ? Math.random() * H : H + 20, r: 2 + Math.random() * 7, v: .25 + Math.random() * .9,
               w: Math.random() * 6.28, h: Math.random() < .5 ? 190 : 270 };
    }
    function bolt() {
      var px = Math.random() * W, py = Math.random() * H * .4, pts = [[px, py]];
      for (var i = 0; i < 7; i++) { px += (Math.random() - .5) * 90; py += 30 + Math.random() * 40; pts.push([px, py]); }
      sparks.push({ p: pts, a: 1 });
    }
    function frame() {
      t += .01; x.clearRect(0, 0, W, H);
      for (var k = 0; k < 3; k++) {
        var gx = W * (.2 + k * .3) + Math.sin(t + k) * 80, g = x.createLinearGradient(gx, 0, gx + 160, H);
        g.addColorStop(0, 'rgba(90,140,255,.10)'); g.addColorStop(1, 'rgba(90,140,255,0)');
        x.fillStyle = g; x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx + 120, 0); x.lineTo(gx + 340, H); x.lineTo(gx + 40, H); x.fill();
      }
      dots.forEach(function (d, i) {
        d.y -= d.v; d.x += Math.sin(t * 2 + d.w) * .4;
        if (d.y < -20) dots[i] = mk(false);
        x.beginPath(); x.arc(d.x, d.y, d.r, 0, 6.28);
        x.strokeStyle = 'hsla(' + d.h + ',90%,75%,.55)'; x.lineWidth = 1.2; x.stroke();
        x.fillStyle = 'hsla(' + d.h + ',90%,75%,.08)'; x.fill();
      });
      if (Math.random() < .006) bolt();
      sparks = sparks.filter(function (s) {
        x.beginPath(); s.p.forEach(function (q, i) { i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]); });
        x.strokeStyle = 'rgba(120,235,255,' + s.a + ')'; x.lineWidth = 2; x.shadowColor = '#38e8ff'; x.shadowBlur = 14; x.stroke(); x.shadowBlur = 0;
        s.a -= .035; return s.a > 0;
      });
      requestAnimationFrame(frame);
    }
    addEventListener('resize', size); size(); frame();
  }

  /* ---- ripple on buttons ---- */
  document.addEventListener('pointerdown', function (e) {
    var b = e.target.closest && e.target.closest('.btn'); if (!b || reduce) return;
    var r = b.getBoundingClientRect(), s = Math.max(r.width, r.height), d = document.createElement('span');
    d.className = 'rip'; d.style.cssText = 'width:' + s + 'px;height:' + s + 'px;left:' + (e.clientX - r.left - s / 2) + 'px;top:' + (e.clientY - r.top - s / 2) + 'px';
    b.appendChild(d); setTimeout(function () { d.remove(); }, 650);
  });

  /* ---- 3D tilt + light that follows the pointer ---- */
  document.addEventListener('pointermove', function (e) {
    var c = e.target.closest && e.target.closest('.card'); if (!c || reduce || e.pointerType === 'touch') return;
    var r = c.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    c.style.setProperty('--mx', px * 100 + '%'); c.style.setProperty('--my', py * 100 + '%');
    c.style.transform = 'perspective(700px) rotateX(' + ((.5 - py) * 10) + 'deg) rotateY(' + ((px - .5) * 12) + 'deg) translateY(-6px)';
  });
  document.addEventListener('pointerout', function (e) {
    var c = e.target.closest && e.target.closest('.card'); if (c && !c.contains(e.relatedTarget)) c.style.transform = '';
  });

  /* ---- scroll reveal ---- */
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
  }, { threshold: .12 }) : null;

  window.FX = {
    reveal: function (root) {
      (root || document).querySelectorAll('.rv:not(.in)').forEach(function (el, i) {
        if (!io || reduce) { el.classList.add('in'); return; }
        el.style.transitionDelay = Math.min(i, 12) * 60 + 'ms'; io.observe(el);
      });
    },
    count: function (el, to, ms) {
      if (reduce) { el.textContent = to.toLocaleString(); return; }
      var from = Number(el.dataset.v || 0), t0 = performance.now(); ms = ms || 900;
      (function step(n) {
        var p = Math.min(1, (n - t0) / ms), e = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(from + (to - from) * e).toLocaleString();
        if (p < 1) requestAnimationFrame(step); else el.dataset.v = to;
      })(t0);
    },
    letters: function (el, text) {
      el.innerHTML = ''; text.split('').forEach(function (ch, i) {
        var s = document.createElement('span'); s.textContent = ch; s.style.animationDelay = (.15 + i * .1) + 's'; el.appendChild(s);
      });
    }
  };
  /* ---- intro, confetti, cursor sparkle, mascot helper, ticker ---- */
  function el(tag, cls, st) { var e = document.createElement(tag); if (cls) e.className = cls; if (st) e.style.cssText = st; return e; }
  function dismissIntro() {
    setTimeout(function () {
      var i = document.getElementById('intro');
      if (i) { i.classList.add('off'); setTimeout(function () { i.remove(); }, 700); }
    }, reduce ? 0 : 1300);
  }
  if (document.readyState === 'complete') dismissIntro();
  else window.addEventListener('load', dismissIntro);
  FX.confetti = function () {
    if (reduce) return; var cols = ['#38e8ff', '#a66bff', '#1fb5ff', '#ffffff', '#7a3df0'];
    for (var i = 0; i < 46; i++) {
      var p = el('i', 'cf', 'left:' + (30 + Math.random() * 40) + '%;background:' + cols[i % 5] + ';--dx:' + ((Math.random() - .5) * 700) + 'px;--r:' + (Math.random() * 900) + 'deg;animation-delay:' + (Math.random() * .25) + 's');
      document.body.appendChild(p); setTimeout(function (n) { n.remove(); }.bind(null, p), 2200);
    }
  };
  var lastT = 0;
  document.addEventListener('pointermove', function (e) {
    if (reduce || e.pointerType === 'touch' || Date.now() - lastT < 45) return; lastT = Date.now();
    var s = el('i', 'trl', 'left:' + e.clientX + 'px;top:' + e.clientY + 'px'); document.body.appendChild(s); setTimeout(function () { s.remove(); }, 800);
  });
  var tipI = 0, bubT;
  FX.mate = {
    say: function (m) {
      var b = document.getElementById('mateBub'), txt = document.getElementById('mateBubText'), c = document.getElementById('mateBtn'), w = document.getElementById('chatWin');
      if (!b) return;
      if (txt) txt.textContent = m; else b.textContent = m;
      if (!w || !w.classList.contains('open')) b.classList.add('on');
      if (c) { c.classList.remove('hop'); void c.offsetWidth; c.classList.add('hop'); }
      clearTimeout(bubT);
      bubT = setTimeout(function () {
        if (txt && window.I18N) txt.textContent = I18N.t('mateDesc');
        if (b.dataset.dismissed) b.classList.remove('on');
      }, 5500);
    },
    tip: function () { tipI = tipI % 4 + 1; FX.mate.say(I18N.t('tip' + tipI)); }
  };
  FX.dress = function () {
    var q = document.getElementById('mq'); if (q) { var h = ''; for (var k = 0; k < 2; k++) for (var i = 1; i <= 4; i++) h += '<span>' + I18N.t('m' + i) + '</span><b></b>'; q.innerHTML = h + h; }
    var c = document.getElementById('mateBtn'), b = document.getElementById('mateBub');
    if (c && !c.dataset.on) {
      c.dataset.on = 1;
      c.onclick = function () { if (window.App && App.toggleChat) App.toggleChat(); else FX.mate.tip(); };
      if (b) b.onclick = function (e) {
        if (e.target.closest('button')) return;
        if (window.App && App.toggleChat) App.toggleChat();
      };
      setInterval(function () { var w = document.getElementById('chatWin'); if (!document.hidden && (!w || !w.classList.contains('open')) && (!b || !b.dataset.dismissed)) FX.mate.tip(); }, 24000);
    }
  };
  bg();
})();
