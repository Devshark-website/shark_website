/* SHARK Shop - ค่าที่เก็บในเบราว์เซอร์ (เฉพาะการตั้งค่า เช่น ภาษา / โหมดอุปกรณ์)
   ข้อมูลสำคัญ (บัญชี ยอดเงิน สินค้า ออเดอร์) อยู่บนเซิร์ฟเวอร์ Supabase ทั้งหมด */
(function () {
  /* GitHub Pages: ทุกโปรเจกต์ของบัญชีเดียวกันใช้โดเมน username.github.io ร่วมกัน
     จึงใส่ชื่อโฟลเดอร์/รีโป (path) ไว้ในคีย์ เพื่อไม่ให้ชนกับเว็บอื่นในโดเมนเดียวกัน */
  var base = (location.pathname.replace(/[^\/]*$/, '') || '/').replace(/\/+$/, '');
  var P = 'shark_' + (base ? base + '_' : '');
  window.S = {
    get: function (k, d) {
      try { var v = localStorage.getItem(P + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set: function (k, v) {
      try { localStorage.setItem(P + k, JSON.stringify(v)); return true; } catch (e) { return false; }
    },
    del: function (k) { try { localStorage.removeItem(P + k); } catch (e) {} }
  };
})();
