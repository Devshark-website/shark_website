/* SHARK Shop - ระบบหลังร้าน (Admin Backoffice)
   ตรวจสลิปเติมเงิน, ส่งออเดอร์, ลบประวัติซื้อขาย/เติมเงิน/แชท, ส่งบัญชีอัตโนมัติ (อีเมล+รหัส / ชื่อ+รหัส), อัปโหลดรูปจากเครื่องโดยตรง, ลบบัญชีผู้ใช้ */
(function () {
  var $ = App.$, $$ = App.$$, esc = App.esc, money = App.money, nm = App.nm, t = I18N.t, sb = App.sb;
  var st = { tab: 'dash', tf: 'pending', of: 'pending', pf: 'all', lf: 'all', uq: '', cats: [], prods: [] };
  var admChan = null, activeChatUser = null, activeChatName = '', activeChatUid = '';

  function boot() {
    var w = $('#admWrap');
    if (!App.user) return App.lock(w, t('aNeed'), t('needLoginS'));
    if (!App.profile || !App.profile.is_admin) {
      w.innerHTML = '<div class="panel lock"><h3>' + esc(t('aNeed')) + '</h3><p>' + esc(t('aNotAdmin')) + '</p>' +
        '<p class="mute" style="margin-top:8px">User: <b>' + esc((App.profile && App.profile.username) || App.user.email) + '</b></p></div>';
      return;
    }
    subRealtime();
    drawShell();
  }

  function subRealtime() {
    if (admChan || !App.configured) return;
    admChan = sb.channel('adm-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'topups' }, function () {
        App.toast(t('newTopup')); if (st.tab === 'dash' || st.tab === 'topups') loadTab();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, function () {
        App.toast(t('newOrder')); if (st.tab === 'dash' || st.tab === 'orders') loadTab();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'admin_logs' }, function (payload) {
        var row = payload && payload.new;
        if (row && row.title) App.toast(row.title);
        loadTab();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_chats' }, function (payload) {
        var row = payload && payload.new;
        if (row && row.channel === 'admin') {
          if (row.sender === 'user') {
            App.toast(t('newChatMsg') + ': ' + (row.username || 'ลูกค้า') + ' - "' + (row.message || '').slice(0, 32) + '"');
          }
          if (activeChatUser && (row.user_id === activeChatUser || row.session_id === activeChatUser)) {
            appendLiveChatMessage(row);
          }
          if (st.tab === 'chats') loadChats();
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'support_chats' }, function (payload) {
        var old = payload && payload.old;
        if (old && old.id) {
          var el = document.getElementById('fc-msg-' + old.id);
          if (el) el.remove();
          var pEl = document.getElementById('chat-item-' + old.id);
          if (pEl) pEl.remove();
        }
        if (st.tab === 'chats') loadChats();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'account_alerts' }, function (payload) {
        var a = payload && payload.new;
        if (a) {
          pushAlertToWebhookClient(a);
          if (st.tab === 'users') loadUsers();
        }
      })
      .subscribe();
  }

  /* ส่งแจ้งเตือนเข้า Discord Webhook จากฝั่งเบราว์เซอร์สำรองอีกชั้น (ทำงานได้แม้ฐานข้อมูลไม่ได้เปิด pg_net) */
  function getSavedWebhookUrl() {
    return (window.S && S.get('discord_webhook_url', '')) || '';
  }

  function buildAlertDiscordPayload(a) {
    var s = (a && a.snapshot) || {};
    var evMap = {
      ban: '🚫 บัญชีถูกระงับการใช้งาน (Account Suspended)',
      unban: '🟢 ปลดระงับบัญชีผู้ใช้ (Account Unsuspended)',
      self_delete: '🗑️ สมาชิกลบบัญชีตัวเอง (Self-Deleted Account)',
      delete: '🗑️ บัญชีถูกลบโดยแอดมิน (Deleted by Admin)'
    };
    var colorMap = { unban: 0x3EE98A, ban: 0xFFC857, self_delete: 0xFF5D8F, delete: 0xFF5C5C };
    var balStr = money(a.balance || s.balance || 0) + ' ฿';
    var f = function (name, val, inl) {
      return { name: String(name).slice(0, 250), value: String(val || '-').slice(0, 1000), inline: inl !== false };
    };
    var fields = [
      f('👤 ชื่อผู้ใช้ (Username)', '`' + (a.username || s.username || '-') + '`'),
      f('📧 อีเมล (Email)', a.email || s.email || '-'),
      f('💰 ยอดเงินคงเหลือในบัญชี', '**' + balStr + '**'),
      f('💳 ยอดเติมเงินสะสม', money(s.topup_total || 0) + ' ฿ (' + (s.topup_count || 0) + ' ครั้ง)'),
      f('🛒 ยอดสั่งซื้อสะสม', money(s.spent_total || 0) + ' ฿ (' + (s.order_count || 0) + ' ออเดอร์)'),
      f('🛠️ แอดมินปรับยอดสะสม', money(s.admin_adjust_total || 0) + ' ฿'),
      f('⏳ รายการเติมเงินค้างตรวจ', (s.pending_topup_count || 0) + ' รายการ (' + money(s.pending_topup_sum || 0) + ' ฿)'),
      f('📦 ออเดอร์ค้างส่ง', (s.pending_order_count || 0) + ' รายการ (' + money(s.pending_order_sum || 0) + ' ฿)'),
      f('👑 สิทธิ์บัญชี', s.is_admin ? 'แอดมินเว็บ (ADMIN)' : 'สมาชิกทั่วไป'),
      f('📅 สมัครสมาชิกเมื่อ', s.created_at ? App.fmtTime(s.created_at) : '-'),
      f('🕒 เข้าสู่ระบบล่าสุด', s.last_sign_in_at ? App.fmtTime(s.last_sign_in_at) : '-'),
      f('🆔 รหัสบัญชี (User ID)', '`' + (a.user_id || s.user_id || '-') + '`', false)
    ];
    if (s.last_order && s.last_order.name) {
      fields.push(f('🧾 ออเดอร์ล่าสุด', s.last_order.name + ' × ' + (s.last_order.qty || 1) + ' (' + money(s.last_order.total || 0) + ' ฿ · ' + (s.last_order.status || '-') + (s.last_order.input ? ' · UID: ' + s.last_order.input : '') + ')', false));
    }
    return {
      username: 'SHARK Shop Security & Balance Alert',
      content: a.event === 'unban'
        ? '🟢 **ปลดระงับบัญชี `' + (a.username || '-') + '`** — ยอดเงินปัจจุบัน **' + balStr + '**'
        : '🚨 **แจ้งเตือนสำคัญ! บัญชี `' + (a.username || '-') + '` (' + (evMap[a.event] || a.event) + ')** — ยอดเงินในบัญชีขณะนั้น: **' + balStr + '**',
      embeds: [{
        title: (evMap[a.event] || '🔔 แจ้งเตือนบัญชี') + ': ' + (a.username || '-'),
        description: a.reason ? '**📌 สาเหตุ / หมายเหตุ:** ' + a.reason : 'บันทึกข้อมูลบัญชีและยอดเงินคงเหลืออัตโนมัติจากระบบ SHARK Shop',
        color: colorMap[a.event] || 0xFF5C5C,
        fields: fields,
        footer: { text: 'ดำเนินการโดย ' + (a.actor || 'Admin') + (a.id ? ' • Alert #' + a.id : '') + ' • ' + App.fmtTime(a.created_at || new Date().toISOString()) }
      }]
    };
  }

  function pushAlertToWebhookClient(a, force) {
    if (!a || (a.webhook_sent && !force)) return Promise.resolve(false);
    var url = getSavedWebhookUrl();
    if (!/^https:\/\/(canary\.|ptb\.)?(discord\.com|discordapp\.com)\/api\/webhooks\//i.test(url)) return Promise.resolve(false);
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildAlertDiscordPayload(a))
    }).then(function (res) {
      if (res && res.ok && a.id) {
        sb.from('account_alerts').update({ webhook_sent: true }).eq('id', a.id).then(function () {});
      }
      return !!(res && res.ok);
    }).catch(function () { return false; });
  }

  function drawShell() {
    var w = $('#admWrap');
    var tabs = [['dash', 'aDash'], ['topups', 'aTop'], ['orders', 'aOrd'], ['products', 'aProd'], ['cats', 'aCats'], ['users', 'aUsers'], ['chats', 'aChats'], ['logs', 'aLogs']].map(function (x) {
      return '<button type="button" class="tab' + (st.tab === x[0] ? ' on' : '') + '" data-atab="' + x[0] + '">' + esc(t(x[1])) + '</button>';
    }).join('');
    w.innerHTML = '<div class="sh"><div><h2 data-i18n="aTitle">' + esc(t('aTitle')) + '</h2></div></div>' +
      '<div class="tabs">' + tabs + '</div><div id="aBody"></div>';
    $$('[data-atab]').forEach(function (b) { b.onclick = function () { st.tab = b.dataset.atab; drawShell(); }; });
    loadTab();
  }

  function loadTab() {
    if (st.tab === 'dash') return loadDash();
    if (st.tab === 'topups') return loadTopups();
    if (st.tab === 'orders') return loadOrders();
    if (st.tab === 'products') return loadProducts();
    if (st.tab === 'cats') return loadCats();
    if (st.tab === 'users') return loadUsers();
    if (st.tab === 'chats') return loadChats();
    if (st.tab === 'logs') return loadLogs();
  }

  function renderLogRow(x) {
    var isBad = /out|del|ban/.test(x.event_type || '');
    var isWarn = /admin|balance/.test(x.event_type || '');
    var tagCls = isBad ? 'st bad' : (isWarn ? 'st warn' : 'st');
    return '<div class="arow"><div>' +
      '<div><b>' + esc(x.title || '-') + '</b> &middot; <span class="' + tagCls + '">' + esc(x.actor || 'Admin') + '</span></div>' +
      '<div class="mute" style="font-size:.9rem;margin-top:4px">' + esc(x.detail || '-') + '</div></div>' +
      '<div class="rowtools"><small class="mute">' + esc(App.fmtTime(x.created_at)) + '</small></div></div>';
  }

  function blobToDataUrl(blob) {
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(blob); });
  }

  /* ------------------------------------------------------------------ 1) Dashboard */
  function loadDash() {
    Promise.all([
      sb.rpc('admin_stats'),
      sb.from('admin_logs').select('*').order('id', { ascending: false }).limit(8)
    ]).then(function (all) {
      var r = all[0] || {}, logRes = all[1] || {};
      var b = $('#aBody'); if (!b) return;
      if (r.error) { b.innerHTML = '<div class="panel lock">' + esc(App.err(r.error)) + '</div>'; return; }
      var d = r.data || {}, daily = d.daily || [], max = Math.max.apply(null, daily.map(function (x) { return Number(x.v) || 0; }).concat([1]));
      var logs = (logRes && logRes.data) || [];
      var logHtml = !logs.length ? '<div class="lock">' + esc(t('noLogs')) + '</div>' : logs.map(renderLogRow).join('');
      b.innerHTML = '<div class="sh" style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">' +
          '<h3 style="margin:0">' + esc(t('stSalesOverview')) + '</h3>' +
          '<button type="button" class="btn xs danger" id="resetSalesBtn">' + esc(t('resetSales')) + '</button>' +
        '</div>' +
        '<div class="kpis">' +
        '<div class="kpi warn" data-goto="topups" style="cursor:pointer"><small>' + esc(t('stPT')) + '</small><b>' + (d.pending_topups || 0) + '</b></div>' +
        '<div class="kpi warn" data-goto="orders" style="cursor:pointer"><small>' + esc(t('stPO')) + '</small><b>' + (d.pending_orders || 0) + '</b></div>' +
        '<div class="kpi"><small>' + esc(t('stToday')) + '</small><b>' + money(d.sales_today) + ' ฿</b></div>' +
        '<div class="kpi"><small>' + esc(t('st30')) + '</small><b>' + money(d.sales_30d) + ' ฿</b></div>' +
        '<div class="kpi"><small>' + esc(t('stTop30')) + '</small><b>' + money(d.topup_30d) + ' ฿</b></div>' +
        '<div class="kpi"><small>' + esc(t('stUsers')) + '</small><b>' + (d.users || 0) + '</b></div>' +
        '<div class="kpi"><small>' + esc(t('stBal')) + '</small><b>' + money(d.balance_total) + ' ฿</b></div>' +
      '</div>' +
      '<div class="panel"><h3>' + esc(t('st14')) + '</h3><div class="chart">' +
        daily.map(function (x) {
          var v = Number(x.v) || 0, h = Math.max(4, Math.round((v / max) * 120));
          return '<div class="barcol"><span>' + (v ? money(v) : '') + '</span><div class="bar" style="height:' + h + 'px"></div><small>' + esc(String(x.d).slice(5)) + '</small></div>';
        }).join('') +
      '</div></div>' +
      '<div class="panel" style="margin-top:18px;padding:0;overflow:hidden">' +
        '<div class="sh" style="padding:16px 18px;margin:0;border-bottom:1px solid var(--line)"><h3>' + esc(t('recentLogs')) + '</h3>' +
        '<button type="button" class="btn xs ghost" data-goto="logs">' + esc(t('viewAll')) + '</button></div>' +
        logHtml +
      '</div>';
      $$('[data-goto]', b).forEach(function (el) { el.onclick = function () { st.tab = el.dataset.goto; drawShell(); }; });
      if ($('#resetSalesBtn')) $('#resetSalesBtn').onclick = function () { askResetSales(this); };
    });
  }

  function askResetSales(btn) {
    if (!confirm(t('resetSalesQ'))) return;
    if (btn) btn.disabled = true;
    sb.rpc('admin_reset_sales', { p_clear_orders: true, p_reset_product_sold: true }).then(function (res) {
      if (btn) btn.disabled = false;
      if (res && res.error) return App.toast(App.err(res.error), true);
      App.toast(t('salesResetOk'));
      loadTab();
    });
  }

  /* ------------------------------------------------------------------ 2) Top-ups (พร้อมปุ่มลบประวัติเติมเงิน) */
  function loadTopups() {
    var q = sb.from('topups').select('*, profiles(username)').order('created_at', { ascending: false }).limit(100);
    if (st.tf !== 'all') q = q.eq('status', st.tf);
    q.then(function (r) {
      var b = $('#aBody'); if (!b) return;
      var list = (r && r.data) || [];
      var fs = [['pending', 'fPending'], ['approved', 'fApproved'], ['rejected', 'fRejected'], ['all', 'fAll']].map(function (x) {
        return '<button type="button" class="opt' + (st.tf === x[0] ? ' on' : '') + '" data-tf="' + x[0] + '">' + esc(t(x[1])) + '</button>';
      }).join('');
      var rows = !list.length ? '<div class="lock">' + esc(t('noTopups')) + '</div>' : list.map(function (x) {
        var u = (x.profiles && x.profiles.username) || x.user_id.slice(0, 8);
        var isUrl = /^https?:\/\//i.test(x.ref || '');
        var refHtml = x.ref ? (isUrl ? '<a href="' + esc(x.ref) + '" target="_blank" rel="noopener">' + esc(x.ref) + '</a>' : esc(x.ref)) : '-';
        var slipBtn = x.slip_path ? '<button type="button" class="btn xs ghost" data-slip="' + esc(x.slip_path) + '">' + esc(t('openSlip')) + '</button>' : '<small class="mute">' + esc(t('noSlip')) + '</small>';
        var act = x.status === 'pending'
          ? '<input class="inp" style="width:110px;padding:7px 10px" type="number" step="0.01" value="' + x.amount + '" data-tamt="' + x.id + '">' +
            '<input class="inp" style="width:150px;padding:7px 10px" placeholder="' + esc(t('reason')) + '" data-tnote="' + x.id + '">' +
            '<button type="button" class="btn xs ok" data-trev="' + x.id + '" data-ok="1">' + esc(t('approve')) + '</button>' +
            '<button type="button" class="btn xs danger" data-trev="' + x.id + '" data-ok="0">' + esc(t('reject')) + '</button>'
          : App.statusTag(x.status, 'topup');
        var delBtn = '<button type="button" class="btn xs danger" data-tdel="' + x.id + '" title="' + esc(t('delTopup')) + '">' + esc(t('delTopup')) + '</button>';
        var uidHtml = x.game_uid ? '<div style="margin-top:4px">🎮 UID: <b style="color:var(--cyan)">' + esc(x.game_uid) + '</b> <button type="button" class="btn xs ghost" data-cp="' + esc(x.game_uid) + '">' + esc(t('copy')) + '</button></div>' : '';
        return '<div class="arow"><div>' +
          '<div><b>' + esc(u) + '</b> &middot; <span style="color:var(--cyan);font-weight:700">' + money(x.amount) + ' ฿</span> &middot; ' + esc(t('m_' + x.method)) + ' &middot; <small class="mute">' + esc(App.fmtTime(x.created_at)) + '</small></div>' +
          uidHtml +
          '<div class="mute" style="font-size:.9rem;margin-top:4px">Ref: ' + refHtml + (x.note ? ' &middot; Note: ' + esc(x.note) : '') + '</div></div>' +
          '<div class="rowtools">' + slipBtn + act + delBtn + '</div></div>';
      }).join('');
      b.innerHTML = '<div class="sh" style="margin-bottom:14px"><div class="chips">' + fs + '</div>' +
        '<button type="button" class="btn xs danger" id="clearTopupsBtn">' + esc(t('clearAllTopups')) + '</button></div>' +
        '<div class="panel" style="padding:0;overflow:hidden">' + rows + '</div>';
      $$('[data-tf]', b).forEach(function (btn) { btn.onclick = function () { st.tf = btn.dataset.tf; loadTopups(); }; });
      $$('[data-cp]', b).forEach(function (btn) { btn.onclick = function () { App.copy(btn.dataset.cp); }; });
      $$('[data-slip]', b).forEach(function (btn) { btn.onclick = function () {
        sb.storage.from('slips').createSignedUrl(btn.dataset.slip, 300).then(function (res) {
          if (res.data && res.data.signedUrl) { $('#lbImg').src = res.data.signedUrl; $('#lb').classList.add('open'); }
          else App.toast(App.err(res.error), true);
        });
      }; });
      $$('[data-trev]', b).forEach(function (btn) { btn.onclick = function () {
        var id = btn.dataset.trev, ok = btn.dataset.ok === '1';
        var amtEl = $('[data-tamt="' + id + '"]'), noteEl = $('[data-tnote="' + id + '"]');
        btn.disabled = true;
        sb.rpc('admin_review_topup', { p_id: id, p_approve: ok, p_note: noteEl ? noteEl.value.trim() : '', p_amount: amtEl ? Number(amtEl.value) : null }).then(function (res) {
          btn.disabled = false;
          if (res.error) return App.toast(App.err(res.error), true);
          App.toast(t('saved')); loadTopups(); App.refreshProfile();
        });
      }; });
      $$('[data-tdel]', b).forEach(function (btn) { btn.onclick = function () {
        if (!confirm(t('delTopupQ'))) return;
        var id = btn.dataset.tdel;
        btn.disabled = true;
        sb.rpc('admin_delete_topup', { p_id: id, p_clear_all: false }).then(function (res) {
          if (res.error) return sb.from('topups').delete().eq('id', id);
          return res;
        }).then(function (res) {
          btn.disabled = false;
          if (res && res.error) return App.toast(App.err(res.error), true);
          App.toast(t('saved')); loadTopups();
        });
      }; });
      if ($('#clearTopupsBtn')) $('#clearTopupsBtn').onclick = function () {
        if (!confirm(t('clearAllTopupsQ'))) return;
        sb.rpc('admin_delete_topup', { p_id: null, p_clear_all: true }).then(function (res) {
          if (res.error) return App.toast(App.err(res.error), true);
          App.toast(t('saved')); loadTopups();
        });
      };
    });
  }

  /* ------------------------------------------------------------------ 3) Orders (พร้อมปุ่มลบประวัติการซื้อขาย) */
  function loadOrders() {
    var q = sb.from('orders').select('*, profiles(username)').order('created_at', { ascending: false }).limit(100);
    if (st.of !== 'all') q = q.eq('status', st.of);
    q.then(function (r) {
      var b = $('#aBody'); if (!b) return;
      var list = (r && r.data) || [];
      var fs = [['pending', 'fPending'], ['done', 'fDone'], ['cancelled', 'fCancelled'], ['all', 'fAll']].map(function (x) {
        return '<button type="button" class="opt' + (st.of === x[0] ? ' on' : '') + '" data-of="' + x[0] + '">' + esc(t(x[1])) + '</button>';
      }).join('');
      var rows = !list.length ? '<div class="lock">' + esc(t('noOrders')) + '</div>' : list.map(function (o) {
        var u = (o.profiles && o.profiles.username) || o.user_id.slice(0, 8), pName = I18N.pick(o.product_name) || '-';
        return '<div class="arow"><div>' +
          '<div><b>' + esc(pName) + ' &times; ' + o.qty + '</b> (' + money(o.total) + ' ฿) &middot; ' + esc(t('user')) + ': <b>' + esc(u) + '</b> &middot; <small class="mute">' + esc(App.fmtTime(o.created_at)) + '</small> &middot; ' + App.statusTag(o.status, 'order') + '</div>' +
          (o.customer_input ? '<div style="margin-top:6px"><span class="mute">' + esc(t('yourInput')) + ':</span> <b style="color:var(--cyan)">' + esc(o.customer_input) + '</b> <button type="button" class="btn xs ghost" data-cp="' + esc(o.customer_input) + '">' + esc(t('copy')) + '</button></div>' : '') +
          '<textarea class="inp" style="margin-top:8px;min-height:60px" placeholder="' + esc(t('delNote')) + '" data-odel="' + o.id + '">' + esc(o.delivered || '') + '</textarea>' +
          '</div><div class="rowtools">' +
            (o.status !== 'cancelled' ? '<button type="button" class="btn xs ok" data-oupd="' + o.id + '" data-st="done">' + esc(t('markDone')) + '</button>' : '') +
            (o.status !== 'cancelled' ? '<button type="button" class="btn xs ghost" data-oupd="' + o.id + '" data-st="cancelled">' + esc(t('cancelRefund')) + '</button>' : '') +
            '<button type="button" class="btn xs danger" data-odelbtn="' + o.id + '">' + esc(t('delOrder')) + '</button>' +
          '</div></div>';
      }).join('');
      b.innerHTML = '<div class="sh" style="margin-bottom:14px;flex-wrap:wrap;gap:10px"><div class="chips">' + fs + '</div>' +
        '<div class="rowtools">' +
          '<button type="button" class="btn xs danger" id="resetSalesOrdBtn">' + esc(t('resetSales')) + '</button>' +
          '<button type="button" class="btn xs ghost danger" id="clearOrdersBtn">' + esc(t('clearAllOrders')) + '</button>' +
        '</div></div>' +
        '<div class="panel" style="padding:0;overflow:hidden">' + rows + '</div>';
      $$('[data-of]', b).forEach(function (btn) { btn.onclick = function () { st.of = btn.dataset.of; loadOrders(); }; });
      $$('[data-cp]', b).forEach(function (btn) { btn.onclick = function () { App.copy(btn.dataset.cp); }; });
      $$('[data-oupd]', b).forEach(function (btn) { btn.onclick = function () {
        var id = btn.dataset.oupd, s = btn.dataset.st;
        if (s === 'cancelled' && !confirm(t('confirmCancel'))) return;
        var del = ($('[data-odel="' + id + '"]') && $('[data-odel="' + id + '"]').value) || '';
        sb.rpc('admin_update_order', { p_id: id, p_status: s, p_delivered: del }).then(function (res) {
          if (res.error) return App.toast(App.err(res.error), true);
          App.toast(t('saved')); loadOrders();
        });
      }; });
      $$('[data-odelbtn]', b).forEach(function (btn) { btn.onclick = function () {
        if (!confirm(t('delOrderQ'))) return;
        var id = btn.dataset.odelbtn;
        btn.disabled = true;
        sb.rpc('admin_delete_order', { p_id: id, p_clear_all: false }).then(function (res) {
          if (res.error) return sb.from('orders').delete().eq('id', id);
          return res;
        }).then(function (res) {
          btn.disabled = false;
          if (res && res.error) return App.toast(App.err(res.error), true);
          App.toast(t('saved')); loadOrders();
        });
      }; });
      if ($('#resetSalesOrdBtn')) $('#resetSalesOrdBtn').onclick = function () {
        askResetSales(this);
      };
      if ($('#clearOrdersBtn')) $('#clearOrdersBtn').onclick = function () {
        if (!confirm(t('clearAllOrdersQ'))) return;
        sb.rpc('admin_delete_order', { p_id: null, p_clear_all: true }).then(function (res) {
          if (res.error) return App.toast(App.err(res.error), true);
          App.toast(t('saved')); loadOrders();
        });
      };
    });
  }

  /* ------------------------------------------------------------------ 4) Products & Auto Account Delivery (เลือก อีเมล+รหัส หรือ ชื่อ+รหัส & อัปโหลดไฟล์รูปโดยตรง) */
  function loadProducts() {
    Promise.all([
      sb.from('categories').select('*').order('sort').order('created_at'),
      sb.from('products').select('*').order('sort').order('created_at', { ascending: false }),
      sb.from('product_codes').select('product_id').is('order_id', null)
    ]).then(function (r) {
      st.cats = (r[0] && r[0].data) || [];
      st.prods = (r[1] && r[1].data) || [];
      var free = {};
      ((r[2] && r[2].data) || []).forEach(function (c) { free[c.product_id] = (free[c.product_id] || 0) + 1; });
      var b = $('#aBody'); if (!b) return;
      var cf = '<button type="button" class="opt' + (st.pf === 'all' ? ' on' : '') + '" data-pf="all">' + esc(t('allCats')) + '</button>' +
        st.cats.map(function (c) { return '<button type="button" class="opt' + (st.pf === c.id ? ' on' : '') + '" data-pf="' + c.id + '">' + esc(nm(c)) + '</button>'; }).join('');
      var list = st.prods.filter(function (p) { return st.pf === 'all' || p.category_id === st.pf; });
      var cards = !list.length ? '<div class="empty">' + esc(t('noItems')) + '</div>' : list.map(function (p) {
        var n = nm(p), left = p.stock === 0 ? 0 : (p.delivery === 'code' ? (free[p.id] || 0) : p.stock);
        var isOut = left === 0;
        var credTag = p.delivery === 'code' ? (p.credential_type === 'user_pass' ? '👤 ' : '📧 ') : '';
        var stBadge = '<span class="badge' + (isOut ? ' out' : '') + '">' + (isOut ? esc(t('soldOut')) : (p.delivery === 'code' ? '&#9889; ' + credTag + left + ' บัญชี' : (left < 0 ? '&infin;' : left))) + '</span>';
        var off = !p.active ? '<span class="badge out" style="left:auto;right:12px">' + esc(t('inactive')) + '</span>' : '';
        return '<article class="card"><div class="thumb">' + stBadge + off + '<img alt="" src="' + esc(App.cover(p)) + '"></div>' +
          '<div class="cb"><h3>' + esc(n) + '</h3><div class="pr"><span class="price">' + money(p.price) + ' ฿</span><small class="mute">' + esc(t('sold')) + ' ' + p.sold + '</small></div>' +
          '<div class="rowtools" style="margin-top:8px">' +
            '<button type="button" class="btn xs" style="flex:1" data-ep="' + p.id + '">' + esc(t('edit')) + ' / ' + esc(t('codes')) + '</button>' +
            '<button type="button" class="btn xs ' + (p.stock === 0 ? 'ok' : 'ghost') + '" data-out="' + p.id + '" title="สลับสถานะ สินค้าหมด / พร้อมขาย">' + esc(p.stock === 0 ? t('unlimited') : t('soldOut')) + '</button>' +
            '<button type="button" class="btn xs danger" data-dp="' + p.id + '">&times;</button>' +
          '</div></div></article>';
      }).join('');
      b.innerHTML = '<div class="sh" style="margin-bottom:14px"><div class="chips">' + cf + '</div>' +
        '<button type="button" class="btn sm" id="newProdBtn">' + esc(t('newProd')) + '</button></div><div class="grid">' + cards + '</div>';
      $$('[data-pf]', b).forEach(function (btn) { btn.onclick = function () { st.pf = btn.dataset.pf; loadProducts(); }; });
      $('#newProdBtn').onclick = function () {
        if (!st.cats.length) { App.toast(t('noCat'), true); st.tab = 'cats'; drawShell(); return; }
        openProdModal(null);
      };
      $$('[data-ep]', b).forEach(function (btn) { btn.onclick = function () {
        var p = st.prods.filter(function (x) { return x.id === btn.dataset.ep; })[0]; if (p) openProdModal(p);
      }; });
      $$('[data-out]', b).forEach(function (btn) { btn.onclick = function () {
        var p = st.prods.filter(function (x) { return x.id === btn.dataset.out; })[0]; if (!p) return;
        var nextStock = p.stock === 0 ? -1 : 0;
        sb.from('products').update({ stock: nextStock }).eq('id', p.id).then(function (res) {
          if (res.error) return App.toast(App.err(res.error), true);
          App.toast(t('saved')); loadProducts();
        });
      }; });
      $$('[data-dp]', b).forEach(function (btn) { btn.onclick = function () {
        if (!confirm(t('delProdQ'))) return;
        sb.from('products').delete().eq('id', btn.dataset.dp).then(function (res) {
          if (res.error) return App.toast(App.err(res.error), true);
          loadProducts();
        });
      }; });
    });
  }

  function formatAccountEntry(login, pass, credType) {
    var l = String(login || '').trim(), pw = String(pass || '').trim();
    if (!l || !pw) return '';
    return (credType === 'user_pass' ? 'ชื่อ: ' : 'อีเมล: ') + l + ' | รหัส: ' + pw;
  }

  function normalizeBulkLine(line, credType) {
    var s = String(line || '').trim();
    if (!s) return '';
    if (/^(?:อีเมล|ชื่อ|Email|Username)/i.test(s) && s.indexOf('|') > -1) return s;
    var sep = s.indexOf(' | ') > -1 ? ' | ' : (s.indexOf('|') > -1 ? '|' : (s.indexOf(':') > -1 ? ':' : ''));
    if (sep) {
      var idx = s.indexOf(sep);
      var l = s.slice(0, idx).trim(), pw = s.slice(idx + sep.length).trim();
      if (l && pw) return formatAccountEntry(l, pw, credType);
    }
    return s;
  }

  function openProdModal(prod) {
    var p = prod ? JSON.parse(JSON.stringify(prod)) : {
      id: null, category_id: (st.pf !== 'all' && st.pf) || (st.cats[0] && st.cats[0].id),
      name_th: '', name_en: '', desc_th: '', desc_en: '', price: 0, images: [],
      delivery: 'code', credential_type: 'email_pass', stock: -1, input_label: '', featured: false, active: true, sort: 0
    };
    if (p.credential_type !== 'user_pass') p.credential_type = 'email_pass';
    var pendingCodes = [];

    $('#mpTitle').textContent = p.id ? nm(p) : t('newProd');
    var catOpts = st.cats.map(function (c) { return '<option value="' + c.id + '"' + (c.id === p.category_id ? ' selected' : '') + '>' + esc(nm(c)) + '</option>'; }).join('');
    $('#mpBody').innerHTML =
      '<div class="two" style="gap:10px 18px">' +
        '<div><label class="lab">' + esc(t('nameTh')) + ' *</label><input class="inp" id="pNth" value="' + esc(p.name_th) + '"></div>' +
        '<div><label class="lab">' + esc(t('nameEn')) + '</label><input class="inp" id="pNen" value="' + esc(p.name_en) + '"></div>' +
        '<div><label class="lab">' + esc(t('descTh')) + '</label><textarea class="inp" id="pDth">' + esc(p.desc_th) + '</textarea></div>' +
        '<div><label class="lab">' + esc(t('descEn')) + '</label><textarea class="inp" id="pDen">' + esc(p.desc_en) + '</textarea></div>' +
        '<div><label class="lab">' + esc(t('category')) + '</label><select class="inp" id="pCat">' + catOpts + '</select></div>' +
        '<div><label class="lab">' + esc(t('price')) + ' *</label><input class="inp" id="pPrice" type="number" min="0" step="0.01" value="' + p.price + '"></div>' +
        '<div><label class="lab">' + esc(t('delivery')) + '</label><select class="inp" id="pDel">' +
          '<option value="code"' + (p.delivery === 'code' ? ' selected' : '') + '>' + esc(t('delCode')) + '</option>' +
          '<option value="manual"' + (p.delivery === 'manual' ? ' selected' : '') + '>' + esc(t('delManual')) + '</option></select></div>' +
        '<div id="pCredWrap"><label class="lab">' + esc(t('credType')) + ' *</label><select class="inp" id="pCredType">' +
          '<option value="email_pass"' + (p.credential_type === 'email_pass' ? ' selected' : '') + '>' + esc(t('credEmailPass')) + '</option>' +
          '<option value="user_pass"' + (p.credential_type === 'user_pass' ? ' selected' : '') + '>' + esc(t('credUserPass')) + '</option></select></div>' +
        '<div id="pStockWrap"><label class="lab">' + esc(t('stock')) + '</label><input class="inp" id="pStock" type="number" min="-1" value="' + p.stock + '"></div>' +
        '<div><label class="lab">' + esc(t('inputLabel')) + '</label><input class="inp" id="pInpLab" value="' + esc(p.input_label) + '" placeholder="เช่น UID เกม (เว้นว่างถ้าไม่ต้องกรอก)"></div>' +
        '<div><label class="lab">' + esc(t('sortNo')) + '</label><input class="inp" id="pSort" type="number" value="' + p.sort + '"></div>' +
      '</div>' +
      '<div style="margin-top:6px">' +
        '<label class="chk"><input type="checkbox" id="pUseUid"' + (p.input_label ? ' checked' : '') + '> ' + esc(t('useUidGame')) + '</label><br>' +
        '<label class="chk"><input type="checkbox" id="pFeat"' + (p.featured ? ' checked' : '') + '> ' + esc(t('featured')) + '</label>' +
        '<label class="chk"><input type="checkbox" id="pAct"' + (p.active ? ' checked' : '') + '> ' + esc(t('active')) + '</label>' +
      '</div>' +
      /* รูปตัวอย่างสินค้า: กดเลือกไฟล์ได้เลยจากคอมและมือถือ ไม่ต้องใช้ลิงก์ */
      '<label class="lab" style="margin-top:18px">' + esc(t('images')) + '</label>' +
      '<div class="imglist" id="pImgs"></div>' +
      '<div class="upload-zone" id="pDropZone">' +
        '<input id="pImgFile" type="file" accept="image/*" multiple>' +
        '<b>' + esc(t('pickImgBtn')) + '</b>' +
        '<small>' + esc(t('pickImgHint')) + '</small>' +
      '</div>' +
      '<div class="msg" id="pMsg"></div>' +
      '<div class="cta" style="margin-top:14px"><button type="button" class="btn" id="pSave">' + esc(t('save')) + '</button>' +
      '<button type="button" class="btn ghost" data-close>' + esc(t('close')) + '</button></div>' +
      /* คลังบัญชีอัตโนมัติ (เลือก อีเมล+รหัส หรือ ชื่อ+รหัส) */
      '<div id="codeSec" style="margin-top:22px;padding-top:18px;border-top:1px solid var(--line)"></div>';

    $('#pUseUid').onchange = function () {
      if (this.checked && !$('#pInpLab').value.trim()) $('#pInpLab').value = 'UID เกม';
      if (!this.checked && $('#pInpLab').value.trim() === 'UID เกม') $('#pInpLab').value = '';
    };

    function renderImgs() {
      $('#pImgs').innerHTML = (p.images || []).map(function (u, i) {
        return '<div class="imgitem" title="แตะเพื่อตั้งเป็นรูปปก" data-cov="' + i + '"><img src="' + esc(u) + '" alt="">' +
          (i === 0 ? '<span class="cov">COVER</span>' : '') +
          '<button type="button" data-rmi="' + i + '">&times;</button></div>';
      }).join('');
      $$('[data-rmi]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); p.images.splice(Number(b.dataset.rmi), 1); renderImgs(); }; });
      $$('[data-cov]').forEach(function (el) { el.onclick = function () {
        var i = Number(el.dataset.cov); if (i > 0) { var u = p.images.splice(i, 1)[0]; p.images.unshift(u); renderImgs(); }
      }; });
    }

    function syncDelMode() {
      var isCode = $('#pDel').value === 'code';
      $('#pStockWrap').classList.toggle('hide', isCode);
      $('#pCredWrap').classList.toggle('hide', !isCode);
      renderCodesBox(isCode);
    }

    function pushCodesToStock(codesArr) {
      if (!codesArr.length) return;
      if (!p.id) {
        pendingCodes = pendingCodes.concat(codesArr);
        App.toast('เตรียมบัญชีไว้ ' + pendingCodes.length + ' รายการ (กดบันทึกสินค้าเพื่อนำเข้าสต็อก)');
        renderCodesBox(true);
        return;
      }
      var rows = codesArr.map(function (code) { return { product_id: p.id, code: code }; });
      sb.from('product_codes').insert(rows).then(function (res) {
        if (res.error) return App.toast(App.err(res.error), true);
        if (p.stock === 0) { p.stock = -1; $('#pStock').value = -1; sb.from('products').update({ stock: -1 }).eq('id', p.id); }
        App.toast(t('codesAdded') + ' (+' + rows.length + ')');
        renderCodesBox(true);
        loadProducts();
      });
    }

    function renderCodesBox(isCode) {
      var box = $('#codeSec');
      if (!isCode) { box.classList.add('hide'); return; }
      box.classList.remove('hide');
      var cType = $('#pCredType').value || 'email_pass';
      var isUserPass = cType === 'user_pass';
      var loginLabel = isUserPass ? '👤 ' + t('accUser') : '📧 ' + t('accEmail');
      var loginPh = isUserPass ? 'เช่น sharkplayer01' : 'เช่น example@gmail.com';
      var bulkLabel = isUserPass ? t('bulkUserPass') : t('bulkEmailPass');
      var bulkPh = isUserPass ? 'username01:pass1234\nusername02:pass5678' : 'user1@gmail.com:pass1234\nuser2@gmail.com:pass5678';

      function drawInner(freeList, usedCount) {
        var totalFree = freeList.length + pendingCodes.length;
        box.innerHTML =
          '<div class="sh" style="margin-bottom:10px">' +
            '<h4>' + esc(t('codes')) + ' &mdash; <span style="color:var(--ok)">' + totalFree + ' ' + esc(t('codesAvail')) + '</span> &middot; <span class="mute">' + usedCount + ' ' + esc(t('codesUsed')) + '</span></h4>' +
            '<div class="chips">' +
              '<button type="button" class="opt' + (!isUserPass ? ' on' : '') + '" data-ctype="email_pass">' + esc(t('credEmailPass')) + '</button>' +
              '<button type="button" class="opt' + (isUserPass ? ' on' : '') + '" data-ctype="user_pass">' + esc(t('credUserPass')) + '</button>' +
            '</div>' +
          '</div>' +
          /* เพิ่มทีละบัญชี แยกช่อง อีเมล/ชื่อ กับ รหัสผ่าน */
          '<div class="panel" style="padding:14px;background:rgba(10,7,40,.55);margin-bottom:12px">' +
            '<div class="two" style="gap:10px">' +
              '<div><label class="lab" style="margin-top:0">' + esc(loginLabel) + ' *</label><input class="inp" id="cAccLogin" placeholder="' + esc(loginPh) + '"></div>' +
              '<div><label class="lab" style="margin-top:0">🔑 ' + esc(t('accPass')) + ' *</label><input class="inp" id="cAccPass" placeholder="รหัสผ่านของบัญชีนี้"></div>' +
            '</div>' +
            '<button type="button" class="btn sm" id="cAddSingleBtn" style="margin-top:10px">' + esc(t('addSingleAcc')) + '</button>' +
          '</div>' +
          /* วางหลายบัญชีพร้อมกัน */
          '<label class="lab">' + esc(bulkLabel) + '</label>' +
          '<textarea class="inp" id="cBulk" style="margin-top:6px" placeholder="' + esc(bulkPh) + '"></textarea>' +
          '<button type="button" class="btn sm ghost" id="cAddBtn" style="margin-top:8px">' + esc(t('codesAddGo')) + '</button>' +
          (pendingCodes.length ? '<div style="margin-top:10px;color:var(--warn);font-size:.9rem">⏳ รอบันทึกเข้าสต็อกเมื่อกดบันทึกสินค้า: ' + pendingCodes.length + ' บัญชี</div>' : '') +
          (freeList.length ? '<div style="max-height:200px;overflow:auto;margin-top:12px;border:1px solid var(--line);border-radius:12px">' +
            freeList.map(function (c) {
              return '<div class="copyrow" style="margin:0;border:0;border-bottom:1px solid var(--line);border-radius:0"><code>' + esc(c.code) + '</code>' +
                '<button type="button" class="btn xs danger" data-delc="' + c.id + '">&times;</button></div>';
            }).join('') + '</div>' : '');

        $$('[data-ctype]', box).forEach(function (b) {
          b.onclick = function () {
            $('#pCredType').value = b.dataset.ctype;
            p.credential_type = b.dataset.ctype;
            renderCodesBox(true);
          };
        });
        $('#cAddSingleBtn').onclick = function () {
          var l = ($('#cAccLogin').value || '').trim(), pw = ($('#cAccPass').value || '').trim();
          if (!l || !pw) return App.toast(t('fill'), true);
          var entry = formatAccountEntry(l, pw, cType);
          $('#cAccLogin').value = ''; $('#cAccPass').value = '';
          pushCodesToStock([entry]);
        };
        $('#cAddBtn').onclick = function () {
          var lines = ($('#cBulk').value || '').split(/\r?\n/).map(function (s) { return normalizeBulkLine(s, cType); }).filter(Boolean);
          if (!lines.length) return;
          $('#cBulk').value = '';
          pushCodesToStock(lines);
        };
        $$('[data-delc]', box).forEach(function (b) {
          b.onclick = function () {
            sb.from('product_codes').delete().eq('id', Number(b.dataset.delc)).then(function () { renderCodesBox(true); loadProducts(); });
          };
        });
      }

      if (!p.id) {
        drawInner([], 0);
        return;
      }
      Promise.all([
        sb.from('product_codes').select('id, code, created_at').eq('product_id', p.id).is('order_id', null).order('id').limit(200),
        sb.from('product_codes').select('id', { count: 'exact', head: true }).eq('product_id', p.id).not('order_id', 'is', null)
      ]).then(function (r) {
        var free = (r[0] && r[0].data) || [], used = (r[1] && r[1].count) || 0;
        drawInner(free, used);
      });
    }

    renderImgs(); syncDelMode();
    $('#pDel').onchange = syncDelMode;
    $('#pCredType').onchange = function () {
      p.credential_type = this.value;
      renderCodesBox($('#pDel').value === 'code');
    };

    function uploadImgFiles(files) {
      if (!files || !files.length) return;
      $('#pMsg').className = 'msg ok'; $('#pMsg').textContent = t('uploading');
      Promise.all(files.map(function (f) {
        return App.resize(f, 1000, 0.85).then(function (blob) {
          var ext = blob.type === 'image/webp' ? 'webp' : 'jpg', path = 'p/' + App.rid() + '.' + ext;
          return sb.storage.from('products').upload(path, blob, { contentType: blob.type }).then(function (r) {
            if (r.error) return blobToDataUrl(blob);
            return sb.storage.from('products').getPublicUrl(path).data.publicUrl;
          }).catch(function () { return blobToDataUrl(blob); });
        });
      })).then(function (urls) {
        p.images = p.images.concat(urls); $('#pMsg').textContent = ''; renderImgs();
      }).catch(function (e) { $('#pMsg').className = 'msg'; $('#pMsg').textContent = App.err(e); });
    }
    $('#pImgFile').onchange = function () {
      uploadImgFiles(Array.prototype.slice.call(this.files || []));
      this.value = '';
    };
    var dz = $('#pDropZone');
    if (dz) {
      dz.ondragover = function (e) { e.preventDefault(); dz.classList.add('drag'); };
      dz.ondragleave = function () { dz.classList.remove('drag'); };
      dz.ondrop = function (e) {
        e.preventDefault(); dz.classList.remove('drag');
        var fl = e.dataTransfer && e.dataTransfer.files;
        if (fl && fl.length) uploadImgFiles(Array.prototype.slice.call(fl));
      };
    }
    $('#mpBody').onpaste = function (e) {
      var items = (e.clipboardData && e.clipboardData.items) || [], files = [];
      for (var i = 0; i < items.length; i++) if (items[i].type && items[i].type.indexOf('image/') === 0) files.push(items[i].getAsFile());
      if (files.length) { e.preventDefault(); uploadImgFiles(files); }
    };
    $('#pSave').onclick = function () {
      var nth = $('#pNth').value.trim(), nen = $('#pNen').value.trim(), pr = Number($('#pPrice').value);
      if ((!nth && !nen) || !(pr >= 0) || $('#pPrice').value === '') { $('#pMsg').className = 'msg'; $('#pMsg').textContent = t('fill'); return; }
      var row = {
        category_id: $('#pCat').value, name_th: nth || nen, name_en: nen || nth,
        desc_th: $('#pDth').value.trim(), desc_en: $('#pDen').value.trim(),
        price: pr, images: p.images, delivery: $('#pDel').value,
        credential_type: $('#pCredType').value || 'email_pass',
        stock: Number($('#pStock').value), input_label: $('#pInpLab').value.trim(),
        sort: Number($('#pSort').value) || 0, featured: $('#pFeat').checked, active: $('#pAct').checked
      };
      var q = p.id ? sb.from('products').update(row).eq('id', p.id).select().single() : sb.from('products').insert(row).select().single();
      q.then(function (res) {
        if (res.error) { $('#pMsg').className = 'msg'; $('#pMsg').textContent = App.err(res.error); return; }
        p = res.data; $('#mpTitle').textContent = nm(p);
        if (pendingCodes.length) {
          var toInsert = pendingCodes.slice();
          pendingCodes = [];
          pushCodesToStock(toInsert);
        } else {
          App.toast(t('saved')); syncDelMode(); loadProducts();
        }
      });
    };
    App.openM('mProd');
  }

  /* ------------------------------------------------------------------ 5) Categories (อัปโหลดรูปจากเครื่องโดยตรง ไม่ต้องใช้ลิงก์) */
  function loadCats() {
    sb.from('categories').select('*').order('sort').order('created_at').then(function (r) {
      st.cats = (r && r.data) || [];
      var b = $('#aBody'); if (!b) return;
      var cards = !st.cats.length ? '<div class="empty">' + esc(t('noCat')) + '</div>' : st.cats.map(function (c) {
        var n = nm(c);
        return '<article class="card"><div class="thumb">' + (!c.active ? '<span class="badge out">' + esc(t('inactive')) + '</span>' : '') +
          '<img alt="" src="' + esc(c.image_url || App.ph(n)) + '"></div>' +
          '<div class="cb"><h3>' + esc(n) + ' <small class="mute">(' + esc(c.slug) + ')</small></h3><p>' + esc(nm(c, 'desc')) + '</p>' +
          '<div class="rowtools"><button type="button" class="btn sm" style="flex:1" data-ec="' + c.id + '">' + esc(t('edit')) + '</button>' +
          '<a class="btn sm ghost" href="category.html?c=' + encodeURIComponent(c.slug) + '" target="_blank">' + esc(t('view')) + '</a>' +
          '<button type="button" class="btn sm danger" data-dc="' + c.id + '">&times;</button></div></div></article>';
      }).join('');
      b.innerHTML = '<div class="sh" style="margin-bottom:14px"><div></div><button type="button" class="btn sm" id="newCatBtn">' + esc(t('newCat')) + '</button></div><div class="grid">' + cards + '</div>';
      $('#newCatBtn').onclick = function () { openCatModal(null); };
      $$('[data-ec]', b).forEach(function (btn) { btn.onclick = function () {
        var c = st.cats.filter(function (x) { return x.id === btn.dataset.ec; })[0]; if (c) openCatModal(c);
      }; });
      $$('[data-dc]', b).forEach(function (btn) { btn.onclick = function () {
        if (!confirm(t('delCatQ'))) return;
        sb.from('categories').delete().eq('id', btn.dataset.dc).then(function (res) {
          if (res.error) return App.toast(App.err(res.error), true);
          loadCats();
        });
      }; });
    });
  }

  function openCatModal(cat) {
    var c = cat ? JSON.parse(JSON.stringify(cat)) : { id: null, slug: '', name_th: '', name_en: '', desc_th: '', desc_en: '', image_url: '', sort: 0, active: true };
    $('#mcTitle').textContent = c.id ? nm(c) : t('newCat');
    $('#mcBody').innerHTML =
      '<label class="lab">' + esc(t('slug')) + ' *</label><input class="inp" id="cSlug" placeholder="topup" value="' + esc(c.slug) + '">' +
      '<label class="lab">' + esc(t('nameTh')) + ' *</label><input class="inp" id="cNth" value="' + esc(c.name_th) + '">' +
      '<label class="lab">' + esc(t('nameEn')) + '</label><input class="inp" id="cNen" value="' + esc(c.name_en) + '">' +
      '<label class="lab">' + esc(t('descTh')) + '</label><input class="inp" id="cDth" value="' + esc(c.desc_th) + '">' +
      '<label class="lab">' + esc(t('descEn')) + '</label><input class="inp" id="cDen" value="' + esc(c.desc_en) + '">' +
      '<label class="lab">' + esc(t('catImg')) + '</label>' +
      '<div id="cImgPrevWrap" class="' + (c.image_url ? '' : 'hide') + '" style="margin-bottom:8px">' +
        '<img id="cImgPrev" src="' + esc(c.image_url) + '" alt="" class="preview" style="margin-top:0">' +
      '</div>' +
      '<div class="upload-zone">' +
        '<input id="cImgF" type="file" accept="image/*">' +
        '<b>' + esc(t('pickImgBtn')) + '</b>' +
        '<small>' + esc(t('pickImgHint')) + '</small>' +
      '</div>' +
      '<label class="lab">' + esc(t('sortNo')) + '</label><input class="inp" id="cSort" type="number" value="' + c.sort + '">' +
      '<label class="chk"><input type="checkbox" id="cAct"' + (c.active ? ' checked' : '') + '> ' + esc(t('active')) + '</label>' +
      '<div class="msg" id="cMsg"></div>' +
      '<div class="cta" style="margin-top:14px"><button type="button" class="btn" id="cSave">' + esc(t('save')) + '</button>' +
      '<button type="button" class="btn ghost" data-close>' + esc(t('close')) + '</button></div>';

    $('#cImgF').onchange = function () {
      var f = this.files && this.files[0]; if (!f) return;
      $('#cMsg').className = 'msg ok'; $('#cMsg').textContent = t('uploading');
      App.resize(f, 900, 0.85).then(function (blob) {
        var ext = blob.type === 'image/webp' ? 'webp' : 'jpg', path = 'c/' + App.rid() + '.' + ext;
        return sb.storage.from('products').upload(path, blob, { contentType: blob.type }).then(function (r) {
          if (r.error) return blobToDataUrl(blob);
          return sb.storage.from('products').getPublicUrl(path).data.publicUrl;
        }).catch(function () { return blobToDataUrl(blob); });
      }).then(function (url) {
        c.image_url = url;
        $('#cImgPrev').src = url;
        $('#cImgPrevWrap').classList.remove('hide');
        $('#cMsg').textContent = '';
      }).catch(function (e) { $('#cMsg').className = 'msg'; $('#cMsg').textContent = App.err(e); });
    };
    $('#cSave').onclick = function () {
      var slug = $('#cSlug').value.trim().toLowerCase(), nth = $('#cNth').value.trim(), nen = $('#cNen').value.trim();
      if (!/^[a-z0-9-]{1,40}$/.test(slug) || (!nth && !nen)) { $('#cMsg').className = 'msg'; $('#cMsg').textContent = t('fill'); return; }
      var row = { slug: slug, name_th: nth || nen, name_en: nen || nth, desc_th: $('#cDth').value.trim(), desc_en: $('#cDen').value.trim(),
        image_url: c.image_url || '', sort: Number($('#cSort').value) || 0, active: $('#cAct').checked };
      var q = c.id ? sb.from('categories').update(row).eq('id', c.id) : sb.from('categories').insert(row);
      q.then(function (res) {
        if (res.error) { $('#pMsg') && ($('#cMsg').className = 'msg'); $('#cMsg').textContent = App.err(res.error); return; }
        App.closeM(); App.toast(t('saved')); loadCats();
      });
    };
    App.openM('mCat');
  }

  /* ------------------------------------------------------------------ 6) Users, Discord Bot Admins & Account Suspension/Deletion Alerts */
  function loadUsers() {
    Promise.all([
      sb.rpc('admin_users', { p_q: st.uq, p_limit: 100 }),
      sb.from('bot_admins').select('*').order('created_at'),
      sb.from('account_alerts').select('*').order('id', { ascending: false }).limit(40),
      sb.from('app_settings').select('*').eq('key', 'discord_webhook_url').maybeSingle()
    ]).then(function (all) {
      var r = all[0] || {}, bRes = all[1] || {}, alRes = all[2] || {}, setRes = all[3] || {};
      var b = $('#aBody'); if (!b) return;
      var list = (r && r.data) || [];
      var botList = (bRes && bRes.data) || [];
      var alerts = (alRes && alRes.data) || [];
      var dbWh = (setRes && setRes.data && setRes.data.value) || '';
      if (dbWh && window.S) S.set('discord_webhook_url', dbWh);
      var webhookUrl = dbWh || getSavedWebhookUrl();

      var userMap = {};
      list.forEach(function (u) { userMap[u.id] = u; });

      var rows = !list.length ? '<div class="lock">-</div>' : list.map(function (u) {
        var banInfo = u.banned
          ? '<div style="margin-top:4px;color:var(--bad);font-size:.86rem">🚫 <b>' + esc(t('banned')) + '</b>' +
            (u.ban_reason ? ' &middot; ' + esc(t('banReason')) + ': <b>' + esc(u.ban_reason) + '</b>' : '') +
            (u.banned_at ? ' <small class="mute">(' + esc(App.fmtTime(u.banned_at)) + ')</small>' : '') + '</div>'
          : '';
        var discTag = (u.discord_username || u.discord_id)
          ? ' <span style="display:inline-flex;align-items:center;gap:4px;background:rgba(88,101,242,.18);color:#818cf8;padding:2px 7px;border-radius:6px;font-size:.78rem;font-weight:600">' +
              '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>' +
              '@' + esc(u.discord_username || u.discord_id) +
            '</span>'
          : '';
        return '<div class="arow"><div>' +
          '<div><b>' + esc(u.username) + '</b> <span class="mute">(' + esc(u.email || '-') + ')</span> ' +
          discTag + ' ' +
          (u.is_admin ? '<span class="st">ADMIN</span> ' : '') + (u.banned ? '<span class="st bad">BANNED</span>' : '') + '</div>' +
          '<div style="margin-top:4px"><span style="color:var(--cyan);font-weight:700">' + money(u.balance) + ' ฿</span>' +
          ' &middot; <small class="mute">ID: <code>' + esc(String(u.id).slice(0, 8)) + '...</code></small>' +
          ' <button type="button" class="btn xs ghost" data-cp="' + esc(u.id) + '" style="padding:2px 6px">' + esc(t('copy')) + ' ID</button>' +
          ' &middot; <small class="mute">' + esc(t('memberSince')) + ': ' + esc(App.fmtTime(u.created_at)) + '</small>' +
          (u.last_sign_in_at ? ' &middot; <small class="mute">Login: ' + esc(App.fmtTime(u.last_sign_in_at)) + '</small>' : '') +
          '</div>' + banInfo + '</div>' +
          '<div class="rowtools">' +
            '<button type="button" class="btn xs ghost" data-adj="' + u.id + '">' + esc(t('adjust')) + '</button>' +
            '<button type="button" class="btn xs ghost" data-adm="' + u.id + '" data-v="' + (!u.is_admin) + '">' + esc(t(u.is_admin ? 'rmAdmin' : 'mkAdmin')) + '</button>' +
            '<button type="button" class="btn xs ' + (u.banned ? 'ok' : 'ghost') + '" data-ban="' + u.id + '" data-v="' + (!u.banned) + '">' + esc(t(u.banned ? 'unban' : 'ban')) + '</button>' +
            '<button type="button" class="btn xs danger" data-delu="' + u.id + '" data-uname="' + esc(u.username) + '">' + esc(t('delUser')) + '</button>' +
          '</div></div>';
      }).join('');

      var botRows = !botList.length ? '<div class="lock" style="padding:18px">-</div>' : botList.map(function (ba) {
        return '<div class="arow"><div><b>Discord ID: <code>' + esc(ba.discord_id) + '</code></b>' +
          (ba.label ? ' &middot; <span>' + esc(ba.label) + '</span>' : '') +
          ' &middot; <small class="mute">' + esc(App.fmtTime(ba.created_at)) + '</small></div>' +
          '<div class="rowtools"><button type="button" class="btn xs danger" data-rmbot="' + esc(ba.discord_id) + '">&times; ' + esc(t('rmAdmin')) + '</button></div></div>';
      }).join('');

      var alertRows = !alerts.length ? '<div class="lock" style="padding:18px">' + esc(t('noAlerts')) + '</div>' : alerts.map(function (a) {
        var s = a.snapshot || {};
        var isBad = a.event !== 'unban';
        var evCls = isBad ? 'st bad' : 'st ok';
        var sentBadge = (a.notified || a.webhook_sent)
          ? '<span class="st ok">✅ แจ้ง Discord แล้ว</span>'
          : '<span class="st warn">⏳ รอบอท/Webhook ส่ง</span>';
        var discAlert = (s.discord_username || s.discord_id)
          ? ' &middot; <span style="color:#818cf8;font-weight:600">🎮 Discord: @' + esc(s.discord_username || s.discord_id) + '</span>'
          : '';
        return '<div class="arow"><div>' +
          '<div><span class="' + evCls + '">' + esc(t('ev_' + a.event)) + '</span> ' +
          '<b>' + esc(a.username || '-') + '</b> <span class="mute">(' + esc(a.email || s.email || '-') + ')</span>' +
          discAlert + ' &middot; ' + sentBadge + '</div>' +
          '<div style="margin-top:6px">' +
            '💰 ยอดเงินในบัญชีขณะนั้น: <b style="color:var(--cyan);font-size:1.05rem">' + money(a.balance) + ' ฿</b>' +
            ' &middot; 💳 เติมสะสม: <b>' + money(s.topup_total || 0) + ' ฿</b> (' + (s.topup_count || 0) + ')' +
            ' &middot; 🛒 ซื้อสะสม: <b>' + money(s.spent_total || 0) + ' ฿</b> (' + (s.order_count || 0) + ')' +
            ((s.pending_topup_count || s.pending_order_count) ? ' &middot; ⏳ ค้างตรวจ/ส่ง: <b>' + (s.pending_topup_count || 0) + ' เติม / ' + (s.pending_order_count || 0) + ' ออเดอร์</b>' : '') +
          '</div>' +
          (a.reason ? '<div style="margin-top:4px;font-size:.9rem">📌 <b>' + esc(t('banReason')) + ':</b> ' + esc(a.reason) + '</div>' : '') +
          '<div class="mute" style="font-size:.84rem;margin-top:4px">ID: <code>' + esc(a.user_id || s.user_id || '-') + '</code> &middot; โดย ' + esc(a.actor || 'Admin') + ' &middot; ' + esc(App.fmtTime(a.created_at)) + '</div>' +
          '</div><div class="rowtools">' +
            '<button type="button" class="btn xs ghost" data-cpsnap="' + a.id + '">' + esc(t('copySnap')) + '</button>' +
            '<button type="button" class="btn xs" data-resendal="' + a.id + '">' + esc(t('resendAlert')) + '</button>' +
          '</div></div>';
      }).join('');

      b.innerHTML =
        '<div class="sh" style="margin-bottom:14px;gap:10px;flex-wrap:wrap">' +
          '<input class="search" id="uSearch" placeholder="' + esc(t('searchUser')) + '" value="' + esc(st.uq) + '">' +
          '<div class="rowtools">' +
            '<input class="inp" id="qDelInp" placeholder="' + esc(t('quickDelUser')) + '" style="width:230px;padding:7px 12px">' +
            '<input class="inp" id="qDelReason" placeholder="' + esc(t('reason')) + '" style="width:180px;padding:7px 12px">' +
            '<button type="button" class="btn xs danger" id="qDelBtn">' + esc(t('quickDelBtn')) + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="panel" style="padding:0;overflow:hidden">' + rows + '</div>' +

        /* ส่วนตั้งค่า Discord Webhook + ประวัติแจ้งเตือนบัญชีที่ถูกระงับ/ลบบัญชี พร้อมยอดเงินและข้อมูลทุกอย่าง */
        '<div class="panel" style="margin-top:20px;padding:0;overflow:hidden;border-color:rgba(56,232,255,.35)">' +
          '<div style="padding:16px 18px;border-bottom:1px solid var(--line)">' +
            '<h3 style="margin:0 0 6px">' + esc(t('discordAlertSec')) + '</h3>' +
            '<p class="mute" style="margin:0 0 12px;font-size:.9rem;line-height:1.55">เมื่อมีบัญชีถูก<b>ระงับ (Ban)</b>, <b>ปลดระงับ</b> หรือ<b>ถูกลบบัญชี</b> (ทั้งแอดมินลบและลูกค้าลบเอง) ระบบจะบันทึก<b>ยอดเงินปัจจุบันในบัญชีนั้น + ประวัติเติมเงิน/สั่งซื้อ/อีเมล/รหัสบัญชี</b> และส่งแจ้งเตือนเข้าห้อง <code>#setup</code> และ <code>#log</code> ของบอท Discord ทันที รวมถึงยิงเข้า Discord Webhook ด้านล่างนี้โดยอัตโนมัติ</p>' +
            '<div class="rowtools" style="flex-wrap:wrap">' +
              '<input class="inp" id="whUrlInp" value="' + esc(webhookUrl) + '" placeholder="' + esc(t('discordWebhookPh')) + '" style="flex:1;min-width:260px;padding:8px 12px">' +
              '<button type="button" class="btn xs" id="whSaveBtn">' + esc(t('saveWebhook')) + '</button>' +
              '<button type="button" class="btn xs ghost" id="whTestBtn">' + esc(t('testWebhook')) + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="sh" style="padding:12px 18px;margin:0;border-bottom:1px solid var(--line)"><h4 style="margin:0">' + esc(t('alertHistory')) + '</h4></div>' +
          alertRows +
        '</div>' +

        '<div class="panel" style="margin-top:20px;padding:0;overflow:hidden">' +
          '<div class="sh" style="padding:16px 18px;margin:0;border-bottom:1px solid var(--line)"><h3>' + esc(t('botAdmins')) + '</h3>' +
            '<div class="rowtools">' +
              '<input class="inp" id="baId" placeholder="' + esc(t('discordId')) + '" style="width:220px;padding:7px 12px">' +
              '<input class="inp" id="baLbl" placeholder="' + esc(t('botLabel')) + '" style="width:160px;padding:7px 12px">' +
              '<button type="button" class="btn xs" id="baAdd">' + esc(t('addBotAdmin')) + '</button>' +
            '</div>' +
          '</div>' + botRows +
        '</div>';

      $$('[data-cp]', b).forEach(function (btn) { btn.onclick = function () { App.copy(btn.dataset.cp); }; });
      $('#uSearch').onchange = function () { st.uq = this.value.trim(); loadUsers(); };

      /* บันทึกและทดสอบ Discord Webhook */
      $('#whSaveBtn').onclick = function () {
        var v = ($('#whUrlInp').value || '').trim();
        if (v && !/^https:\/\/(canary\.|ptb\.)?(discord\.com|discordapp\.com)\/api\/webhooks\//i.test(v)) {
          return App.toast(t('E_BAD_WEBHOOK'), true);
        }
        if (window.S) S.set('discord_webhook_url', v);
        sb.from('app_settings').upsert({ key: 'discord_webhook_url', value: v, updated_at: new Date().toISOString() }).then(function (res) {
          if (res.error) { App.toast(t('saved')); return; }
          App.toast(t('saved'));
        });
      };

      $('#whTestBtn').onclick = function () {
        var v = ($('#whUrlInp').value || '').trim();
        if (!/^https:\/\/(canary\.|ptb\.)?(discord\.com|discordapp\.com)\/api\/webhooks\//i.test(v)) {
          return App.toast(t('E_BAD_WEBHOOK'), true);
        }
        if (window.S) S.set('discord_webhook_url', v);
        var btn = this; btn.disabled = true;
        sb.from('app_settings').upsert({ key: 'discord_webhook_url', value: v, updated_at: new Date().toISOString() }).then(function () {
          return fetch(v, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: 'SHARK Shop Security & Balance Alert',
              content: '✅ **เชื่อมต่อระบบแจ้งเตือน Discord สำเร็จ!** หากมีบัญชีถูกระงับหรือถูกลบ ระบบจะส่งยอดเงินคงเหลือและข้อมูลบัญชีทั้งหมดเข้าห้องนี้ทันที',
              embeds: [{
                title: '🔔 ทดสอบแจ้งเตือนบัญชีถูกระงับ / ถูกลบ (SHARK Shop)',
                description: 'ระบบพร้อมแจ้งเตือนทันทีเมื่อบัญชีโดนระงับหรือถูกลบ พร้อมแสดงยอดเงินคงเหลือ อีเมล ยอดเติมสะสม ยอดซื้อสะสม และสาเหตุครบถ้วน',
                color: 0x38E8FF,
                fields: [
                  { name: '👤 ผู้ทดสอบ', value: (App.profile && App.profile.username) || 'Web Admin', inline: true },
                  { name: '💰 ตัวอย่างยอดเงิน', value: '**' + money((App.profile && App.profile.balance) || 0) + ' ฿**', inline: true }
                ]
              }]
            })
          });
        }).then(function (res) {
          btn.disabled = false;
          if (res && res.ok) App.toast(t('webhookTested'));
          else App.toast(t('E_BAD_WEBHOOK'), true);
        }).catch(function () {
          btn.disabled = false;
          sb.rpc('admin_test_discord_webhook').then(function (r2) {
            if (r2.error) return App.toast(App.err(r2.error), true);
            App.toast(t('webhookTested'));
          });
        });
      };

      /* คัดลอกข้อมูล Snapshot บัญชี และส่งแจ้งเตือนเข้า Discord ซ้ำ */
      $$('[data-cpsnap]', b).forEach(function (btn) {
        btn.onclick = function () {
          var a = alerts.filter(function (x) { return String(x.id) === String(btn.dataset.cpsnap); })[0];
          if (!a) return;
          var s = a.snapshot || {};
          var txt = [
            '=== ข้อมูลบัญชี SHARK Shop (' + t('ev_' + a.event) + ') ===',
            'ชื่อผู้ใช้: ' + (a.username || s.username || '-'),
            'อีเมล: ' + (a.email || s.email || '-'),
            'User ID: ' + (a.user_id || s.user_id || '-'),
            'ยอดเงินคงเหลือในบัญชี: ' + money(a.balance) + ' บาท',
            'ยอดเติมเงินสะสม: ' + money(s.topup_total || 0) + ' บาท (' + (s.topup_count || 0) + ' ครั้ง)',
            'ยอดซื้อสะสม: ' + money(s.spent_total || 0) + ' บาท (' + (s.order_count || 0) + ' ออเดอร์)',
            'รายการค้าง: เติมเงิน ' + (s.pending_topup_count || 0) + ' รายการ / ออเดอร์ ' + (s.pending_order_count || 0) + ' รายการ',
            'สาเหตุ: ' + (a.reason || '-'),
            'ดำเนินการโดย: ' + (a.actor || '-'),
            'เวลา: ' + App.fmtTime(a.created_at)
          ].join('\n');
          App.copy(txt);
        };
      });

      $$('[data-resendal]', b).forEach(function (btn) {
        btn.onclick = function () {
          var id = Number(btn.dataset.resendal);
          var a = alerts.filter(function (x) { return Number(x.id) === id; })[0];
          btn.disabled = true;
          Promise.all([
            sb.rpc('admin_resend_alert', { p_id: id }),
            a ? pushAlertToWebhookClient(a, true) : Promise.resolve(false)
          ]).then(function () {
            btn.disabled = false;
            App.toast(t('alertResent'));
            loadUsers();
          });
        };
      });

      $('#baAdd').onclick = function () {
        var did = ($('#baId').value || '').replace(/\D/g, ''), lbl = ($('#baLbl').value || '').trim();
        if (did.length < 15) return App.toast(t('discordId'), true);
        sb.from('bot_admins').upsert({ discord_id: did, label: lbl, added_by: (App.profile && App.profile.username) || 'Web Admin' }).then(function (res) {
          if (res.error) return App.toast(App.err(res.error), true);
          App.toast(t('saved')); loadUsers();
        });
      };
      $$('[data-rmbot]', b).forEach(function (btn) { btn.onclick = function () {
        sb.from('bot_admins').delete().eq('discord_id', btn.dataset.rmbot).then(function (res) {
          if (res.error) return App.toast(App.err(res.error), true);
          loadUsers();
        });
      }; });
      $$('[data-adj]', b).forEach(function (btn) { btn.onclick = function () {
        var v = prompt(t('adjustQ'), '100'); if (v === null) return;
        var n = Number(v); if (!n) return;
        var note = prompt(t('reason'), '') || '';
        sb.rpc('admin_adjust_balance', { p_user: btn.dataset.adj, p_delta: n, p_note: note }).then(function (res) {
          if (res.error) return App.toast(App.err(res.error), true);
          App.toast(t('saved')); loadUsers(); App.refreshProfile();
        });
      }; });
      $$('[data-adm]', b).forEach(function (btn) { btn.onclick = function () {
        sb.rpc('admin_set_user', { p_user: btn.dataset.adm, p_is_admin: btn.dataset.v === 'true' }).then(function (res) {
          if (res.error) return App.toast(App.err(res.error), true);
          loadUsers();
        });
      }; });

      /* ระงับ / ปลดระงับบัญชี พร้อมถามสาเหตุและแจ้งเข้า Discord ทันที */
      $$('[data-ban]', b).forEach(function (btn) { btn.onclick = function () {
        var uid = btn.dataset.ban, isBan = btn.dataset.v === 'true', u = userMap[uid] || {};
        var reason = '';
        if (isBan) {
          var rInp = prompt(t('banReasonQ'), '');
          if (rInp === null) return;
          reason = rInp.trim();
        }
        btn.disabled = true;
        sb.rpc('admin_set_user', { p_user: uid, p_banned: isBan, p_reason: reason }).then(function (res) {
          if (res.error) return sb.rpc('admin_set_user', { p_user: uid, p_banned: isBan });
          return res;
        }).then(function (res) {
          btn.disabled = false;
          if (res && res.error) return App.toast(App.err(res.error), true);
          pushAlertToWebhookClient({
            event: isBan ? 'ban' : 'unban',
            user_id: uid,
            username: u.username || '',
            email: u.email || '',
            balance: u.balance || 0,
            reason: reason,
            actor: 'เว็บ (' + ((App.profile && App.profile.username) || 'Admin') + ')',
            snapshot: u
          }, true);
          App.toast(t('saved'));
          loadUsers();
        });
      }; });

      /* ฟังก์ชันกลางสำหรับลบบัญชีผู้ใช้ในหลังบ้าน (รองรับทั้ง RPC ใหม่, RPC เดิม และลบตรง + แจ้ง Discord ทันที) */
      function executeAdminDeleteUser(uid, uname, reason, btnEl) {
        var u = (uid && userMap[uid]) || {};
        var snapAlert = {
          event: 'delete',
          user_id: uid || u.id || '',
          username: uname || u.username || '',
          email: u.email || '',
          balance: u.balance || 0,
          reason: reason || '',
          actor: 'เว็บ (' + ((App.profile && App.profile.username) || 'Admin') + ')',
          snapshot: u
        };
        if (btnEl) btnEl.disabled = true;
        var p;
        if (uid) {
          p = sb.rpc('admin_delete_user', { p_user: uid, p_reason: reason || '' }).then(function (res) {
            if (res.error) return sb.rpc('admin_delete_user', { p_user: uid });
            return res;
          }).then(function (res) {
            if (res && res.error) return sb.from('profiles').delete().eq('id', uid);
            return res;
          });
        } else {
          p = sb.rpc('admin_delete_by_username', { p_username: uname, p_reason: reason || '' }).then(function (res) {
            if (res.error) return sb.rpc('admin_delete_by_username', { p_username: uname });
            return res;
          });
        }
        p.then(function (res) {
          if (btnEl) btnEl.disabled = false;
          if (res && res.error) return App.toast(App.err(res.error), true);
          pushAlertToWebhookClient(snapAlert, true);
          App.toast(t('accDeleted'));
          if (App.user && uid && uid === App.user.id) {
            sb.auth.signOut().then(function () { location.href = 'index.html'; });
          } else {
            loadUsers();
          }
        });
      }

      $$('[data-delu]', b).forEach(function (btn) { btn.onclick = function () {
        var uid = btn.dataset.delu, uname = btn.dataset.uname || '', u = userMap[uid] || {};
        var balTxt = u.balance !== undefined ? ' · ยอดเงินปัจจุบัน: ' + money(u.balance) + ' ฿' : '';
        if (!confirm(t('delUserQ') + (uname ? '\n\n👤 ' + uname + balTxt : ''))) return;
        var reason = prompt(t('delReasonQ'), '');
        if (reason === null) return;
        executeAdminDeleteUser(uid, uname, reason.trim(), btn);
      }; });

      if ($('#qDelBtn')) $('#qDelBtn').onclick = function () {
        var target = ($('#qDelInp').value || '').trim();
        var reason = ($('#qDelReason').value || '').trim();
        if (!target) return App.toast(t('fill'), true);
        var isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target);
        var matched = list.filter(function (x) {
          return (isUuid && x.id.toLowerCase() === target.toLowerCase()) || (!isUuid && String(x.username || '').toLowerCase() === target.toLowerCase());
        })[0];
        var balTxt = matched ? ' (ยอดเงินปัจจุบัน: ' + money(matched.balance) + ' ฿)' : '';
        if (!confirm(t('delUserQ') + '\n\n👤 ' + target + balTxt)) return;
        executeAdminDeleteUser(isUuid ? target : (matched && matched.id) || null, matched ? matched.username : target, reason, this);
      };
    });
  }

  /* ------------------------------------------------------------------ 7) Customer Live Chats (พร้อมดูแชทเต็มๆ & ลบข้อความ) */
  function deleteChatMessage(msgId, onDeleted) {
    if (!confirm(t('delMsgQ') || 'ยืนยันการลบข้อความนี้?')) return;
    sb.from('support_chats').delete().eq('id', msgId).then(function (res) {
      if (res.error) {
        return sb.rpc('admin_delete_chat', { p_msg_id: msgId, p_user: null, p_clear_all: false });
      }
      return res;
    }).then(function () {
      App.toast(t('msgDeleted') || 'ลบข้อความเรียบร้อยแล้ว');
      if (onDeleted) onDeleted();
    }).catch(function (e) {
      App.toast(App.err(e), true);
    });
  }

  function appendLiveChatMessage(m) {
    var fcMsgs = $('#fcMessages');
    if (!fcMsgs) return;
    var isMe = m.sender === 'admin';
    var senderName = isMe ? '👨‍💻 แอดมิน' : '👤 ' + esc(m.username || 'ลูกค้า');
    var timeStr = esc(App.fmtTime(m.created_at || new Date().toISOString()));
    var rowDiv = document.createElement('div');
    rowDiv.id = 'fc-msg-' + (m.id || Date.now());
    if (isMe) {
      rowDiv.className = 'cmsg-row me';
      rowDiv.innerHTML = '<button type="button" class="msg-del-btn" title="' + esc(t('delMsg')) + '" data-del-single="' + (m.id || '') + '">🗑️</button>' +
        '<div class="cmsg me" style="position:relative;max-width:82%">' +
          '<small style="display:flex;justify-content:space-between;gap:12px;opacity:.85;margin-bottom:4px">' +
            '<span>' + senderName + '</span><span>' + timeStr + '</span>' +
          '</small>' +
          '<div style="font-size:.95rem;word-break:break-word">' + esc(m.message) + '</div>' +
        '</div>';
    } else {
      rowDiv.className = 'cmsg-row bot';
      rowDiv.innerHTML = '<div class="cmsg bot" style="position:relative;max-width:82%">' +
        '<small style="display:flex;justify-content:space-between;gap:12px;opacity:.85;margin-bottom:4px">' +
          '<span>' + senderName + '</span><span>' + timeStr + '</span>' +
        '</small>' +
        '<div style="font-size:.95rem;word-break:break-word">' + esc(m.message) + '</div>' +
      '</div>' +
      '<button type="button" class="msg-del-btn" title="' + esc(t('delMsg')) + '" data-del-single="' + (m.id || '') + '">🗑️</button>';
    }
    fcMsgs.appendChild(rowDiv);
    var btn = $('[data-del-single]', rowDiv);
    if (btn && m.id) {
      btn.onclick = function () {
        deleteChatMessage(m.id, function () { rowDiv.remove(); if (st.tab === 'chats') loadChats(); });
      };
    }
    fcMsgs.scrollTop = fcMsgs.scrollHeight;
  }

  function openFullChat(userKey, username, userId) {
    activeChatUser = userKey;
    activeChatName = username || 'ลูกค้า';
    activeChatUid = userId || userKey;
    var m = $('#mFullChat');
    if (!m) return;
    App.openM('mFullChat');
    $('#fcTitle').textContent = activeChatName;
    $('#fcSub').textContent = 'User ID: ' + (userId || userKey);
    var fcMsgs = $('#fcMessages');
    fcMsgs.innerHTML = '<div style="text-align:center;padding:24px;color:var(--mute)">กำลังโหลดประวัติแชท...</div>';

    function renderList(list) {
      if (!list || !list.length) {
        fcMsgs.innerHTML = '<div style="text-align:center;padding:30px;color:var(--mute)">ยังไม่มีข้อความในห้องนี้</div>';
        return;
      }
      fcMsgs.innerHTML = list.map(function (msg) {
        var isMe = msg.sender === 'admin';
        var senderName = isMe ? '👨‍💻 แอดมิน' : '👤 ' + esc(username || 'ลูกค้า');
        var timeStr = esc(App.fmtTime(msg.created_at));
        if (isMe) {
          return '<div class="cmsg-row me" id="fc-msg-' + msg.id + '">' +
            '<button type="button" class="msg-del-btn" title="' + esc(t('delMsg')) + '" data-del-single="' + msg.id + '">🗑️</button>' +
            '<div class="cmsg me" style="position:relative;max-width:82%">' +
              '<small style="display:flex;justify-content:space-between;gap:12px;opacity:.85;margin-bottom:4px">' +
                '<span>' + senderName + '</span><span>' + timeStr + '</span>' +
              '</small>' +
              '<div style="font-size:.95rem;word-break:break-word">' + esc(msg.message) + '</div>' +
            '</div>' +
          '</div>';
        } else {
          return '<div class="cmsg-row bot" id="fc-msg-' + msg.id + '">' +
            '<div class="cmsg bot" style="position:relative;max-width:82%">' +
              '<small style="display:flex;justify-content:space-between;gap:12px;opacity:.85;margin-bottom:4px">' +
                '<span>' + senderName + '</span><span>' + timeStr + '</span>' +
              '</small>' +
              '<div style="font-size:.95rem;word-break:break-word">' + esc(msg.message) + '</div>' +
            '</div>' +
            '<button type="button" class="msg-del-btn" title="' + esc(t('delMsg')) + '" data-del-single="' + msg.id + '">🗑️</button>' +
          '</div>';
        }
      }).join('');

      $$('[data-del-single]', fcMsgs).forEach(function (btn) {
        btn.onclick = function () {
          var mid = Number(btn.dataset.delSingle);
          deleteChatMessage(mid, function () {
            var rowEl = $('#fc-msg-' + mid);
            if (rowEl) rowEl.remove();
            if (st.tab === 'chats') loadChats();
          });
        };
      });

      fcMsgs.scrollTop = fcMsgs.scrollHeight;
    }

    var q = sb.from('support_chats').select('*').eq('channel', 'admin').order('id', { ascending: true });
    if (userId && userId.length === 36) {
      q = q.eq('user_id', userId);
    } else {
      q = q.or('user_id.eq.' + userKey + ',session_id.eq.' + userKey);
    }

    q.then(function (r) {
      if (activeChatUser !== userKey) return;
      var msgs = (r && r.data) || [];
      renderList(msgs);
    });

    $('#fcForm').onsubmit = function (e) {
      e.preventDefault();
      var inp = $('#fcInp'), txt = inp && inp.value.trim();
      if (!txt) return;
      var btn = $('#fcSendBtn');
      btn.disabled = true;
      var insertObj = {
        username: username || 'User',
        sender: 'admin',
        channel: 'admin',
        message: txt,
        replied: true
      };
      if (userId && userId.length === 36) insertObj.user_id = userId;
      else insertObj.session_id = String(userKey);

      var p1 = sb.from('support_chats').insert(insertObj);
      var p2 = (userId && userId.length === 36)
        ? sb.from('support_chats').update({ replied: true }).eq('user_id', userId).eq('sender', 'user').eq('replied', false)
        : sb.from('support_chats').update({ replied: true }).eq('session_id', String(userKey)).eq('sender', 'user').eq('replied', false);

      Promise.all([p1, p2]).then(function () {
        btn.disabled = false;
        inp.value = '';
        App.toast(t('saved'));
        q.then(function (r2) {
          if (activeChatUser === userKey) renderList((r2 && r2.data) || []);
        });
        if (st.tab === 'chats') loadChats();
      }).catch(function (err) {
        btn.disabled = false;
        App.toast(App.err(err), true);
      });
    };

    $('#fcDelAllBtn').onclick = function () {
      if (!confirm(t('delUserChatQ'))) return;
      var uid = (userId && userId.length === 36) ? userId : null;
      var p = (uid && uid.length === 36)
        ? sb.rpc('admin_delete_chat', { p_user: uid, p_clear_all: false }).then(function (res) {
            if (res.error) return sb.from('support_chats').delete().eq('user_id', uid);
            return res;
          })
        : sb.from('support_chats').delete().eq('session_id', String(userKey));

      p.then(function () {
        App.toast(t('chatCleared'));
        App.closeM('mFullChat');
        activeChatUser = null;
        if (st.tab === 'chats') loadChats();
      });
    };
  }

  function loadChats() {
    sb.from('support_chats').select('*').eq('channel', 'admin').order('id', { ascending: false }).limit(200).then(function (r) {
      var b = $('#aBody'); if (!b) return;
      var all = (r && r.data) || [];
      if (!all.length) { b.innerHTML = '<div class="panel lock">' + esc(t('noChats')) + '</div>'; return; }
      var byUser = {}, order = [];
      all.forEach(function (m) {
        var key = m.user_id || m.session_id || 'guest';
        if (!byUser[key]) {
          byUser[key] = { user_id: m.user_id, session_id: m.session_id, username: m.username || String(key).slice(0, 8), msgs: [] };
          order.push(key);
        }
        byUser[key].msgs.unshift(m);
      });
      var rows = order.map(function (uid) {
        var g = byUser[uid], last = g.msgs[g.msgs.length - 1];
        var needReply = last && last.sender === 'user' && !last.replied;
        var hist = g.msgs.slice(-8).map(function (m) {
          var who = m.sender === 'user' ? '👤 ' + esc(g.username) : '👨‍💻 แอดมิน';
          return '<div class="cmsg-item" id="chat-item-' + m.id + '">' +
            '<div style="font-size:.9rem;line-height:1.4"><b>' + who + ':</b> ' + esc(m.message) + ' <small class="mute">(' + esc(App.fmtTime(m.created_at)) + ')</small></div>' +
            '<button type="button" class="msg-del-btn" title="' + esc(t('delMsg')) + '" data-del-msg="' + m.id + '">🗑️</button>' +
          '</div>';
        }).join('');
        return '<div class="arow"><div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">' +
            '<div style="display:flex;align-items:center;gap:8px">' +
              '<b>' + esc(g.username) + '</b> ' +
              (needReply ? '<span class="st pending">รอตอบ</span>' : '<span class="st">ตอบแล้ว</span>') +
              '<span class="mute" style="font-size:.8rem">(' + g.msgs.length + ' ข้อความ)</span>' +
            '</div>' +
            '<div style="display:flex;gap:8px;align-items:center">' +
              '<button type="button" class="btn xs" data-open-fc="' + esc(uid) + '" data-fc-name="' + esc(g.username) + '" data-fc-uid="' + esc(g.user_id || '') + '">' + esc(t('viewFullChat')) + '</button>' +
              '<button type="button" class="btn xs danger" data-cdel="' + esc(g.user_id || '') + '" data-csess="' + esc(g.session_id || uid) + '">' + esc(t('delChatRoom')) + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="chat-thread-box" data-open-fc="' + esc(uid) + '" data-fc-name="' + esc(g.username) + '" data-fc-uid="' + esc(g.user_id || '') + '" title="กดเพื่อเปิดดูแชทเต็มๆ" style="margin-top:8px;padding:10px 12px;background:rgba(255,255,255,.04);border-radius:12px;border:1px solid var(--line);cursor:pointer">' + hist + '</div>' +
          '<div class="rowtools" style="margin-top:10px">' +
            '<input class="inp" style="flex:1;padding:8px 12px" placeholder="' + esc(t('replyPh')) + '" data-cinp="' + esc(uid) + '" data-cname="' + esc(g.username) + '" data-cuid="' + esc(g.user_id || '') + '">' +
            '<button type="button" class="btn xs ok" data-csend="' + esc(uid) + '">' + esc(t('send')) + '</button>' +
          '</div></div></div>';
      }).join('');
      b.innerHTML = '<div class="sh" style="margin-bottom:14px"><div></div>' +
        '<button type="button" class="btn xs danger" id="clearAllChatsBtn">' + esc(t('clearAllChats')) + '</button></div>' +
        '<div class="panel" style="padding:0;overflow:hidden">' + rows + '</div>';

      $$('[data-open-fc]', b).forEach(function (btn) {
        btn.onclick = function (e) {
          e.preventDefault();
          openFullChat(btn.dataset.openFc, btn.dataset.fcName, btn.dataset.fcUid);
        };
      });

      $$('[data-del-msg]', b).forEach(function (btn) {
        btn.onclick = function (e) {
          e.stopPropagation();
          var mid = Number(btn.dataset.delMsg);
          deleteChatMessage(mid, function () { loadChats(); });
        };
      });

      $$('[data-csend]', b).forEach(function (btn) {
        btn.onclick = function () {
          var key = btn.dataset.csend, inp = $('[data-cinp="' + key + '"]'), txt = inp && inp.value.trim();
          if (!txt || !key) return;
          var uid = inp.dataset.cuid, cname = inp.dataset.cname || 'User';
          btn.disabled = true;
          var insertObj = { username: cname, sender: 'admin', channel: 'admin', message: txt, replied: true };
          if (uid && uid.length === 36) insertObj.user_id = uid;
          else insertObj.session_id = String(key);

          var p1 = sb.from('support_chats').insert(insertObj);
          var p2 = (uid && uid.length === 36)
            ? sb.from('support_chats').update({ replied: true }).eq('user_id', uid).eq('sender', 'user').eq('replied', false)
            : sb.from('support_chats').update({ replied: true }).eq('session_id', String(key)).eq('sender', 'user').eq('replied', false);

          Promise.all([p1, p2]).then(function () {
            btn.disabled = false; App.toast(t('saved')); loadChats();
          });
        };
      });

      $$('[data-cdel]', b).forEach(function (btn) {
        btn.onclick = function () {
          if (!confirm(t('delUserChatQ'))) return;
          var uid = btn.dataset.cdel, sess = btn.dataset.csess;
          btn.disabled = true;
          var p = (uid && uid.length === 36)
            ? sb.rpc('admin_delete_chat', { p_user: uid, p_clear_all: false }).then(function (res) {
                if (res.error) return sb.from('support_chats').delete().eq('user_id', uid);
                return res;
              })
            : sb.from('support_chats').delete().eq('session_id', sess);

          p.then(function () {
            btn.disabled = false; App.toast(t('chatCleared')); loadChats();
          });
        };
      });

      if ($('#clearAllChatsBtn')) $('#clearAllChatsBtn').onclick = function () {
        if (!confirm(t('clearChatQ'))) return;
        sb.rpc('admin_delete_chat', { p_user: null, p_clear_all: true }).then(function () {
          App.toast(t('chatCleared')); loadChats();
        });
      };
    });
  }

  /* ------------------------------------------------------------------ 8) Admin Notifications & Activity Logs */
  function loadLogs() {
    sb.from('admin_logs').select('*').order('id', { ascending: false }).limit(120).then(function (r) {
      var b = $('#aBody'); if (!b) return;
      var all = (r && r.data) || [];
      var list = all.filter(function (x) {
        var ev = x.event_type || '';
        if (st.lf === 'prod') return /^(product_|code_|cat_)/.test(ev);
        if (st.lf === 'admin') return /^(admin_|bot_admin|user_|uid_|chat_)/.test(ev);
        if (st.lf === 'money') return /^(topup_|order_|balance_)/.test(ev);
        return true;
      });
      var fs = [['all', 'fAll'], ['prod', 'lfProd'], ['admin', 'lfAdmin'], ['money', 'lfMoney']].map(function (x) {
        return '<button type="button" class="opt' + (st.lf === x[0] ? ' on' : '') + '" data-lf="' + x[0] + '">' + esc(t(x[1])) + '</button>';
      }).join('');
      var rows = !list.length ? '<div class="lock">' + esc(t('noLogs')) + '</div>' : list.map(renderLogRow).join('');
      b.innerHTML = '<div class="chips" style="margin-bottom:14px">' + fs + '</div><div class="panel" style="padding:0;overflow:hidden">' + rows + '</div>';
      $$('[data-lf]', b).forEach(function (btn) { btn.onclick = function () { st.lf = btn.dataset.lf; loadLogs(); }; });
    });
  }

  $('#lb').onclick = function () { this.classList.remove('open'); };
  var mfc = $('#mFullChat');
  if (mfc) {
    mfc.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]') || e.target === this) {
        activeChatUser = null;
      }
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') activeChatUser = null;
  });
  App.start(function () {
    boot();
    App.on('auth', boot);
    App.on('lang', function () { I18N.apply(); boot(); });
  });
})();
