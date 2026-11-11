/* SHARK Shop - หน้าแรก: แสดงการ์ดหมวดหมู่ (กดแล้วเปิดหน้าหมวดแยกกัน) และสินค้าแนะนำ */
(function () {
  var $ = App.$, esc = App.esc, nm = App.nm, t = I18N.t;
  var data = { cats: [], prods: [] };

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
    App.on('lang', draw);
    App.on('store_change', load);
  });
})();
