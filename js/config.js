/* SHARK Shop - ตั้งค่าร้าน / Shop settings
   ===================================================================
   ทำตามไฟล์ SETUP.md ก่อน แล้วนำค่ามาใส่ในไฟล์นี้
   (ค่าในไฟล์นี้เปิดเผยได้ — anon key และ site key ของ Turnstile ออกแบบมาให้อยู่ฝั่งหน้าเว็บ
    ห้ามใส่ service_role key หรือ secret key ใด ๆ ลงในไฟล์นี้เด็ดขาด)
   =================================================================== */
window.SHOP_CONFIG = {
  name: 'SHARK',

  /* 1) Supabase: Project Settings > API (หรือ Connect) */
  supabaseUrl: 'https://uzlobfmbtyiavkfodmes.supabase.co',
  supabaseAnonKey: 'sb_publishable_lhVYHxw1l2gBq4lsCnNm3Q_q_KxKMnv',

  /* 2) Cloudflare Turnstile (ระบบเช็คว่าไม่ใช่บอท) — ใส่ "Site Key"
        '1x00000000000000000000AA' คือคีย์ทดสอบของ Cloudflare (ผ่านทุกครั้ง) ใช้ทดสอบเท่านั้น
        ปล่อยว่าง '' = ปิดระบบเช็คบอท */
  turnstileSiteKey: '1x00000000000000000000AA',

  /* 3) เติมเงิน (minTopup/maxTopup ต้องตรงกับ cfg_min_topup/cfg_max_topup ใน supabase/schema.sql) */
  minTopup: 10,
  maxTopup: 50000,
  presets: [50, 100, 300, 500, 1000],
  promptpay: { id: '0661612417', name: 'ศุภกร สายเเวว', qrImage: 'assets/promptpay-qr.jpg' },
  truemoney: { phone: '066-161-2417', name: 'ศุภกร สายเเวว' },
  methods: ['promptpay', 'truemoney'],

  /* 4) AI ผู้ช่วยร้านค้า (Google Gemini API)
        คีย์ GEMINI_API_KEY ถูกย้ายไปเก็บในไฟล์ bot/app.py ฝั่งบอท Python แล้วเชื่อมกับหน้าเว็บผ่าน Supabase อัตโนมัติ */

  /* 5) อื่น ๆ */
  announcement: { th: 'ยินดีต้อนรับสู่ SHARK Shop! เติมเงินผ่านพร้อมเพย์ได้ตลอด 24 ชม.', en: 'Welcome to SHARK Shop! PromptPay top-up available 24/7.' },
  contact: { line: '', facebook: '', discord: '' }               // ใส่ลิงก์เต็ม เช่น https://line.me/ti/p/~xxxx
};
