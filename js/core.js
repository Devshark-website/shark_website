/* SHARK Shop - ส่วนกลางของทุกหน้า: เชื่อม Supabase, เมนู, ระบบสมาชิก (อีเมล + รหัสยืนยัน + กันบอท), แจ้งเตือนเรียลไทม์
   Shared core for every page: Supabase client, layout, auth (email OTP + Turnstile captcha), realtime. */
(function () {
  'use strict';
  var CFG = window.SHOP_CONFIG, t = I18N.t;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ------------------------------------------------------------------ Supabase client */
  var configured = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && !/YOUR-/i.test(CFG.supabaseUrl + CFG.supabaseAnonKey));
  function stubClient() {
    /* ใช้แทนตอนยังไม่ได้ตั้งค่า: ทุกคำสั่งตอบกลับเป็น error NOT_CONFIGURED เพื่อให้หน้าเว็บยังเปิดได้ */
    var RES = { data: null, error: { message: 'NOT_CONFIGURED' }, count: 0 };
    var chain = new Proxy(function () {}, { get: function (_, p) { return p === 'then' ? function (ok) { return ok(RES); } : chain; }, apply: function () { return chain; } });
    var auth = new Proxy({
      getSession: function () { return Promise.resolve({ data: { session: null }, error: null }); },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
      signOut: function () { return Promise.resolve({ error: null }); }
    }, { get: function (o, p) { return o[p] || function () { return Promise.resolve(RES); }; } });
    return { from: function () { return chain; }, rpc: function () { return chain; }, storage: { from: function () { return chain; } },
      channel: function () { var c = { on: function () { return c; }, subscribe: function () { return c; } }; return c; }, removeChannel: function () {}, auth: auth };
  }
  var basePath = (location.pathname.replace(/[^\/]*$/, '') || '/').replace(/\/+$/, '');
  var sb = configured && window.supabase ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'shark_auth_' + (basePath || 'root') }
  }) : stubClient();

  /* ------------------------------------------------------------------ helpers */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return Number(n || 0).toLocaleString(I18N.lang() === 'th' ? 'th-TH' : 'en-US', { maximumFractionDigits: 2 }); }
  function nm(row, f) { f = f || 'name'; return (I18N.lang() === 'en' && row[f + '_en']) || row[f + '_th'] || row[f + '_en'] || ''; }
  function fmtTime(ts) { return new Date(ts).toLocaleString(I18N.lang() === 'th' ? 'th-TH' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }); }
  function qs(k) { return new URLSearchParams(location.search).get(k); }
  function toast(m, bad) {
    var e = $('#toast'); if (!e) return; e.textContent = m; e.style.borderColor = bad ? 'var(--bad)' : 'var(--cyan)';
    e.classList.add('show'); if (window.FX && FX.mate && !bad) FX.mate.say(m);
    clearTimeout(toast.h); toast.h = setTimeout(function () { e.classList.remove('show'); }, 3200);
  }
  var authReady = null;
  function openM(id) { $('#' + id).classList.add('open'); }
  function closeM(force) {
    $$('.modal.open').forEach(function (m) {
      if (force || !m.classList.contains('lockm')) m.classList.remove('open');
    });
  }
  function ph(name) {
    var ch = esc((name || 'S').trim().charAt(0).toUpperCase());
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a1fa8"/><stop offset="1" stop-color="#1e6fe0"/></linearGradient></defs><rect width="480" height="360" fill="url(#g)"/><path d="M60 300 Q200 40 330 190 Q350 215 420 200 Q380 250 420 300Z" fill="rgba(56,232,255,.25)"/><text x="50%" y="56%" text-anchor="middle" font-family="Kanit,sans-serif" font-size="150" font-weight="800" fill="#fff" fill-opacity=".9">' + ch + '</text></svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }
  function cover(p) { return (p.images && p.images[0]) || p.image_url || ph(nm(p)); }
  function copy(txt) {
    var done = function () { toast(t('copied')); };
    if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(txt).then(done, fallback); } else fallback();
    function fallback() { var a = document.createElement('textarea'); a.value = txt; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); done(); } catch (e) {} a.remove(); }
  }
  function errMsg(e) {
    if (!e) return t('errFail');
    var m = String(e.message || e.error_description || e || ''), code = String(e.code || '');
    if (/NOT_CONFIGURED/.test(m)) return t('setupT');
    if (/^[A-Z_]{4,}$/.test(m) && I18N.has('E_' + m)) return t('E_' + m);
    if (I18N.has(m)) return t(m);
    if (code === 'invalid_credentials' || /Invalid login credentials/i.test(m)) return t('errBad');
    if (code === 'email_not_confirmed' || /Email not confirmed/i.test(m)) return t('errNotConfirmed');
    if (code === 'captcha_failed' || /captcha/i.test(m)) return t('errCapFail');
    if (code === 'otp_expired' || /expired|token.*invalid|invalid.*token/i.test(m)) return t('errCode');
    if (/rate.?limit|only request this after|security purposes/i.test(m + ' ' + code)) return t('errRate');
    if (code === 'same_password' || /different from the old/i.test(m)) return t('errSamePass');
    if (code === 'weak_password' || /weak|at least \d+ char/i.test(m)) return t('errWeak');
    if (code === 'email_address_invalid' || /invalid format|address.*invalid/i.test(m)) return t('errEmail');
    if (code === 'user_already_exists' || /already registered/i.test(m)) return t('errEmailTaken');
    if (/Database error saving new user/i.test(m) || code === 'unexpected_failure') return t('errTaken');
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return t('errNet');
    return t('errFail') + (m ? ' (' + m.slice(0, 90) + ')' : '');
  }
  var webp = (function () { try { return document.createElement('canvas').toDataURL('image/webp').indexOf('data:image/webp') === 0; } catch (e) { return false; } })();
  /* ย่อรูปก่อนอัปโหลด (ประหยัดพื้นที่ฟรี) */
  function resize(file, max, q) {
    return new Promise(function (res, rej) {
      if (!file || !/^image\//.test(file.type)) return rej(new Error('errImg'));
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        var k = Math.min(1, (max || 1280) / Math.max(im.width, im.height)), c = document.createElement('canvas');
        c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        var x = c.getContext('2d'); if (!webp) { x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height); }
        x.drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? res(b) : rej(new Error('errImg')); }, webp ? 'image/webp' : 'image/jpeg', q || 0.85);
      };
      im.onerror = function () { URL.revokeObjectURL(url); rej(new Error('errImg')); };
      im.src = url;
    });
  }
  function rid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  /* ------------------------------------------------------------------ events */
  var subs = {};
  function on(ev, fn) { (subs[ev] = subs[ev] || []).push(fn); }
  function emit(ev, d) { (subs[ev] || []).forEach(function (fn) { try { fn(d); } catch (e) { console.error(e); } }); }

  /* ------------------------------------------------------------------ Cloudflare Turnstile (กันบอท) */
  var tsReady = null;
  function loadTs() {
    if (!CFG.turnstileSiteKey) return Promise.resolve(null);
    if (tsReady) return tsReady;
    tsReady = new Promise(function (res) {
      window.__sharkTs = function () { res(window.turnstile); };
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__sharkTs'; s.async = true; s.defer = true;
      s.onerror = function () { res(null); }; document.head.appendChild(s);
    });
    return tsReady;
  }
  function captcha(el) {
    var w = { token: '', id: null, off: !CFG.turnstileSiteKey,
      ok: function () { return w.off || !!w.token; },
      reset: function () { w.token = ''; if (w.id != null && window.turnstile) try { turnstile.reset(w.id); } catch (e) {} } };
    if (w.off) { el.classList.add('hide'); return w; }
    loadTs().then(function (ts) {
      if (!ts) return;
      w.id = ts.render(el, { sitekey: CFG.turnstileSiteKey, theme: 'dark', language: 'auto',
        callback: function (tok) { w.token = tok; }, 'expired-callback': function () { w.token = ''; }, 'error-callback': function () { w.token = ''; } });
    });
    return w;
  }

  /* ------------------------------------------------------------------ layout */
  var page = document.body.dataset.page || '';
  function buildLayout() {
    var app = $('.app');
    var navEntry = (window.performance && performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || {};
    var isInternalNav = navEntry.type !== 'reload' && document.referrer && document.referrer.indexOf(location.origin) === 0;

    /* Step 1: หน้าโหลด (Intro Animation) - ถ้ายังไม่มีในหน้า ให้สร้างใส่ด้านบนสุด */
    if (!$('#intro') && page !== 'admin' && !isInternalNav) {
      var introEl = document.createElement('div');
      introEl.id = 'intro';
      introEl.innerHTML = '<div class="ib"><b>' + esc(CFG.name || 'SHARK') + '</b><i></i></div>';
      document.body.prepend(introEl);
    }

    var head = document.createElement('header'); head.className = 'nav';
    head.innerHTML = '<div class="wrap">' +
      '<a class="brand" href="index.html" style="color:#fff"><span class="logo"></span>' + esc(CFG.name || 'SHARK') + '</a>' +
      '<nav class="links">' +
        '<a href="index.html" data-nav="home" data-i18n="nHome"></a>' +
        '<div class="dd"><a href="index.html#cats" data-nav="cats"><span data-i18n="nCats"></span> &#9662;</a><div class="ddm" id="ddCats"></div></div>' +
        '<a href="topup.html" data-nav="topup" data-i18n="nTopup"></a>' +
        '<a href="account.html" data-nav="account" data-i18n="nAcc"></a>' +
        '<a href="javascript:void(0)" data-mate-open="ticket" class="nav-ticket-link" style="color:var(--cyan);font-weight:600">🎫 Ticket</a>' +
        '<a href="admin.html" data-nav="admin" data-i18n="nAdmin" class="hide navAdmin"></a>' +
      '</nav><div class="sp"></div>' +
      '<div class="status-pill hide-m" id="liveStatusPill" title="ดูสถานะร้านค้า & แอดมิน"><span class="sdot dot-pulse" id="navStatusDot"></span><span id="navStatusText">' + esc(I18N.t('serverStatusTitle')) + '</span></div>' +
      '<button class="chip" id="langBtn">TH / EN</button>' +
      '<button class="chip hide-m" id="devBtn" data-i18n="devSwitch"></button>' +
      '<button class="chip" id="userBtn"></button></div>';
    app.insertBefore(head, app.firstChild);
    var ann = CFG.announcement && I18N.pick(CFG.announcement);
    if (!configured) {
      var sb1 = document.createElement('div'); sb1.className = 'setup';
      sb1.innerHTML = '<div class="wrap"><b data-i18n="setupT"></b> <span data-i18n="setupS"></span></div>';
      head.after(sb1);
    } else if (ann) {
      var an = document.createElement('div'); an.className = 'ann'; an.innerHTML = '<div class="wrap" id="annTxt"></div>'; head.after(an);
    }
    var ft = document.createElement('footer');
    var c = CFG.contact || {}, cl = [['line', 'LINE'], ['facebook', 'Facebook'], ['discord', 'Discord']].filter(function (x) { return c[x[0]]; })
      .map(function (x) { return '<a href="' + esc(c[x[0]]) + '" target="_blank" rel="noopener">' + x[1] + '</a>'; }).join(' &middot; ');
    ft.innerHTML = '<div class="wrap">' + esc(CFG.name || 'SHARK') + ' Shop &copy; ' + new Date().getFullYear() +
      (cl ? ' &nbsp;|&nbsp; <span data-i18n="contact"></span>: ' + cl : '') +
      ' &nbsp;|&nbsp; <a href="admin.html" data-i18n="nAdmin"></a></div>';
    app.appendChild(ft);

    var extra = document.createElement('div');
    extra.innerHTML =
      '<nav class="tabbar"><a href="index.html" data-nav="home" data-i18n="nHome"></a><a href="index.html#cats" data-nav="cats" data-i18n="nCats"></a>' +
      '<a href="topup.html" data-nav="topup" data-i18n="nTopup"></a><a href="account.html" data-nav="account" data-i18n="nAcc"></a>' +
      '<a href="javascript:void(0)" data-mate-open="ticket" style="color:var(--cyan)">🎫 Ticket</a></nav>' +
      /* Step 3: ให้สมัครก่อน (Auth Modal มี Onboarding notice และ lockm) */
      '<div class="modal" id="mAuth"><div class="box"><button class="x" data-close>&times;</button>' +
        '<div class="onboard-banner hide" id="aOnboardNotice">' +
          '<div class="onboard-badge"><span class="onboard-dot"></span><span data-i18n="onboardStep3"></span></div>' +
          '<h4 data-i18n="onboardWelcome"></h4>' +
          '<p data-i18n="onboardDesc"></p>' +
        '</div>' +
        '<h3 id="aTitle"></h3>' +
        '<div class="discord-login-block" style="text-align:center;margin:12px 0 14px;background:rgba(88,101,242,.14);border:1px solid rgba(88,101,242,.42);border-radius:12px;padding:12px 14px">' +
          '<div style="font-size:.84rem;color:#e0e7ff;font-weight:600;margin-bottom:8px">⚡ ต้องเข้าสู่ระบบด้วย Discord ก่อนใช้งานระบบร้านค้า</div>' +
          '<button type="button" class="btn" id="aDiscordBtn" style="width:100%;display:flex;align-items:center;justify-content:center;gap:10px;background:#5865f2;color:#fff;font-weight:700;padding:11px;border:none;border-radius:8px;font-size:.92rem;cursor:pointer;box-shadow:0 4px 14px rgba(88,101,242,.45)">' +
            '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>' +
            '<span>เข้าสู่ระบบด้วย Discord (Login with Discord)</span>' +
          '</button>' +
          '<div style="font-size:.75rem;color:#94a3b8;margin-top:6px">ใช้บัญชี Discord เดียวกับที่เปิด Ticket ในเซิร์ฟเวอร์</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:10px;margin:8px 0 10px;color:var(--mute);font-size:.76rem"><span style="flex:1;height:1px;background:rgba(255,255,255,.1)"></span><span>หรือใช้อีเมลเข้าสู่ระบบ</span><span style="flex:1;height:1px;background:rgba(255,255,255,.1)"></span></div>' +
        '<div class="chips" id="aTabs" style="margin:8px 0 4px"><button type="button" class="opt" data-step="login" data-i18n="login"></button><button type="button" class="opt" data-step="reg" data-i18n="register"></button></div>' +
        '<form id="aForm" novalidate>' +
          '<p class="info" data-f="info" id="aInfo"></p>' +
          '<div data-f="user"><label class="lab" for="aUser" data-i18n="uname"></label><input class="inp" id="aUser" maxlength="20" autocomplete="username"><small class="hint" id="aUserHint"></small></div>' +
          '<div data-f="email"><label class="lab" for="aEmail" data-i18n="email"></label><input class="inp" id="aEmail" type="email" autocomplete="email" maxlength="120"></div>' +
          '<div data-f="code"><label class="lab" for="aCode" data-i18n="code"></label><input class="inp code" id="aCode" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="000000"></div>' +
          '<div data-f="pass"><label class="lab" for="aPass" id="aPassLab"></label><input class="inp" id="aPass" type="password" maxlength="72"></div>' +
          '<div data-f="pass2"><label class="lab" for="aPass2" data-i18n="pass2"></label><input class="inp" id="aPass2" type="password" maxlength="72" autocomplete="new-password"></div>' +
          '<div data-f="cap" class="capw"><small class="hint" data-i18n="capHint"></small><div id="aCap" class="cap"></div></div>' +
          '<div class="msg" id="aMsg"></div>' +
          '<button class="btn" id="aGo" type="submit" style="width:100%;margin-top:10px"></button>' +
          '<div class="alinks"><a href="#" data-go="forgot" data-i18n="forgot"></a><a href="#" data-go="resend" id="aResend"></a><a href="#" data-go="login" data-i18n="backLogin"></a></div>' +
        '</form></div></div>' +
      /* Step 2: ให้เลือกอุปกรณ์ (Device Chooser) */
      '<div id="dev" class="hide"><div class="in"><div class="logo"></div><h1>' + esc(CFG.name || 'SHARK') + '</h1><p data-i18n="devAsk"></p><div class="devs">' +
        '<button class="dv" data-dev="pc"><svg viewBox="0 0 64 64"><rect x="6" y="9" width="52" height="34" rx="4"/><path d="M24 55h16M32 43v12"/></svg><b data-i18n="devPc"></b><small data-i18n="devPcS"></small></button>' +
        '<button class="dv" data-dev="mobile"><svg viewBox="0 0 64 64"><rect x="18" y="5" width="28" height="54" rx="5"/><path d="M28 51h8"/></svg><b data-i18n="devMob"></b><small data-i18n="devMobS"></small></button>' +
        '</div><div class="langrow"><button class="opt" data-lang="th">ไทย</button><button class="opt" data-lang="en">English</button></div></div></div>' +
      /* AI & Live Admin Chat Drawer */
      '<div id="chatWin">' +
        '<div class="chead"><h4 data-i18n="chatTitle"></h4><div style="display:flex;gap:8px;align-items:center"><button type="button" class="btn xs danger" id="chatClear" data-i18n="clearChat" style="padding:4px 10px;font-size:.76rem"></button><button type="button" class="x" id="chatClose" style="position:static">&times;</button></div></div>' +
        '<div class="ctabs">' +
          '<button type="button" class="ctab on" data-cmode="ai" data-i18n="tabAi"></button>' +
          '<button type="button" class="ctab" data-cmode="admin" data-i18n="tabAdmin"></button>' +
          '<button type="button" class="ctab" data-cmode="ticket">🎫 Ticket</button>' +
        '</div>' +
        '<div class="cchips" id="cChips">' +
          '<button type="button" class="cchip" data-cq="rec" data-i18n="qRec"></button>' +
          '<button type="button" class="cchip" data-cq="top" data-i18n="qHowTop"></button>' +
          '<button type="button" class="cchip" data-cq="buy" data-i18n="qHowBuy"></button>' +
          '<button type="button" class="cchip" data-cq="me" data-i18n="qMyStatus"></button>' +
        '</div>' +
        '<div class="cbody" id="cBody"></div>' +
        '<form class="cfoot" id="cForm"><input id="cInp" maxlength="500" autocomplete="off"><button class="btn sm" type="submit" id="cSend" data-i18n="send"></button></form>' +
      '</div>' +
      '<div id="mate">' +
        '<div class="bub on" id="mateBub">' +
          '<button type="button" class="bub-x" id="mateBubX" aria-label="Close">&times;</button>' +
          '<b class="bub-t" id="mateBubTitle" data-i18n="mateTitle"></b>' +
          '<div class="bub-d" id="mateBubText" data-i18n="mateDesc"></div>' +
          '<div class="bub-acts">' +
            '<button type="button" class="btn xs" data-mate-open="admin" data-i18n="mateQuickAdmin"></button>' +
            '<button type="button" class="btn xs ghost" data-mate-open="ai" data-i18n="mateQuickAi"></button>' +
          '</div>' +
        '</div>' +
        '<button id="mateBtn" aria-label="SHARK">' +
          '<span class="cbadge hide" id="cBadge">0</span>' +
          '<span class="mate-tag" data-i18n="mateTag"></span>' +
        '</button>' +
      '</div><div id="toast" role="status"></div>';
    while (extra.firstChild) document.body.appendChild(extra.firstChild);

    var navKey = page === 'category' || page === 'product' ? 'cats' : page;
    $$('[data-nav]').forEach(function (a) { a.classList.toggle('on', a.dataset.nav === navKey); });

    /* device mode: เมื่อเข้าเว็บใหม่หรือรีเฟรชหน้าเว็บ จะต้องเลือก คอมพิวเตอร์ / มือถือ ใหม่ทุกรอบ */
    S.del('dev');
    if (!isInternalNav) { try { sessionStorage.removeItem('shark_dev_session'); } catch (e) {} }
    var dev = null;
    try { dev = sessionStorage.getItem('shark_dev_session'); } catch (e) {}
    if (dev) document.body.classList.add('dev-' + dev); else if (page !== 'admin') $('#dev').classList.remove('hide');

    function checkOnboardingAuth() {
      if (page === 'admin') return;
      (authReady || Promise.resolve()).then(function () {
        if (!App.user) {
          /* Step 3: ให้สมัครก่อน (ล็อกโมดอลไม่ให้ปิดจนกว่าจะสมัครหรือล็อกอิน) */
          needLogin('reg', true);
        } else if (page !== 'index' && !isInternalNav) {
          /* Step 4: ไปหน้าหลักปกติ */
          location.href = 'index.html';
        }
      });
    }

    $$('[data-dev]').forEach(function (b) { b.onclick = function () {
      try { sessionStorage.setItem('shark_dev_session', b.dataset.dev); } catch (e) {}
      document.body.classList.remove('dev-pc', 'dev-mobile'); document.body.classList.add('dev-' + b.dataset.dev);
      $('#dev').classList.add('hide'); emit('dev');
      checkOnboardingAuth();
    }; });
    $('#devBtn').onclick = function () { $('#dev').classList.remove('hide'); };
    var lsp = $('#liveStatusPill');
    if (lsp) {
      lsp.onclick = function () {
        var sec = $('#liveStatusSection');
        if (sec) {
          sec.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          location.href = 'index.html#liveStatusSection';
        }
      };
    }
    /* language */
    function setLang(l) { I18N.set(l); renderStatic(); emit('lang'); }
    $('#langBtn').onclick = function () { setLang(I18N.lang() === 'th' ? 'en' : 'th'); };
    $$('[data-lang]').forEach(function (b) { b.onclick = function () { setLang(b.dataset.lang); }; });
    /* user chip */
    $('#userBtn').onclick = function () { if (App.user) location.href = 'account.html'; else needLogin(); };
    /* modal close - บล็อกไม่ให้ปิดถ้าเป็นโมดอลล็อกช่วง Onboarding (lockm) */
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]') || e.target.classList.contains('modal')) {
        if ($('.modal.open.lockm')) return;
        closeM();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if ($('.modal.open.lockm')) return;
        closeM();
      }
    });
    initAuth();
    initChat();
    subStore();
  }
  function renderStatic() {
    I18N.apply();
    var an = $('#annTxt'); if (an) an.textContent = I18N.pick(CFG.announcement);
    $$('[data-lang]').forEach(function (b) { b.classList.toggle('on', b.dataset.lang === I18N.lang()); });
    renderUser(); renderCatsMenu(); setStep(A.step, true);
    if (window.FX && FX.dress) FX.dress();
  }
  function renderUser() {
    var u = App.profile;
    if (u) {
      var dAvatar = u.discord_avatar ? '<img class="nav-d-avatar" src="' + esc(u.discord_avatar) + '" alt="" style="width:20px;height:20px;border-radius:50%;object-fit:cover;margin-right:6px;vertical-align:middle">' : '';
      var dName = u.discord_username ? ('@' + esc(u.discord_username)) : esc(u.username);
      $('#userBtn').innerHTML = dAvatar + '<span class="nm">' + dName + '</span><span class="bal">' + money(u.balance) + ' ฿</span>';
    } else {
      $('#userBtn').innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style="margin-right:5px;vertical-align:middle"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>' + esc(t('login'));
    }
    $$('.navAdmin').forEach(function (a) { a.classList.toggle('hide', !(u && u.is_admin)); });
  }
  var catsCache = null;
  function categories() {
    if (catsCache) return catsCache;
    catsCache = sb.from('categories').select('*').eq('active', true).order('sort').order('created_at')
      .then(function (r) { return r.data || []; });
    return catsCache;
  }
  function renderCatsMenu() {
    categories().then(function (cs) {
      var m = $('#ddCats'); if (!m) return;
      m.innerHTML = cs.map(function (c) { return '<a href="category.html?c=' + encodeURIComponent(c.slug) + '">' + esc(nm(c)) + '</a>'; }).join('') || '<span class="mute">-</span>';
    });
  }

  /* ------------------------------------------------------------------ session / profile / realtime */
  var App = window.App = {
    sb: sb, configured: configured, user: null, profile: null,
    $: $, $$: $$, esc: esc, money: money, nm: nm, fmtTime: fmtTime, qs: qs, toast: toast, openM: openM, closeM: closeM,
    ph: ph, cover: cover, copy: copy, err: errMsg, resize: resize, rid: rid, on: on, emit: emit, captcha: captcha, categories: categories
  };
  function loadProfile() {
    if (!App.user) { App.profile = null; return Promise.resolve(null); }
    return sb.from('profiles').select('*').eq('id', App.user.id).maybeSingle().then(function (r) {
      App.profile = r.data || null;
      if (App.profile && App.user) {
        var uMeta = App.user.user_metadata || {};
        var dName = uMeta.full_name || uMeta.name || uMeta.user_name || uMeta.preferred_username || '';
        var dId = uMeta.provider_id || uMeta.sub || '';
        var dAvatar = uMeta.avatar_url || '';
        if ((!dName || !dId) && App.user.identities) {
          var iden = App.user.identities.find(function (i) { return i.provider === 'discord'; });
          if (iden && iden.identity_data) {
            dName = dName || iden.identity_data.full_name || iden.identity_data.name || iden.identity_data.user_name || '';
            dId = dId || iden.identity_data.provider_id || iden.id || '';
            dAvatar = dAvatar || iden.identity_data.avatar_url || '';
          }
        }
        if (dName && (!App.profile.discord_username || App.profile.discord_username !== dName || !App.profile.discord_id)) {
          App.profile.discord_username = dName;
          App.profile.discord_id = dId;
          App.profile.discord_avatar = dAvatar;
          sb.from('profiles').update({ discord_username: dName, discord_id: dId, discord_avatar: dAvatar }).eq('id', App.user.id).then(function () {});
        }
      }
      /* ล็อกอินค้างอยู่แต่บัญชีถูกลบไปแล้ว (โดยแอดมิน/บอท) -> ออกจากระบบให้อัตโนมัติ */
      if (!r.error && !r.data && App.user) {
        toast(t('accRemoved'), true);
        sb.auth.signOut();
      }
      return App.profile;
    });
  }
  App.refreshProfile = function () { return loadProfile().then(function (p) { renderUser(); emit('profile', p); return p; }); };
  var chan = null, storeChan = null;
  var chatSid = (function () {
    try {
      var v = sessionStorage.getItem('shark_chat_sid');
      if (!v || v.length < 8) { v = 'sid_' + rid(); sessionStorage.setItem('shark_chat_sid', v); }
      return v;
    } catch (e) { return 'sid_' + rid(); }
  })();

  /* ------------------------------------------------------------------ Server & Admin Online Status */
  var _serverStatus = null;
  function applyServerStatus(s) {
    if (!s) return;
    if (typeof s === 'string') {
      try { s = JSON.parse(s); } catch (e) { return; }
    }
    _serverStatus = s;
    var isOnline = !!(s && s.admin_online);
    var adminCount = (s && s.admins && s.admins.online != null) ? s.admins.online : 0;
    var pOn = (s && s.players && s.players.online != null) ? s.players.online : '-';
    var pOff = (s && s.players && s.players.offline != null) ? s.players.offline : '-';
    var pTot = (s && s.players && s.players.total != null) ? s.players.total : '-';

    var navDot = $('#navStatusDot');
    var navTxt = $('#navStatusText');
    if (navDot && navTxt) {
      navDot.classList.toggle('on', isOnline);
      navDot.classList.toggle('off', !isOnline);
      if (s) {
        navTxt.textContent = isOnline
          ? (I18N.t('adminOnline') + (adminCount > 0 ? ' (' + adminCount + ')' : ''))
          : I18N.t('adminOffline');
      } else {
        navTxt.textContent = I18N.t('serverStatusTitle');
      }
    }

    var scAdminDot = $('#scAdminDot');
    var scAdminText = $('#scAdminText');
    var scAdminSubDot = $('#scAdminSubDot');
    var scAdminSubVal = $('#scAdminSubVal');
    var scOn = $('#scOnlineCount');
    var scTot = $('#scTotalCount');

    if (scAdminDot) {
      scAdminDot.classList.toggle('on', isOnline);
      scAdminDot.classList.toggle('off', !isOnline);
    }
    if (scAdminText) {
      if (s) {
        scAdminText.textContent = isOnline
          ? (I18N.t('adminOnline') + ' (' + adminCount + ' คน)')
          : I18N.t('adminOffline');
      }
    }
    if (scAdminSubDot) {
      scAdminSubDot.classList.toggle('on', isOnline);
      scAdminSubDot.classList.toggle('off', !isOnline);
    }
    if (scAdminSubVal) {
      if (s) {
        scAdminSubVal.textContent = isOnline
          ? (I18N.t('adminOnline') + ' ' + adminCount + ' คน')
          : I18N.t('adminOffline');
      } else {
        scAdminSubVal.textContent = '-';
      }
    }
    if (scOn) scOn.textContent = pOn;
    if (scTot) scTot.textContent = pTot;
  }

  async function syncServerStatus() {
    if (!configured) return;
    try {
      var data = null;
      try {
        var res = await sb.rpc('get_server_status');
        if (res && res.data) data = res.data;
      } catch (e) {}

      if (!data) {
        try {
          var r2 = await sb.from('app_settings').select('value').eq('key', 'server_status').maybeSingle();
          if (r2 && r2.data && r2.data.value) data = r2.data.value;
        } catch (e) {}
      }

      applyServerStatus(data);
    } catch (err) {
      console.warn('[ServerStatus]', err);
    }
  }
  App.syncServerStatus = syncServerStatus;

  function subStore() {
    if (storeChan || !configured) return;
    storeChan = sb.channel('store-live-' + chatSid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, function () { emit('store_change'); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, function () { catsCache = null; renderCatsMenu(); emit('store_change'); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_chats', filter: 'session_id=eq.' + chatSid }, function (p) {
        if (p.new && p.new.sender === 'ai') emit('bot_ai_reply', p.new);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings', filter: 'key=eq.server_status' }, function (p) {
        if (p.new && p.new.value) applyServerStatus(p.new.value);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, function () { emit('announcement_change'); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings', filter: 'key=eq.announcements' }, function () { emit('announcement_change'); })
      .subscribe();

    syncServerStatus();
    setInterval(syncServerStatus, 20000);
    on('lang', function () { applyServerStatus(_serverStatus); });
  }
  function subscribeMe() {
    if (chan) { sb.removeChannel(chan); chan = null; }
    if (!App.user || !configured) return;
    var uid = App.user.id;
    chan = sb.channel('me-' + uid)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: 'id=eq.' + uid }, function (p) {
        var wasBanned = !!(App.profile && App.profile.banned);
        App.profile = Object.assign({}, App.profile, p.new); renderUser(); emit('profile', App.profile);
        if (!wasBanned && p.new.banned) toast(t('bannedT') + (p.new.ban_reason ? ': ' + p.new.ban_reason : ''), true);
        if (wasBanned && p.new.banned === false) toast(t('unbannedT'));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'topups', filter: 'user_id=eq.' + uid }, function (p) {
        if (p.eventType === 'UPDATE' && p.old && p.new.status !== 'pending') {
          if (p.new.status === 'approved' && p.new.method !== 'admin') { toast(t('okTopApproved')); if (window.FX) FX.confetti(); }
          if (p.new.status === 'rejected') toast(t('topRejected') + (p.new.note ? ': ' + p.new.note : ''), true);
        }
        emit('topup', p.new);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: 'user_id=eq.' + uid }, function (p) {
        if (p.new.status === 'done') toast(t('orderDone')); emit('order', p.new);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_chats', filter: 'user_id=eq.' + uid }, function (p) {
        if (p.new && p.new.sender !== 'user') emit('chat_msg', p.new);
      })
      .subscribe();
  }
  function setUser(user) {
    App.user = user || null;
    return loadProfile().then(function () { renderUser(); subscribeMe(); });
  }
  App.logout = function () { return sb.auth.signOut().then(function () { toast(t('okOut')); }); };
  App.start = function (init) {
    buildLayout(); renderStatic();
    var started = false;
    authReady = sb.auth.getSession().then(function (r) {
      return setUser(r.data && r.data.session && r.data.session.user);
    }).catch(function () {});

    authReady.then(function () {
      started = true; init && init(); if (window.FX) FX.reveal();
      /* หากเคยเลือกอุปกรณ์แล้วใน session แต่ยังไม่ได้ล็อกอิน ให้บังคับเปิดหน้าสมัครสมาชิก */
      var devChosen = false;
      try { devChosen = !!sessionStorage.getItem('shark_dev_session'); } catch (e) {}
      if (devChosen && !App.user && page !== 'admin') {
        needLogin('reg', true);
      }
    });
    sb.auth.onAuthStateChange(function (ev, session) {
      /* อย่าเรียก supabase ตรง ๆ ใน callback นี้ (อาจค้าง) จึงเลื่อนไปทำทีหลัง */
      setTimeout(function () {
        var uid = session && session.user ? session.user.id : null, cur = App.user ? App.user.id : null;
        if (!started || (uid === cur && ev !== 'USER_UPDATED')) { if (session && session.user) App.user = session.user; return; }
        setUser(session && session.user).then(function () { emit('auth', App.user); });
      }, 0);
    });
  };

  /* ------------------------------------------------------------------ auth modal */
  var NAME_RE = /^[A-Za-z0-9_]{3,20}$/, EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var A = { step: 'login', email: '', cap: null, cool: 0, timer: null, verified: false };
  var STEPS = {
    login:  { title: 'login',    go: 'login',     f: ['email', 'pass', 'cap'], tabs: 1, links: ['forgot'] },
    reg:    { title: 'register', go: 'register',  f: ['user', 'email', 'pass', 'pass2', 'cap'], tabs: 1, links: [] },
    verify: { title: 'verifyT',  go: 'verifyGo',  f: ['info', 'code'], links: ['resend', 'login'] },
    forgot: { title: 'forgotT',  go: 'forgotGo',  f: ['email', 'cap'], links: ['login'] },
    reset:  { title: 'resetT',   go: 'resetGo',   f: ['info', 'code', 'pass', 'pass2'], links: ['resend', 'login'] }
  };
  function amsg(m, ok) { var e = $('#aMsg'); e.className = 'msg' + (ok ? ' ok' : ''); e.textContent = m || ''; }
  function setStep(s, keepMsg) {
    var cfg = STEPS[s]; if (!cfg) return; A.step = s;
    $('#aTitle').textContent = t(cfg.title); $('#aGo').textContent = t(cfg.go);
    $('#aTabs').classList.toggle('hide', !cfg.tabs);
    $$('#aTabs [data-step]').forEach(function (b) { b.classList.toggle('on', b.dataset.step === s); });
    $$('#aForm [data-f]').forEach(function (el) { el.classList.toggle('hide', cfg.f.indexOf(el.dataset.f) < 0); });
    $$('#aForm [data-go]').forEach(function (el) { el.classList.toggle('hide', cfg.links.indexOf(el.dataset.go) < 0); });
    $('#aPassLab').textContent = t(s === 'reset' ? 'newPass' : 'pass');
    $('#aPass').autocomplete = s === 'login' ? 'current-password' : 'new-password';
    $('#aInfo').innerHTML = (s === 'verify' || s === 'reset') ? esc(t('sentTo')) + ' <b>' + esc(A.email) + '</b><br><small>' + esc(t('checkSpam')) + '</small>' : '';
    if (!keepMsg) amsg('');
    renderCool();
  }
  function renderCool() {
    var r = $('#aResend'); if (!r) return;
    r.textContent = A.cool > 0 ? t('waitSec') + ' ' + A.cool + 's' : t('resend');
    r.classList.toggle('dis', A.cool > 0);
  }
  function startCool(sec) {
    A.cool = sec; renderCool(); clearInterval(A.timer);
    A.timer = setInterval(function () { A.cool--; renderCool(); if (A.cool <= 0) clearInterval(A.timer); }, 1000);
  }
  function busy(b) { $('#aGo').disabled = b; }
  function needLogin(step, lock) {
    var m = $('#mAuth');
    if (m) {
      if (lock) {
        m.classList.add('lockm');
        var ob = $('#aOnboardNotice');
        if (ob) ob.classList.remove('hide');
      } else {
        m.classList.remove('lockm');
        var ob = $('#aOnboardNotice');
        if (ob) ob.classList.add('hide');
      }
    }
    setStep(step || 'login'); openM('mAuth');
    setTimeout(function () { var f = $('#aForm [data-f]:not(.hide) input'); if (f) f.focus(); }, 80);
  }
  App.needLogin = needLogin;
  App.openReset = function (email) { $('#aEmail').value = email || ''; needLogin('forgot'); };

  function initAuth() {
    A.cap = captcha($('#aCap'));
    var discBtn = $('#aDiscordBtn');
    if (discBtn) {
      discBtn.onclick = function () {
        var redir = location.origin + location.pathname;
        sb.auth.signInWithOAuth({
          provider: 'discord',
          options: { redirectTo: redir }
        }).then(function (res) {
          if (res && res.error) toast(errMsg(res.error), true);
        });
      };
    }
    $$('#aTabs [data-step]').forEach(function (b) { b.onclick = function () { setStep(b.dataset.step); }; });
    $$('#aForm [data-go]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); if (a.dataset.go === 'resend') resend(); else setStep(a.dataset.go); }; });
    /* เช็คชื่อซ้ำแบบสด ๆ */
    var ut;
    $('#aUser').oninput = function () {
      var v = this.value.trim(), h = $('#aUserHint'); clearTimeout(ut);
      if (!v) { h.textContent = t('unameHint'); h.className = 'hint'; return; }
      if (!NAME_RE.test(v)) { h.textContent = t('errName'); h.className = 'hint bad'; return; }
      h.textContent = t('checking'); h.className = 'hint';
      ut = setTimeout(function () {
        sb.rpc('username_available', { name: v }).then(function (r) {
          if ($('#aUser').value.trim() !== v) return;
          if (r.error) { h.textContent = ''; return; }
          h.textContent = t(r.data ? 'unameOk' : 'unameTaken'); h.className = 'hint ' + (r.data ? 'good' : 'bad');
        });
      }, 450);
    };
    $('#aUserHint').textContent = t('unameHint');
    $('#aCode').oninput = function () { this.value = this.value.replace(/\D/g, ''); };
    $('#aForm').onsubmit = function (e) { e.preventDefault(); submit(); };
  }

  function submit() {
    var s = A.step, email = $('#aEmail').value.trim().toLowerCase(), pass = $('#aPass').value, pass2 = $('#aPass2').value,
        code = $('#aCode').value.trim(), uname = $('#aUser').value.trim();
    var capOk = function () { if (!A.cap.ok()) { amsg(t('errCaptcha')); return false; } return true; };
    var fail = function (e) { busy(false); A.cap.reset(); amsg(errMsg(e)); };
    amsg('');
    if (s === 'login') {
      if (!EMAIL_RE.test(email)) return amsg(t('errEmail'));
      if (!pass) return amsg(t('errBad'));
      if (!capOk()) return;
      busy(true);
      sb.auth.signInWithPassword({ email: email, password: pass, options: { captchaToken: A.cap.token || undefined } }).then(function (r) {
        busy(false); A.cap.reset();
        if (r.error) {
          if (r.error.code === 'email_not_confirmed' || /not confirmed/i.test(r.error.message)) { A.email = email; setStep('verify'); return amsg(t('errNotConfirmed')); }
          return amsg(errMsg(r.error));
        }
        done('okIn');
      }, fail);
    } else if (s === 'reg') {
      if (!NAME_RE.test(uname)) return amsg(t('errName'));
      if (!EMAIL_RE.test(email)) return amsg(t('errEmail'));
      if (pass.length < 8) return amsg(t('errPass'));
      if (pass !== pass2) return amsg(t('errMatch'));
      if (!capOk()) return;
      busy(true);
      sb.rpc('username_available', { name: uname }).then(function (r) {
        if (r.error) throw r.error;
        if (r.data === false) { busy(false); return amsg(t('errTaken')); }
        return sb.auth.signUp({ email: email, password: pass, options: { data: { username: uname }, captchaToken: A.cap.token || undefined } }).then(function (r2) {
          A.cap.reset();
          if (r2.error) { busy(false); return amsg(errMsg(r2.error)); }
          var u = r2.data && r2.data.user;
          if (u && u.identities && u.identities.length === 0) { busy(false); return amsg(t('errEmailTaken')); }
          if (r2.data && r2.data.session) { busy(false); return done('okReg'); }
          /* ล็อกอินให้อัตโนมัติทันที (ฐานข้อมูลยืนยันอีเมลให้แล้วใน handle_new_user) ไม่ต้องรอรับอีเมล */
          return sb.auth.signInWithPassword({ email: email, password: pass }).then(function (r3) {
            busy(false);
            if (r3 && r3.data && r3.data.session) return done('okReg');
            A.email = email; A.verified = false; $('#aCode').value = ''; setStep('verify'); amsg(t('okSent'), true);
          });
        });
      }).catch(fail);
    } else if (s === 'verify') {
      if (!/^\d{6,10}$/.test(code)) return amsg(t('errCodeFmt'));
      busy(true);
      sb.auth.verifyOtp({ email: A.email, token: code, type: 'email' }).then(function (r) {
        busy(false); if (r.error) return amsg(errMsg(r.error)); done('okReg');
      }, fail);
    } else if (s === 'forgot') {
      if (!EMAIL_RE.test(email)) return amsg(t('errEmail'));
      if (!capOk()) return;
      busy(true);
      sb.auth.resetPasswordForEmail(email, { captchaToken: A.cap.token || undefined }).then(function (r) {
        busy(false); A.cap.reset(); if (r.error) return amsg(errMsg(r.error));
        A.email = email; A.verified = false; $('#aCode').value = ''; $('#aPass').value = $('#aPass2').value = '';
        setStep('reset'); amsg(t('okSent'), true);
      }, fail);
    } else if (s === 'reset') {
      if (!A.verified && !/^\d{6,10}$/.test(code)) return amsg(t('errCodeFmt'));
      if (pass.length < 8) return amsg(t('errPass'));
      if (pass !== pass2) return amsg(t('errMatch'));
      busy(true);
      var step1 = A.verified ? Promise.resolve({}) : sb.auth.verifyOtp({ email: A.email, token: code, type: 'recovery' });
      step1.then(function (r) {
        if (r.error) { busy(false); return amsg(errMsg(r.error)); }
        A.verified = true;
        return sb.auth.updateUser({ password: pass }).then(function (r2) {
          busy(false); if (r2.error) return amsg(errMsg(r2.error));
          A.verified = false; done('okPassChanged');
        });
      }).catch(fail);
    }
  }
  function resend() {
    if (A.cool > 0 || !A.email) return;
    var needCap = !A.cap.off;
    if (needCap && !A.cap.token) {          /* ขอให้ยืนยันว่าไม่ใช่บอทก่อนส่งอีเมลซ้ำ */
      $('#aForm [data-f="cap"]').classList.remove('hide'); return amsg(t('errCaptcha'));
    }
    var p = A.step === 'reset'
      ? sb.auth.resetPasswordForEmail(A.email, { captchaToken: A.cap.token || undefined })
      : sb.auth.resend({ type: 'signup', email: A.email, options: { captchaToken: A.cap.token || undefined } });
    p.then(function (r) {
      A.cap.reset(); if (needCap) $('#aForm [data-f="cap"]').classList.add('hide');
      if (r.error) return amsg(errMsg(r.error));
      amsg(t('okSent'), true);
    });
  }
  function done(key) {
    var wasLocked = $('#mAuth') && $('#mAuth').classList.contains('lockm');
    if ($('#mAuth')) {
      $('#mAuth').classList.remove('lockm');
      var ob = $('#aOnboardNotice');
      if (ob) ob.classList.add('hide');
    }
    $('#aPass').value = $('#aPass2').value = $('#aCode').value = '';
    closeM(true); toast(t(key)); if (window.FX && key !== 'okIn') FX.confetti();
    /* Step 4: ไปหน้าหลักปกติ (ถ้าล็อกอินสำเร็จระหว่างขั้นตอน Onboarding) */
    if (wasLocked && page !== 'index' && page !== 'admin') {
      setTimeout(function () { location.href = 'index.html'; }, 300);
    }
  }

  /* ------------------------------------------------------------------ shared product card */
  App.card = function (p) {
    var n = nm(p), left = Number(p.stock_left), out = left === 0;
    var badge = out ? '<span class="badge out">' + esc(t('soldOut')) + '</span>'
      : '<span class="badge">' + esc(left < 0 ? t('unlimited') : t('left') + ' ' + left) + '</span>';
    var auto = p.delivery === 'code' ? '<span class="badge r" title="' + esc(t('autoDel')) + '">&#9889; AUTO</span>' : '';
    return '<a class="card rv" href="product.html?id=' + encodeURIComponent(p.id) + '"><div class="thumb">' + badge + auto +
      '<img loading="lazy" alt="' + esc(n) + '" src="' + esc(cover(p)) + '"></div>' +
      '<div class="cb"><h3>' + esc(n) + '</h3><p>' + esc(nm(p, 'desc')) + '</p><div class="pr"><span class="price">' + money(p.price) + ' <small>' + esc(t('baht')) + '</small></span>' +
      '<span class="btn sm buy"' + (out ? ' disabled' : '') + '>' + esc(t(out ? 'soldOut' : 'buy')) + '</span></div></div></a>';
  };
  App.lock = function (box, title, sub) {
    box.innerHTML = '<div class="panel lock"><h3>' + esc(title || t('needLogin')) + '</h3><p>' + esc(sub || t('needLoginS')) + '</p>' +
      '<button class="btn" data-lk>' + esc(t('login')) + '</button></div>';
    $('[data-lk]', box).onclick = function () { needLogin(); };
  };
  App.statusTag = function (st, kind) {
    var cls = st === 'pending' ? 'pending' : (st === 'rejected' || st === 'cancelled') ? 'bad' : '';
    var key = kind === 'order' && st === 'pending' ? 'o_pending' : 's_' + st;
    return '<span class="st ' + cls + '">' + esc(t(key)) + '</span>';
  };
  App.parseAccountLine = function (line, credType) {
    var s = String(line || '').trim();
    if (!s) return null;
    var m1 = s.match(/^(?:อีเมล|Email)\s*:\s*([^|]+)\|\s*(?:รหัส(?:ผ่าน)?|Pass(?:word)?)\s*:\s*(.+)$/i);
    if (m1) return { mode: 'email_pass', login: m1[1].trim(), pass: m1[2].trim() };
    var m2 = s.match(/^(?:ชื่อ(?:ผู้ใช้)?|ไอดี|Username|User|ID)\s*:\s*([^|]+)\|\s*(?:รหัส(?:ผ่าน)?|Pass(?:word)?)\s*:\s*(.+)$/i);
    if (m2) return { mode: 'user_pass', login: m2[1].trim(), pass: m2[2].trim() };
    var sep = s.indexOf(' | ') > -1 ? ' | ' : (s.indexOf('|') > -1 ? '|' : (s.indexOf(':') > -1 ? ':' : ''));
    if (sep) {
      var idx = s.indexOf(sep);
      var u = s.slice(0, idx).trim(), p = s.slice(idx + sep.length).trim();
      if (u && p) {
        var mode = credType === 'user_pass' ? 'user_pass' : (credType === 'email_pass' ? 'email_pass' : (u.indexOf('@') > -1 ? 'email_pass' : 'user_pass'));
        return { mode: mode, login: u, pass: p };
      }
    }
    return null;
  };
  App.renderDelivered = function (raw, credType) {
    var txt = String(raw || '').trim();
    if (!txt) return '';
    var lines = txt.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
    return lines.map(function (line) {
      var parsed = App.parseAccountLine(line, credType);
      if (parsed) {
        var lbl1 = parsed.mode === 'user_pass' ? t('accUser') : t('accEmail');
        var lbl2 = t('accPass');
        var fullCopy = parsed.login + ':' + parsed.pass;
        return '<div class="acc-card">' +
          '<div class="acc-row"><span class="lbl">' + esc(lbl1) + '</span><b class="val">' + esc(parsed.login) + '</b><button type="button" class="btn xs ghost" data-cpval="' + esc(parsed.login) + '">' + esc(t('copy')) + '</button></div>' +
          '<div class="acc-row"><span class="lbl">' + esc(lbl2) + '</span><b class="val">' + esc(parsed.pass) + '</b><button type="button" class="btn xs ghost" data-cpval="' + esc(parsed.pass) + '">' + esc(t('copy')) + '</button></div>' +
          '<div style="display:flex;justify-content:flex-end"><button type="button" class="btn xs" data-cpval="' + esc(fullCopy) + '">' + esc(t('copy')) + ' ทั้งหมด</button></div>' +
        '</div>';
      }
      return '<div class="codebox"><span>' + esc(line) + '</span><button type="button" class="btn xs" data-cpval="' + esc(line) + '">' + esc(t('copy')) + '</button></div>';
    }).join('');
  };
  App.bindDeliveredCopy = function (root) {
    $$('[data-cpval]', root || document).forEach(function (btn) {
      btn.onclick = function () { copy(btn.getAttribute('data-cpval') || ''); };
    });
  };

  /* ------------------------------------------------------------------ SHARK AI, Live Admin Chat & Ticket System (ซิงค์ Discord สองทาง) */
  var C = {
    mode: 'ai',
    aiMsgs: [],
    admMsgs: [],
    ticketList: [],
    activeTicket: null,
    ticketMsgs: [],
    ticketChan: null,
    ticketPollTimer: null,
    unread: 0,
    seenAiIds: {}
  };

  function fmtChatHtml(txt) {
    var s = esc(txt || '');
    s = s.replace(/\[([^\]]+)\]\(((?:product|category|topup|account)\.html[^)]*)\)/g, '<a class="plink" href="$2">$1</a>');
    return s.replace(/\n/g, '<br>');
  }

  function renderChat() {
    var box = $('#cBody'), inp = $('#cInp'), chips = $('#cChips'), cfoot = $('#cForm');
    var sendBtn = $('#cSend') || (cfoot ? cfoot.querySelector('button[type="submit"]') : null);
    if (!box) return;
    $$('[data-cmode]').forEach(function (b) { b.classList.toggle('on', b.dataset.cmode === C.mode); });
    if (chips) chips.classList.toggle('hide', C.mode !== 'ai');
    if (inp) {
      if (C.mode === 'ai') {
        inp.placeholder = t('chatPhAi');
        inp.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
      } else if (C.mode === 'admin') {
        inp.placeholder = t('chatPhAdm');
        inp.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
      } else {
        if (!C.activeTicket) {
          inp.placeholder = 'กรุณาเลือกหรือเปิด Ticket ก่อนพิมพ์...';
          inp.disabled = true;
          if (sendBtn) sendBtn.disabled = true;
        } else if (C.activeTicket.status === 'closed') {
          inp.placeholder = '🔒 Ticket นี้ถูกปิดแล้ว (ดูประวัติได้อย่างเดียว)';
          inp.disabled = true;
          if (sendBtn) sendBtn.disabled = true;
        } else {
          inp.placeholder = 'พิมพ์ข้อความคุยกับแอดมินใน Ticket นี้...';
          inp.disabled = false;
          if (sendBtn) sendBtn.disabled = false;
        }
      }
    }
    if (cfoot) {
      cfoot.classList.toggle('hide', C.mode === 'ticket' && !C.activeTicket);
    }

    var clearBtn = $('#chatClear');
    if (clearBtn) {
      if (C.mode === 'ticket') {
        clearBtn.style.display = C.activeTicket ? 'inline-flex' : 'none';
        clearBtn.textContent = 'ลบประวัติ Ticket';
      } else {
        clearBtn.style.display = 'inline-flex';
        clearBtn.textContent = t('clearChat');
      }
    }

    if (C.mode === 'ticket') {
      renderTicketUI(box);
      return;
    }

    var list = C.mode === 'ai' ? C.aiMsgs : C.admMsgs;
    if (!list.length) {
      list.push({ sender: C.mode === 'ai' ? 'ai' : 'admin', message: t(C.mode === 'ai' ? 'aiHello' : 'admHello') });
    }
    box.innerHTML = list.map(function (m) {
      var isMe = m.sender === 'user';
      var who = isMe ? ((App.profile && App.profile.username) || 'คุณ') : (m.sender === 'admin' ? 'แอดมินร้าน' : 'SHARK AI');
      return '<div class="cmsg ' + (isMe ? 'me' : 'bot') + '"><small>' + esc(who) + '</small>' + fmtChatHtml(m.message) + '</div>';
    }).join('');
    box.scrollTop = box.scrollHeight;
  }

  function renderTicketUI(box) {
    if (!App.user) {
      box.innerHTML =
        '<div class="ticket-prompt" style="text-align:center;padding:28px 14px">' +
          '<div style="font-size:2.5rem;margin-bottom:8px">🎫</div>' +
          '<h4 style="margin:0 0 8px;color:#fff">ระบบ Ticket ติดต่อทีมงาน</h4>' +
          '<p style="color:var(--mute);font-size:.86rem;line-height:1.55;margin:0 0 16px">จำเป็นต้องเข้าสู่ระบบด้วย Discord เพื่อใช้งานระบบ Ticket และเชื่อมต่อกับห้อง Discord ของร้าน</p>' +
          '<button type="button" class="btn" id="tDiscordLogin" style="background:#5865f2;color:#fff;border:none;padding:11px 18px;border-radius:8px;font-weight:700;display:inline-flex;align-items:center;gap:8px;cursor:pointer;box-shadow:0 4px 14px rgba(88,101,242,.4)">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>' +
            '<span>เข้าสู่ระบบด้วย Discord</span>' +
          '</button>' +
        '</div>';
      var btn = $('#tDiscordLogin');
      if (btn) btn.onclick = function () {
        sb.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: location.origin + location.pathname } });
      };
      return;
    }

    if (C.activeTicket) {
      var act = C.activeTicket;
      var isOpen = act.status === 'open';
      var msgsHtml = !C.ticketMsgs.length
        ? '<div style="text-align:center;padding:22px;color:var(--mute);font-size:.85rem">ยังไม่มีข้อความ' + (isOpen ? ' พิมพ์ข้อความด้านล่างเพื่อคุยกับทีมงานได้ทันที' : '') + '</div>'
        : C.ticketMsgs.map(function (m) {
            var isMe = m.sender === 'user';
            var senderLabel = isMe ? (m.sender_name || 'คุณ') : (m.sender_name || 'แอดมินร้าน (Discord)');
            var badge = isMe
              ? '<span style="font-size:.7rem;background:rgba(56,232,255,.18);color:var(--cyan);padding:1px 6px;border-radius:4px">เว็บ</span>'
              : '<span style="font-size:.7rem;background:rgba(88,101,242,.22);color:#818cf8;padding:1px 6px;border-radius:4px">Discord</span>';
            return '<div class="cmsg ' + (isMe ? 'me' : 'bot') + '">' +
              '<small style="display:flex;align-items:center;gap:5px">' + esc(senderLabel) + ' ' + badge + '</small>' +
              fmtChatHtml(m.message) +
            '</div>';
          }).join('');

      var actionBtnHtml = isOpen
        ? '<button type="button" class="btn xs danger" id="tCloseBtn" style="padding:4px 8px" title="ปิดการสนทนา">🔒 ปิด Ticket</button>'
        : '<button type="button" class="btn xs danger" id="tDeleteBtn" style="padding:4px 8px" title="ลบประวัติแชท">🗑️ ลบแชท</button>';

      var closedNoticeHtml = !isOpen
        ? '<div style="background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:.78rem;color:#fca5a5;display:flex;align-items:center;justify-content:space-between;gap:8px">' +
            '<span>🔒 <b>Ticket นี้ปิดแล้ว:</b> พิมพ์ไม่ได้ แต่คุณสามารถดูประวัติการคุยย้อนหลังได้</span>' +
            '<button type="button" class="btn xs danger" id="tDeleteBannerBtn" style="padding:3px 8px;font-size:.72rem">🗑️ ลบประวัติแชท</button>' +
          '</div>'
        : '';

      box.innerHTML =
        '<div class="ticket-header" style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:rgba(255,255,255,.05);border-bottom:1px solid rgba(255,255,255,.08);margin:-12px -12px 10px">' +
          '<button type="button" class="btn xs ghost" id="tBackBtn" style="padding:4px 8px">&larr; ย้อนกลับ</button>' +
          '<div style="text-align:center;flex:1;overflow:hidden;padding:0 8px">' +
            '<div style="font-weight:700;font-size:.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">🎫 #' + (act.ticket_number || 1) + ' ' + esc(act.title || 'ทั่วไป') + '</div>' +
            '<small style="font-size:.72rem;color:' + (isOpen ? 'var(--green)' : 'var(--bad)') + '">' + (isOpen ? '🟢 เปิดอยู่ (ซิงค์ Discord สด)' : '🔒 ปิดแล้ว (ดูประวัติได้)') + '</small>' +
          '</div>' +
          actionBtnHtml +
        '</div>' +
        closedNoticeHtml +
        '<div class="ticket-body">' + msgsHtml + '</div>';

      var bBtn = $('#tBackBtn');
      if (bBtn) bBtn.onclick = function () { stopTicketPoll(); C.activeTicket = null; renderChat(); };
      var cBtn = $('#tCloseBtn');
      if (cBtn) cBtn.onclick = function () { closeActiveTicket(); };
      var dBtn = $('#tDeleteBtn');
      if (dBtn) dBtn.onclick = function () { deleteActiveTicket(); };
      var dbBtn = $('#tDeleteBannerBtn');
      if (dbBtn) dbBtn.onclick = function () { deleteActiveTicket(); };
      box.scrollTop = box.scrollHeight;
      return;
    }

    var tickets = C.ticketList || [];
    var tRows = !tickets.length
      ? '<div style="text-align:center;padding:16px 10px;color:var(--mute);font-size:.85rem">คุณยังไม่มีรายการ Ticket ที่เปิดไว้</div>'
      : tickets.map(function (tk) {
          var isOpen = tk.status === 'open';
          return '<div class="ticket-item" data-tkid="' + tk.id + '" style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px 12px;margin-bottom:8px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;transition:.2s">' +
            '<div style="flex:1;overflow:hidden;padding-right:8px">' +
              '<div style="font-weight:600;font-size:.9rem;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">🎫 #' + (tk.ticket_number || 1) + ' ' + esc(tk.title || 'ทั่วไป') + '</div>' +
              '<small style="color:var(--mute);font-size:.74rem">' + esc(App.fmtTime(tk.created_at)) + '</small>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:6px">' +
              '<span class="st ' + (isOpen ? 'ok' : 'bad') + '" style="font-size:.72rem">' + (isOpen ? '🟢 เปิดอยู่' : '🔒 ปิดแล้ว') + '</span>' +
              (!isOpen ? '<button type="button" class="btn xs danger t-del-item" data-delid="' + tk.id + '" style="padding:2px 7px;font-size:.72rem" title="ลบประวัติแชท">🗑️</button>' : '') +
            '</div>' +
          '</div>';
        }).join('');

    box.innerHTML =
      '<div style="padding-bottom:12px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">' +
          '<h5 style="margin:0;font-size:.95rem">🎫 รายการ Ticket ของคุณ</h5>' +
          '<button type="button" class="btn xs" id="tOpenNewBtn">+ เปิด Ticket ใหม่</button>' +
        '</div>' +
        '<div id="tNewForm" class="hide" style="background:rgba(56,232,255,.06);border:1px solid rgba(56,232,255,.25);border-radius:12px;padding:12px;margin-bottom:14px">' +
          '<div style="font-weight:700;font-size:.88rem;color:var(--cyan);margin-bottom:8px">📝 กรอกเรื่องที่ต้องการติดต่อทีมงาน</div>' +
          '<input class="inp" id="tTitleInp" placeholder="หัวข้อ เช่น สอบถามสินค้า, ปัญหาเติมเงิน..." maxlength="80" style="width:100%;padding:8px 10px;margin-bottom:8px">' +
          '<textarea class="inp" id="tDetailInp" placeholder="รายละเอียดที่ต้องการแจ้งแอดมิน..." rows="3" style="width:100%;padding:8px 10px;resize:none;margin-bottom:10px"></textarea>' +
          '<div style="display:flex;gap:8px;justify-content:flex-end">' +
            '<button type="button" class="btn xs ghost" id="tCancelNew">ยกเลิก</button>' +
            '<button type="button" class="btn xs" id="tSubmitNew">🚀 เปิด Ticket ทันที</button>' +
          '</div>' +
        '</div>' +
        '<div class="ticket-list">' + tRows + '</div>' +
      '</div>';

    var newBtn = $('#tOpenNewBtn'), formEl = $('#tNewForm');
    if (newBtn && formEl) newBtn.onclick = function () { formEl.classList.toggle('hide'); };
    var cancelBtn = $('#tCancelNew');
    if (cancelBtn && formEl) cancelBtn.onclick = function () { formEl.classList.add('hide'); };
    var submitBtn = $('#tSubmitNew');
    if (submitBtn) submitBtn.onclick = function () { submitNewWebTicket(); };

    $$('.ticket-item[data-tkid]').forEach(function (el) {
      el.onclick = function () { openTicketById(el.dataset.tkid); };
    });
    $$('.t-del-item').forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        deleteActiveTicket(btn.dataset.delid);
      };
    });
  }

  function loadUserTickets() {
    if (!App.user || !configured) return;
    var dId = (App.profile && App.profile.discord_id) || '';
    var q = sb.from('tickets').select('*');
    if (dId) {
      q = q.or('user_id.eq.' + App.user.id + ',discord_user_id.eq.' + dId);
    } else {
      q = q.eq('user_id', App.user.id);
    }
    q.order('created_at', { ascending: false }).limit(20).then(function (r) {
      C.ticketList = (r && r.data) || [];
      if (C.mode === 'ticket' && !C.activeTicket) renderChat();
    });
  }

  function stopTicketPoll() {
    if (C.ticketPollTimer) {
      clearInterval(C.ticketPollTimer);
      C.ticketPollTimer = null;
    }
  }

  function startTicketPoll(tId) {
    stopTicketPoll();
    if (!tId || !configured) return;
    // Fast polling: ตรวจสอบข้อความใหม่ทุก 1.2 วินาที เพื่อการรับส่งที่เร็วฉับไว
    C.ticketPollTimer = setInterval(function () {
      if (document.hidden) return;
      if (C.mode !== 'ticket' || !C.activeTicket || C.activeTicket.id !== tId) {
        stopTicketPoll();
        return;
      }
      pollNewTicketMessages(tId);
    }, 1200);
  }

  function pollNewTicketMessages(tId) {
    if (!tId || !configured) return;
    var maxId = 0;
    for (var i = 0; i < C.ticketMsgs.length; i++) {
      var mid = Number(C.ticketMsgs[i].id);
      if (!isNaN(mid) && mid > maxId) maxId = mid;
    }
    var q = sb.from('ticket_messages').select('*').eq('ticket_id', tId);
    if (maxId > 0) q = q.gt('id', maxId);
    q.order('created_at', { ascending: true }).limit(50).then(function (res) {
      var rows = (res && res.data) || [];
      if (!rows.length) return;
      var changed = false;
      rows.forEach(function (m) {
        var strId = String(m.id);
        var idx = C.ticketMsgs.findIndex(function (x) {
          if (x.id && String(x.id) === strId) return true;
          if (x._pending && x.message === m.message && x.sender === m.sender) return true;
          return false;
        });
        if (idx !== -1) {
          C.ticketMsgs[idx] = m;
          changed = true;
        } else {
          C.ticketMsgs.push(m);
          changed = true;
        }
      });
      if (changed) {
        C.ticketMsgs.sort(function (a, b) {
          var ta = new Date(a.created_at || 0).getTime() || 0;
          var tb = new Date(b.created_at || 0).getTime() || 0;
          return ta - tb;
        });
        renderChat();
      }
    }).catch(function () {});
  }

  function openTicketById(tId) {
    if (!tId || !configured) return;
    sb.from('tickets').select('*').eq('id', tId).maybeSingle().then(function (r) {
      if (r && r.data) {
        C.activeTicket = r.data;
        C.mode = 'ticket';
        loadTicketMessages(tId);
        subActiveTicket(tId);
        startTicketPoll(tId);
      }
    });
  }

  function loadTicketMessages(tId) {
    if (!configured) return;
    sb.from('ticket_messages').select('*').eq('ticket_id', tId).order('created_at', { ascending: true }).limit(100).then(function (r) {
      var rows = (r && r.data) || [];
      var seenIds = new Set();
      var combined = [];
      rows.forEach(function (m) {
        var sid = String(m.id);
        if (!seenIds.has(sid)) {
          seenIds.add(sid);
          combined.push(m);
        }
      });
      // คงข้อความที่กำลังส่ง (Optimistic / Pending) ที่ฐานข้อมูลยังไม่ได้ส่งกลับมา
      C.ticketMsgs.forEach(function (m) {
        if (m._pending && !rows.some(function (x) { return x.message === m.message && x.sender === m.sender; })) {
          combined.push(m);
        }
      });
      combined.sort(function (a, b) {
        var ta = new Date(a.created_at || 0).getTime() || 0;
        var tb = new Date(b.created_at || 0).getTime() || 0;
        return ta - tb;
      });
      C.ticketMsgs = combined;
      renderChat();
    });
  }

  function subActiveTicket(tId) {
    if (C.ticketChan) { sb.removeChannel(C.ticketChan); C.ticketChan = null; }
    C.ticketChan = sb.channel('ticket-live-' + tId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ticket_messages', filter: 'ticket_id=eq.' + tId }, function (p) {
        if (p.new) {
          var strId = String(p.new.id);
          var idx = C.ticketMsgs.findIndex(function (x) {
            if (x.id && String(x.id) === strId) return true;
            // จับคู่กับข้อความ optimistic ที่ผู้ใช้เพิ่งพิมพ์ส่งไป เพื่อแทนที่ ไม่ให้แสดงซ้ำ 2 รอบ!
            if (x._pending && x.message === p.new.message && x.sender === p.new.sender) return true;
            return false;
          });
          if (idx !== -1) {
            C.ticketMsgs[idx] = p.new;
          } else {
            C.ticketMsgs.push(p.new);
          }
          C.ticketMsgs.sort(function (a, b) {
            var ta = new Date(a.created_at || 0).getTime() || 0;
            var tb = new Date(b.created_at || 0).getTime() || 0;
            return ta - tb;
          });
          renderChat();
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tickets', filter: 'id=eq.' + tId }, function (p) {
        if (p.new) {
          C.activeTicket = p.new;
          renderChat();
        }
      })
      .subscribe();
  }

  function submitNewWebTicket() {
    var tInp = $('#tTitleInp'), dInp = $('#tDetailInp');
    var title = (tInp && tInp.value || '').trim() || 'สอบถามทั่วไป';
    var detail = (dInp && dInp.value || '').trim();
    if (!detail) { toast('กรุณากรอกรายละเอียดเรื่องที่ต้องการติดต่อ', true); return; }
    var btn = $('#tSubmitNew');
    if (btn) btn.disabled = true;

    var uname = (App.profile && App.profile.username) || (App.user && App.user.email) || 'User';
    var dName = (App.profile && App.profile.discord_username) || '';
    var dId = (App.profile && App.profile.discord_id) || '';

    sb.from('tickets').insert({
      title: title,
      user_id: App.user.id,
      discord_username: dName || uname,
      discord_user_id: dId,
      status: 'open'
    }).select('*').maybeSingle().then(function (res) {
      if (res.error) {
        return sb.from('support_chats').insert({
          user_id: App.user.id,
          session_id: chatSid,
          username: uname,
          sender: 'user',
          channel: 'admin',
          message: '[Ticket: ' + title + '] ' + detail
        }).then(function () {
          toast('ส่งเรื่องถึงแอดมินเรียบร้อยแล้ว!');
          if (btn) btn.disabled = false;
          C.mode = 'admin'; loadAdminChat(); renderChat();
        });
      }
      var created = res.data;
      if (created && created.id) {
        sb.from('ticket_messages').insert({
          ticket_id: created.id,
          sender: 'user',
          sender_name: uname,
          sender_avatar: (App.profile && App.profile.discord_avatar) || '',
          message: detail,
          source: 'web'
        }).then(function () {
          if (btn) btn.disabled = false;
          toast('เปิด Ticket สำเร็จแล้ว!');
          loadUserTickets();
          openTicketById(created.id);
        });
      }
    }).catch(function (err) {
      if (btn) btn.disabled = false;
      toast(errMsg(err), true);
    });
  }

  function sendTicketMsg(q) {
    if (!App.user) { needLogin(); return; }
    if (!C.activeTicket) return;
    if (C.activeTicket.status === 'closed') {
      toast('Ticket นี้ปิดแล้ว ไม่สามารถส่งข้อความได้ (ดูประวัติได้อย่างเดียว)', true);
      return;
    }
    var msgText = (q || '').trim();
    if (!msgText) return;

    var uname = (App.profile && App.profile.username) || (App.user && App.user.email) || 'User';
    var tId = C.activeTicket.id;
    var tempId = 'temp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    // Optimistic UI: แสดงข้อความทันที (0ms Latency) พร้อมระบุ _tempId และ _pending
    var opt = {
      id: tempId,
      _tempId: tempId,
      _pending: true,
      ticket_id: tId,
      sender: 'user',
      sender_name: uname,
      sender_avatar: (App.profile && App.profile.discord_avatar) || '',
      message: msgText,
      source: 'web',
      created_at: new Date().toISOString()
    };
    C.ticketMsgs.push(opt);
    renderChat();

    sb.from('ticket_messages').insert({
      ticket_id: tId,
      sender: 'user',
      sender_name: uname,
      sender_avatar: (App.profile && App.profile.discord_avatar) || '',
      message: msgText,
      source: 'web',
      synced_to_discord: false
    }).select('*').maybeSingle().then(function (r) {
      if (r && r.error) {
        // หากส่งไม่สำเร็จ ลบ optimistic message ออก
        var fIdx = C.ticketMsgs.findIndex(function (x) { return x.id === tempId || x._tempId === tempId; });
        if (fIdx !== -1) {
          C.ticketMsgs.splice(fIdx, 1);
          renderChat();
        }
        toast(errMsg(r.error), true);
        return;
      }
      if (r && r.data) {
        // เมื่อได้รับข้อมูลจาก DB ให้แทนที่ optimistic message ด้วยข้อมูลจริง (ป้องกันการแสดงผลซ้ำ 2 รอบ)
        var idx = C.ticketMsgs.findIndex(function (x) { return x.id === tempId || x._tempId === tempId; });
        if (idx !== -1) {
          C.ticketMsgs[idx] = r.data;
          renderChat();
        }
      }
    }).catch(function (err) {
      var fIdx = C.ticketMsgs.findIndex(function (x) { return x.id === tempId || x._tempId === tempId; });
      if (fIdx !== -1) {
        C.ticketMsgs.splice(fIdx, 1);
        renderChat();
      }
      toast(errMsg(err), true);
    });
  }

  function closeActiveTicket() {
    if (!C.activeTicket) return;
    if (!confirm('ยืนยันการปิด Ticket นี้?\nเมื่อปิดแล้วจะไม่สามารถพิมพ์ข้อความได้ แต่ยังสามารถดูประวัติและลบประวัติแชทได้')) return;
    stopTicketPoll();
    var tId = C.activeTicket.id;
    sb.from('tickets').update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: (App.profile && App.profile.username) || 'User'
    }).eq('id', tId).then(function () {
      C.activeTicket.status = 'closed';
      renderChat();
      toast('ปิด Ticket เรียบร้อยแล้ว (ไม่สามารถส่งข้อความได้ แต่ยังดูประวัติได้)');
      loadUserTickets();
    });
  }

  function deleteActiveTicket(targetTicketId) {
    var tId = targetTicketId || (C.activeTicket && C.activeTicket.id);
    if (!tId) return;
    if (!confirm('ยืนยันการลบประวัติแชทของ Ticket นี้หรือไม่?\nข้อความทั้งหมดจะถูกลบถาวร ไม่สามารถกู้คืนได้')) return;
    stopTicketPoll();

    sb.from('ticket_messages').delete().eq('ticket_id', tId).then(function () {
      return sb.from('tickets').update({ status: 'closed', closed_by: 'delete_requested' }).eq('id', tId);
    }).then(function () {
      return sb.from('tickets').delete().eq('id', tId);
    }).then(function () {
      toast('🗑️ ลบประวัติแชท Ticket เรียบร้อยแล้ว');
      if (C.activeTicket && C.activeTicket.id === tId) {
        C.activeTicket = null;
        C.ticketMsgs = [];
      }
      loadUserTickets();
      renderChat();
    }).catch(function () {
      if (C.activeTicket && C.activeTicket.id === tId) {
        C.activeTicket = null;
        C.ticketMsgs = [];
      }
      loadUserTickets();
      renderChat();
      toast('🗑️ ลบประวัติแชทเรียบร้อยแล้ว');
    });
  }

  function loadAdminChat() {
    if (!App.user || !configured) return;
    sb.from('support_chats').select('*').eq('user_id', App.user.id).order('id', { ascending: true }).limit(60).then(function (r) {
      var rows = (r && r.data) || [];
      C.admMsgs = rows.filter(function (x) { return x.channel === 'admin'; });
      if (C.mode === 'admin') renderChat();
    });
  }

  function fetchStoreContext() {
    return Promise.all([
      categories(),
      sb.from('shop_products').select('*').order('featured', { ascending: false }).order('sort').limit(30),
      App.user ? sb.from('orders').select('*').eq('user_id', App.user.id).order('created_at', { ascending: false }).limit(5) : Promise.resolve({ data: [] }),
      App.user ? sb.from('topups').select('*').eq('user_id', App.user.id).order('created_at', { ascending: false }).limit(5) : Promise.resolve({ data: [] })
    ]).then(function (r) {
      return {
        cats: r[0] || [],
        prods: (r[1] && r[1].data) || [],
        orders: (r[2] && r[2].data) || [],
        topups: (r[3] && r[3].data) || []
      };
    });
  }

  function localSmartAi(q, ctx) {
    var s = (q || '').toLowerCase();
    var prods = ctx.prods || [], inStock = prods.filter(function (p) { return Number(p.stock_left) !== 0; });
    if (/เติมเงิน|พร้อมเพย์|อั่งเปา|ทรูมันนี่|โอน|uid|top.?up|promptpay/i.test(s)) {
      return '**วิธีเติมเงินเข้าระบบ SHARK Shop:**\n' +
        '1. กดเข้าหน้า [เติมเงินตอนนี้](topup.html)\n' +
        '2. เลือกจำนวนเงินและช่องทาง **พร้อมเพย์ QR** หรือ **ทรูมันนี่** (เบอร์ `066-161-2417` ชื่อบัญชี `ศุภกร สายเเวว`)\n' +
        '3. **แนบรูปสลิปการโอนเงินทุกครั้ง** แล้วกดยืนยัน รอแอดมินอนุมัติใน Discord\n' +
        '*(สำหรับการเติมเกมที่ใช้ UID ให้กรอก UID ตอนกดสั่งซื้อแพ็กเติมเกมในแต่ละครั้งได้เลยครับ ไม่ต้องตั้งค่าถาวร)*';
    }
    if (/วิธีซื้อ|สั่งซื้อยังไง|ซื้อยังไง|how to buy|ขั้นตอน/i.test(s)) {
      return '**วิธีสั่งซื้อสินค้าง่าย ๆ 4 ขั้นตอน:**\n' +
        '1. สมัครสมาชิก (ตั้งชื่อภาษาอังกฤษ) และเข้าสู่ระบบ\n' +
        '2. เติมเงินพร้อมแนบสลิปที่หน้า [เติมเงิน](topup.html)\n' +
        '3. เลือกสินค้าแล้วกด **ซื้อเลย** (หากเป็นแพ็กเติมเกมที่ใช้ UID ให้กรอก UID ตอนกดเติมเกมได้เลย)\n' +
        '4. สินค้าแบบส่งบัญชีอัตโนมัติจะแสดง **อีเมล+รหัส** หรือ **ชื่อ+รหัส** ให้ทันที และดูซ้ำได้ที่หน้า [บัญชีของฉัน](account.html) ครับ!';
    }
    if (/ออเดอร์|สถานะ|ยอดเงิน|ของฉัน|เช็ค|order|balance/i.test(s)) {
      if (!App.user) return 'กรุณาเข้าสู่ระบบก่อนครับ เพื่อให้ระบบตรวจสอบยอดเงินและสถานะออเดอร์ของคุณได้ทันที!';
      var bal = money(App.profile && App.profile.balance) + ' ฿';
      var oTxt = !ctx.orders.length ? 'ยังไม่มีออเดอร์' : ctx.orders.slice(0, 3).map(function (o) {
        var pn = (o.product_name && (o.product_name.th || o.product_name.en)) || 'สินค้า';
        return '• ' + pn + ' (' + money(o.total) + ' ฿) — สถานะ: ' + t(o.status === 'pending' ? 'o_pending' : 's_' + o.status);
      }).join('\n');
      return '**ข้อมูลบัญชีของ ' + ((App.profile && App.profile.username) || 'คุณ') + '**\n' +
        '• ยอดเงินคงเหลือ: **' + bal + '**\n' +
        '• ออเดอร์ล่าสุด:\n' + oTxt + '\n[ดูรายละเอียดที่หน้าบัญชีของฉัน](account.html)';
    }
    var matched = prods.filter(function (p) {
      return s && (nm(p).toLowerCase().indexOf(s) > -1 || nm(p, 'desc').toLowerCase().indexOf(s) > -1);
    });
    var pick = (matched.length ? matched : inStock).slice(0, 4);
    if (!pick.length) return 'ตอนนี้ยังไม่มีสินค้าที่พร้อมขายในหมวดนี้ครับ สามารถสลับไปแท็บ **คุยกับแอดมิน** เพื่อสอบถามแอดมินโดยตรงได้เลยครับ!';
    var lines = pick.map(function (p) {
      var left = Number(p.stock_left);
      var stTxt = left === 0 ? 'หมดแล้ว' : (left < 0 ? 'พร้อมส่ง' : 'เหลือ ' + left + ' ชิ้น');
      return '• **' + nm(p) + '** — ' + money(p.price) + ' ฿ (' + stTxt + ')\n  [' + nm(p) + '](product.html?id=' + p.id + ')';
    }).join('\n');
    return '**สินค้าแนะนำพร้อมส่งในร้านตอนนี้ครับ:**\n' + lines + '\n\nกดที่ปุ่มชื่อสินค้าด้านบนเพื่อเข้าไปดูรูปตัวอย่างและกดซื้อได้เลยครับ!';
  }

  /* ส่งคำถามไปยังบอท Python (bot/app.py ซึ่งเก็บ GEMINI_API_KEY) ผ่านตาราง support_chats แล้วรอรับคำตอบแบบเรียลไทม์ */
  function askBotPythonAi(q) {
    if (!configured) return Promise.resolve(null);
    var uname = (App.profile && App.profile.username) || (App.user && App.user.email) || 'Guest';
    return sb.from('support_chats').insert({
      user_id: App.user ? App.user.id : null,
      session_id: chatSid,
      username: uname,
      sender: 'user',
      channel: 'ai',
      message: q,
      replied: false
    }).select('id').maybeSingle().then(function (ins) {
      var qid = (ins && ins.data && ins.data.id) || 0;
      if (!qid) return null;
      return new Promise(function (resolve) {
        var done = false, timer = null, poll = null;
        function finish(txt, rowId) {
          if (done) return;
          done = true;
          if (rowId) C.seenAiIds[rowId] = true;
          clearTimeout(timer);
          clearInterval(poll);
          resolve(txt || null);
        }
        poll = setInterval(function () {
          sb.from('support_chats').select('id,message').eq('session_id', chatSid).eq('channel', 'ai').eq('sender', 'ai').gt('id', qid).order('id', { ascending: false }).limit(1).then(function (r) {
            var row = r && r.data && r.data[0];
            if (row && row.message) finish(row.message, row.id);
          });
        }, 1200);
        timer = setTimeout(function () { finish(null); }, 4200);
      });
    }).catch(function () { return null; });
  }

  function askAi(q) {
    C.aiMsgs.push({ sender: 'user', message: q });
    var idx = C.aiMsgs.push({ sender: 'ai', message: '...' }) - 1;
    renderChat();
    Promise.all([askBotPythonAi(q), fetchStoreContext()]).then(function (res) {
      var botAns = res[0], ctx = res[1];
      var ans = botAns || localSmartAi(q, ctx);
      if (C.aiMsgs[idx] && C.aiMsgs[idx].message === '...') {
        C.aiMsgs[idx] = { sender: 'ai', message: ans };
        renderChat();
      }
    });
  }

  function sendAdminMsg(q) {
    if (!App.user) { needLogin(); return; }
    var uname = (App.profile && App.profile.username) || App.user.email || 'User';
    C.admMsgs.push({ sender: 'user', message: q });
    renderChat();
    sb.from('support_chats').insert({
      user_id: App.user.id,
      session_id: chatSid,
      username: uname,
      sender: 'user',
      channel: 'admin',
      message: q
    }).then(function (r) {
      if (r.error) toast(errMsg(r.error), true);
    });
  }

  function initChat() {
    var win = $('#chatWin'); if (!win) return;
    App.toggleChat = function (forceMode) {
      if (forceMode) {
        C.mode = forceMode;
        win.classList.add('open');
      } else {
        win.classList.toggle('open');
      }
      var open = win.classList.contains('open');
      var bub = $('#mateBub');
      if (open) {
        if (bub) bub.classList.remove('on');
        C.unread = 0;
        var b = $('#cBadge'); if (b) b.classList.add('hide');
        if (C.mode === 'admin') loadAdminChat();
        if (C.mode === 'ticket') loadUserTickets();
        renderChat();
        setTimeout(function () { var i = $('#cInp'); if (i) i.focus(); }, 60);
      }
    };
    $$('[data-mate-open]').forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        App.toggleChat(btn.dataset.mateOpen);
      };
    });
    if ($('#mateBubX')) {
      $('#mateBubX').onclick = function (e) {
        e.stopPropagation();
        var bub = $('#mateBub');
        if (bub) { bub.dataset.dismissed = '1'; bub.classList.remove('on'); }
      };
    }
    $('#chatClose').onclick = function () {
      stopTicketPoll();
      win.classList.remove('open');
      var bub = $('#mateBub');
      if (bub && !bub.dataset.dismissed) bub.classList.add('on');
    };
    if ($('#chatClear')) {
      $('#chatClear').onclick = function () {
        if (C.mode === 'ticket') {
          if (C.activeTicket) {
            deleteActiveTicket();
          } else {
            toast('กรุณาเลือก Ticket ที่ต้องการลบประวัติ', true);
          }
          return;
        }
        if (!confirm(t('clearChatQ'))) return;
        var curMode = C.mode;
        if (curMode === 'ai') C.aiMsgs = [];
        else C.admMsgs = [];
        renderChat();
        if (configured) {
          sb.rpc('clear_my_chats', { p_channel: curMode, p_session: chatSid }).then(function (r) {
            if (r && r.error) {
              if (App.user) sb.from('support_chats').delete().eq('user_id', App.user.id).eq('channel', curMode);
              else sb.from('support_chats').delete().eq('session_id', chatSid).eq('channel', curMode);
            }
          });
        }
        toast(t('chatCleared'));
      };
    }
    $$('[data-cmode]').forEach(function (b) {
      b.onclick = function () {
        if (C.mode === 'ticket' && b.dataset.cmode !== 'ticket') {
          stopTicketPoll();
        }
        C.mode = b.dataset.cmode;
        if (C.mode === 'admin') loadAdminChat();
        if (C.mode === 'ticket') loadUserTickets();
        renderChat();
      };
    });
    window.addEventListener('focus', function () {
      if (C.mode === 'ticket' && C.activeTicket && C.activeTicket.id) {
        pollNewTicketMessages(C.activeTicket.id);
      }
    });
    $$('[data-cq]').forEach(function (b) {
      b.onclick = function () {
        var k = b.dataset.cq;
        var map = { rec: 'แนะนำสินค้าขายดีในร้านตอนนี้ให้หน่อย', top: 'วิธีเติมเงินทำยังไง', buy: 'วิธีสั่งซื้อสินค้าทำยังไง', me: 'เช็คยอดเงินและสถานะออเดอร์ของฉัน' };
        C.mode = 'ai';
        askAi(map[k] || b.textContent);
      };
    });
    $('#cForm').onsubmit = function (e) {
      e.preventDefault();
      var inp = $('#cInp'), v = (inp.value || '').trim();
      if (!v) return;
      inp.value = '';
      if (C.mode === 'ai') askAi(v);
      else if (C.mode === 'ticket') sendTicketMsg(v);
      else sendAdminMsg(v);
    };
    on('bot_ai_reply', function (msg) {
      if (!msg || C.seenAiIds[msg.id]) return;
      C.seenAiIds[msg.id] = true;
      var last = C.aiMsgs[C.aiMsgs.length - 1];
      if (last && last.sender === 'ai') last.message = msg.message;
      else C.aiMsgs.push({ sender: 'ai', message: msg.message });
      if (win.classList.contains('open')) renderChat();
    });
    on('chat_msg', function (msg) {
      if (msg.channel === 'ai') {
        if (msg.id && C.seenAiIds[msg.id]) return;
        if (msg.id) C.seenAiIds[msg.id] = true;
        var last = C.aiMsgs[C.aiMsgs.length - 1];
        if (last && last.sender === 'ai') last.message = msg.message;
        else C.aiMsgs.push(msg);
      } else {
        C.admMsgs.push(msg);
        toast(t('adminReplied'));
      }
      if (win.classList.contains('open')) {
        renderChat();
      } else {
        C.unread++;
        var b = $('#cBadge');
        if (b) { b.textContent = C.unread; b.classList.remove('hide'); }
      }
    });
    on('auth', function () {
      if (App.user) {
        loadAdminChat();
        loadUserTickets();
      }
    });
  }

  /* ------------------------------------------------------------------ ระบบประกาศหน้าเว็บ (Announcements System API) */
  App.getAnnouncements = function () {
    if (!configured) return Promise.resolve([]);
    return sb.from('announcements')
      .select('*')
      .order('priority', { ascending: false })
      .order('starts_at', { ascending: false })
      .order('created_at', { ascending: false })
      .then(function (res) {
        if (res && res.error) {
          return getAppSettingsAnnouncements();
        }
        return (res && res.data) || [];
      }).catch(function () {
        return getAppSettingsAnnouncements();
      });
  };

  App.saveAnnouncement = function (item) {
    if (!configured) return Promise.reject(new Error('Not configured'));
    var nowIso = new Date().toISOString();
    var payload = {
      title: (item.title || '').trim(),
      content: (item.content || '').trim(),
      type: item.type || 'info',
      badge: (item.badge || '').trim(),
      image_url: (item.image_url || '').trim(),
      link_url: (item.link_url || '').trim(),
      link_text: (item.link_text || '').trim(),
      is_active: item.is_active !== false,
      priority: Number(item.priority) || 0,
      starts_at: item.starts_at || nowIso,
      ends_at: item.ends_at || null,
      updated_at: nowIso
    };

    if (item.id && !String(item.id).startsWith('local_')) {
      return sb.from('announcements').update(payload).eq('id', item.id).select('*').maybeSingle().then(function (r) {
        if (r && r.error) {
          return updateAnnouncementInAppSettings(item.id, payload);
        }
        emit('announcement_change');
        return r && r.data;
      }).catch(function () {
        return updateAnnouncementInAppSettings(item.id, payload);
      });
    } else {
      payload.created_at = nowIso;
      return sb.from('announcements').insert(payload).select('*').maybeSingle().then(function (r) {
        if (r && r.error) {
          return insertAnnouncementInAppSettings(payload);
        }
        emit('announcement_change');
        return r && r.data;
      }).catch(function () {
        return insertAnnouncementInAppSettings(payload);
      });
    }
  };

  App.deleteAnnouncement = function (id) {
    if (!id || !configured) return Promise.reject(new Error('No ID'));
    return sb.from('announcements').delete().eq('id', id).then(function (r) {
      if (r && r.error) {
        return deleteAnnouncementFromAppSettings(id);
      }
      emit('announcement_change');
      return true;
    }).catch(function () {
      return deleteAnnouncementFromAppSettings(id);
    });
  };

  function getAppSettingsAnnouncements() {
    return sb.from('app_settings').select('value').eq('key', 'announcements').maybeSingle().then(function (res) {
      if (res && res.data && res.data.value) {
        try { return JSON.parse(res.data.value) || []; } catch (e) {}
      }
      return [];
    }).catch(function () { return []; });
  }

  function saveAppSettingsAnnouncements(list) {
    var str = JSON.stringify(list || []);
    return sb.from('app_settings').upsert({ key: 'announcements', value: str, updated_at: new Date().toISOString() }).then(function () {
      emit('announcement_change');
    });
  }

  function insertAnnouncementInAppSettings(payload) {
    return getAppSettingsAnnouncements().then(function (list) {
      payload.id = 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      list.unshift(payload);
      return saveAppSettingsAnnouncements(list).then(function () { return payload; });
    });
  }

  function updateAnnouncementInAppSettings(id, payload) {
    return getAppSettingsAnnouncements().then(function (list) {
      var idx = list.findIndex(function (x) { return String(x.id) === String(id); });
      if (idx !== -1) {
        payload.id = id;
        list[idx] = Object.assign({}, list[idx], payload);
      } else {
        payload.id = id;
        list.unshift(payload);
      }
      return saveAppSettingsAnnouncements(list).then(function () { return payload; });
    });
  }

  function deleteAnnouncementFromAppSettings(id) {
    return getAppSettingsAnnouncements().then(function (list) {
      var filtered = list.filter(function (x) { return String(x.id) !== String(id); });
      return saveAppSettingsAnnouncements(filtered).then(function () { return true; });
    });
  }

  /* คัดกรองและเรียงลำดับประกาศ: แยก active, scheduled, expired และคำนวณเวลาที่ประกาศปัจจุบันจะหมดอายุเพื่อแทนที่ด้วยประกาศถัดไป */
  App.filterAnnouncements = function (allList) {
    var now = new Date();
    var list = (allList || []).slice();

    // เรียง priority สูงสุดก่อน แล้วตามด้วยวันที่สร้างล่าสุด
    list.sort(function (a, b) {
      var pa = Number(a.priority) || 0, pb = Number(b.priority) || 0;
      if (pa !== pb) return pb - pa;
      var ta = new Date(a.starts_at || a.created_at || 0).getTime() || 0;
      var tb = new Date(b.starts_at || b.created_at || 0).getTime() || 0;
      return tb - ta;
    });

    var activeList = [];
    var scheduledList = [];
    var expiredList = [];
    var futureTimestamps = [];

    list.forEach(function (a) {
      if (!a.is_active) return;
      var sDate = a.starts_at ? new Date(a.starts_at) : null;
      var eDate = a.ends_at ? new Date(a.ends_at) : null;

      if (sDate && sDate > now) {
        scheduledList.push(a);
        futureTimestamps.push(sDate.getTime());
      } else if (eDate && eDate <= now) {
        expiredList.push(a);
      } else {
        activeList.push(a);
        if (eDate) futureTimestamps.push(eDate.getTime());
      }
    });

    var nextTransitionMs = null;
    if (futureTimestamps.length > 0) {
      futureTimestamps.sort(function (a, b) { return a - b; });
      var earliest = futureTimestamps[0];
      var diff = earliest - now.getTime();
      if (diff > 0 && diff < 86400000 * 30) {
        nextTransitionMs = diff;
      }
    }

    return {
      activeList: activeList,
      current: activeList[0] || null,
      scheduledList: scheduledList,
      expiredList: expiredList,
      nextTransitionMs: nextTransitionMs
    };
  };
})();
