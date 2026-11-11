/* SHARK Shop - สร้าง QR พร้อมเพย์ตามมาตรฐาน EMVCo (Thai QR Payment) แบบระบุจำนวนเงิน
   ใช้ได้กับทุกแอปธนาคาร เงินเข้าบัญชีพร้อมเพย์ของร้านโดยตรง ไม่มีตัวกลาง/ค่าธรรมเนียม */
(function () {
  function f(id, v) { return id + ('0' + v.length).slice(-2) + v; }
  function crc16(s) {
    var crc = 0xFFFF;
    for (var i = 0; i < s.length; i++) {
      crc ^= s.charCodeAt(i) << 8;
      for (var j = 0; j < 8; j++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xFFFF;
    }
    return ('000' + crc.toString(16).toUpperCase()).slice(-4);
  }
  /* id: เบอร์มือถือ 10 หลัก / เลขบัตรประชาชน-ผู้เสียภาษี 13 หลัก / e-Wallet 15 หลัก */
  function payload(id, amount) {
    var n = String(id || '').replace(/\D/g, ''), tag, target;
    if (n.length >= 15) { tag = '03'; target = n; }
    else if (n.length >= 13) { tag = '02'; target = n; }
    else { tag = '01'; target = ('0000000000000' + n.replace(/^0/, '66')).slice(-13); }
    var amt = Number(amount) > 0 ? Number(amount).toFixed(2) : '';
    var p = f('00', '01') + f('01', amt ? '12' : '11') +
      f('29', f('00', 'A000000677010111') + f(tag, target)) +
      f('53', '764') + (amt ? f('54', amt) : '') + f('58', 'TH') + '6304';
    return p + crc16(p);
  }
  function render(canvas, id, amount) {
    var txt = payload(id, amount), x = canvas.getContext('2d'), sz = 240;
    canvas.width = canvas.height = sz;
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, sz, sz);
    if (typeof window.qrcode === 'function') {
      var qr = window.qrcode(0, 'M'); qr.addData(txt); qr.make();
      var n = qr.getModuleCount(), cell = Math.floor((sz - 24) / n), off = Math.floor((sz - n * cell) / 2);
      x.fillStyle = '#0b0826';
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.isDark(r, c)) x.fillRect(off + c * cell, off + r * cell, cell, cell);
    }
    return txt;
  }
  window.PromptPay = { payload: payload, crc16: crc16, render: render };
})();
