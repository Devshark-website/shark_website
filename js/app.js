/* SHARK Shop - หน้าแรก: แสดงการ์ดหมวดหมู่ (กดแล้วเปิดหน้าหมวดแยกกัน) และสินค้าแนะนำ พร้อมระบบประกาศสด */
(function () {
  var $ = App.$, esc = App.esc, nm = App.nm, t = I18N.t;
  var data = { cats: [], prods: [], announcements: [] };
  var activeAnnIdx = 0;
  var transitionTimer = null;

  var typeBadgeMap = {
    info: '📢 ข่าวสารทั่วไป',
    promo: '🎁 โปรโมชั่นพิเศษ',
    alert: '⚡ ประกาศสำคัญ',
    event: '🎉 กิจกรรมพิเศษ',
    update: '🛠️ อัปเดตระบบ'
  };

  function fmtContent(txt) {
    if (!txt) return '';
    var s = esc(txt);
    s = s.replace(/https?:\/\/[^\s<]+/g, function (url) {
      return '<a href="' + url + '" target="_blank" rel="noopener">' + url + '</a>';
    });
    return s.replace(/\n/g, '<br>');
  }

  function formatTimeRemaining(endsAtStr) {
    if (!endsAtStr) return '⏳ ประกาศต่อเนื่อง';
    var e = new Date(endsAtStr);
    var now = new Date();
    var diffMs = e.getTime() - now.getTime();
    if (diffMs <= 0) return '⌛ หมดอายุแล้ว';

    var diffMins = Math.floor(diffMs / 60000);
    var diffHours = Math.floor(diffMins / 60);
    var diffDays = Math.floor(diffHours / 24);

    if (diffDays >= 2) {
      return '⏳ ถึง: ' + App.fmtTime(endsAtStr);
    } else if (diffDays === 1) {
      return '⏳ เหลืออีก 1 วัน (' + (diffHours % 24) + ' ชม.)';
    } else if (diffHours > 0) {
      return '⏳ เหลืออีก ' + diffHours + ' ชม. ' + (diffMins % 60) + ' นาที';
    } else {
      return '⏳ สิ้นสุดในอีก ' + Math.max(1, diffMins) + ' นาที';
    }
  }

  function loadAnnouncements() {
    return App.getAnnouncements().then(function (list) {
      data.announcements = list || [];
      renderAnnouncement();
    });
  }

  function renderAnnouncement() {
    if (transitionTimer) {
      clearTimeout(transitionTimer);
      transitionTimer = null;
    }

    var wrap = $('#announcementSection');
    if (!wrap) return;

    var filtered = App.filterAnnouncements(data.announcements);
    var activeList = filtered.activeList || [];

    // หากไม่มีประกาศที่กำลังแสดงอยู่
    if (!activeList.length) {
      wrap.classList.add('hide');
      // หากมีประกาศถัดไปที่ตั้งเวลาไว้ในอนาคต ให้ตั้งเวลาปลุกเพื่อแสดงประกาศนั้นเมื่อถึงเวลาเริ่ม
      if (filtered.nextTransitionMs && filtered.nextTransitionMs > 0) {
        transitionTimer = setTimeout(function () {
          renderAnnouncement();
        }, filtered.nextTransitionMs + 500);
      }
      return;
    }

    if (activeAnnIdx >= activeList.length) activeAnnIdx = 0;
    var ann = activeList[activeAnnIdx];

    // ตรวจสอบว่าผู้ใช้เคยกดปิดประกาศนี้ใน session หรือไม่
    var dismissed = false;
    try {
      dismissed = !!sessionStorage.getItem('shark_ann_x_' + ann.id);
    } catch (e) {}

    if (dismissed) {
      // หากมีประกาศอื่นที่ยังไม่ได้ปิด ให้แสดงอันถัดไป
      var unDismissedIdx = -1;
      for (var i = 0; i < activeList.length; i++) {
        var isD = false;
        try { isD = !!sessionStorage.getItem('shark_ann_x_' + activeList[i].id); } catch (e) {}
        if (!isD) { unDismissedIdx = i; break; }
      }
      if (unDismissedIdx === -1) {
        wrap.classList.add('hide');
        return;
      }
      activeAnnIdx = unDismissedIdx;
      ann = activeList[activeAnnIdx];
    }

    var card = $('#annCard');
    if (card) {
      card.className = 'announcement-card type-' + (ann.type || 'info');
    }

    var badgeEl = $('#annBadge');
    if (badgeEl) {
      badgeEl.textContent = ann.badge || typeBadgeMap[ann.type] || '📢 ประกาศ';
    }

    var timerEl = $('#annTimer');
    if (timerEl) {
      timerEl.textContent = formatTimeRemaining(ann.ends_at);
      if (ann.ends_at) {
        timerEl.title = 'สิ้นสุด: ' + App.fmtTime(ann.ends_at) + ' (หลังจากนี้จะแสดงประกาศถัดไป)';
      } else {
        timerEl.title = 'ประกาศไม่มีกำหนดหมดอายุ';
      }
    }

    var titleEl = $('#annTitle');
    if (titleEl) titleEl.textContent = ann.title || 'ประกาศ';

    var descEl = $('#annDesc');
    if (descEl) descEl.innerHTML = fmtContent(ann.content);

    var mediaEl = $('#annMedia');
    var imgEl = $('#annImg');
    if (mediaEl && imgEl) {
      if (ann.image_url) {
        imgEl.src = ann.image_url;
        mediaEl.classList.remove('hide');
      } else {
        mediaEl.classList.add('hide');
      }
    }

    var actEl = $('#annActions');
    var linkBtn = $('#annLinkBtn');
    if (actEl && linkBtn) {
      if (ann.link_url) {
        linkBtn.href = ann.link_url;
        linkBtn.textContent = ann.link_text || '👉 ดูรายละเอียดเพิ่มเติม';
        if (/^https?:\/\//i.test(ann.link_url)) {
          linkBtn.target = '_blank';
          linkBtn.rel = 'noopener';
        } else {
          linkBtn.removeAttribute('target');
          linkBtn.removeAttribute('rel');
        }
        actEl.classList.remove('hide');
      } else {
        actEl.classList.add('hide');
      }
    }

    // จุดสลับเปลี่ยนประกาศ (Dots) กรณีมีหลายประกาศที่เปิดใช้งานพร้อมกัน
    var dotsEl = $('#annDots');
    if (dotsEl) {
      if (activeList.length > 1) {
        dotsEl.innerHTML = activeList.map(function (_, idx) {
          return '<span class="ann-dot' + (idx === activeAnnIdx ? ' active' : '') + '" data-adot="' + idx + '"></span>';
        }).join('');
        dotsEl.classList.remove('hide');
        $$('[data-adot]', dotsEl).forEach(function (dot) {
          dot.onclick = function () {
            activeAnnIdx = Number(dot.dataset.adot);
            renderAnnouncement();
          };
        });
      } else {
        dotsEl.classList.add('hide');
      }
    }

    // ปุ่มปิดประกาศ (Dismiss)
    var closeBtn = $('#annCloseBtn');
    if (closeBtn) {
      closeBtn.onclick = function () {
        try { sessionStorage.setItem('shark_ann_x_' + ann.id, '1'); } catch (e) {}
        renderAnnouncement();
      };
    }

    wrap.classList.remove('hide');

    // ตั้งเวลาสลับเปลี่ยนประกาศอัตโนมัติ (เมื่อประกาศหมดอายุ จะเปลี่ยนเป็นประกาศใหม่ทันที!)
    if (filtered.nextTransitionMs && filtered.nextTransitionMs > 0) {
      transitionTimer = setTimeout(function () {
        renderAnnouncement();
      }, filtered.nextTransitionMs + 500);
    }
  }

  function load() {
    return Promise.all([
      App.categories(),
      App.sb.from('shop_products').select('*').order('featured', { ascending: false }).order('sort').order('created_at', { ascending: false })
    ]).then(function (r) {
      data.cats = r[0] || [];
      data.prods = (r[1] && r[1].data) || [];
      draw();
    });
  }

  function draw() {
    var counts = {};
    data.prods.forEach(function (p) { counts[p.category_id] = (counts[p.category_id] || 0) + 1; });
    var cg = $('#catGrid');
    if (!data.cats.length) {
      cg.innerHTML = '<div class="empty">' + esc(t('noItems')) + '</div>';
    } else {
      cg.innerHTML = data.cats.map(function (c) {
        var n = nm(c), cnt = counts[c.id] || 0, img = c.image_url || App.ph(n);
        return '<a class="catcard rv" href="category.html?c=' + encodeURIComponent(c.slug) + '">' +
          '<div class="thumb"><img loading="lazy" alt="' + esc(n) + '" src="' + esc(img) + '"></div>' +
          '<div class="cb"><span class="cnt">' + cnt + ' ' + esc(t('items')) + '</span><h3>' + esc(n) + '</h3>' +
          '<p>' + esc(nm(c, 'desc')) + '</p></div></a>';
      }).join('');
    }
    var feat = data.prods.filter(function (p) { return p.featured; });
    if (!feat.length) feat = data.prods.slice(0, 8);
    var fg = $('#featGrid');
    fg.innerHTML = feat.length ? feat.slice(0, 8).map(App.card).join('') : '<div class="empty">' + esc(t('noItems')) + '</div>';
    if (window.FX) FX.reveal();
  }

  App.start(function () {
    if ($('#title') && !$('#title').children.length && window.FX) FX.letters($('#title'), SHOP_CONFIG.name || 'SHARK');
    load();
    loadAnnouncements();
    App.on('lang', function () {
      draw();
      renderAnnouncement();
    });
    App.on('store_change', load);
    App.on('announcement_change', loadAnnouncements);
  });
})();
