-- =====================================================================
--  SHARK Shop - ฐานข้อมูลหลังบ้าน (Supabase / PostgreSQL)
--  วิธีใช้: Supabase Dashboard > SQL Editor > New query > วางทั้งไฟล์ > Run
--  รันซ้ำได้ (ปลอดภัย) — ใช้ "create or replace" / "if not exists" เกือบทั้งหมด
--
--  หลักความปลอดภัย:
--  * ยอดเงิน / สต็อก / ออเดอร์ เปลี่ยนได้ผ่านฟังก์ชันฝั่งเซิร์ฟเวอร์เท่านั้น (ลูกค้าแก้เองไม่ได้)
--  * ทุกตารางเปิด Row Level Security
-- =====================================================================

-- ---------------------------------------------------------------------
-- ค่าตั้งเติมเงินฝั่งเซิร์ฟเวอร์ (ต้องตรงกับ minTopup / maxTopup ใน js/config.js)
-- ---------------------------------------------------------------------
create or replace function public.cfg_min_topup() returns numeric language sql immutable set search_path = public as $$ select 10::numeric $$;
create or replace function public.cfg_max_topup() returns numeric language sql immutable set search_path = public as $$ select 50000::numeric $$;

-- =====================================================================
-- 1) ตาราง
-- =====================================================================
create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  username          text not null,
  game_uid          text not null default '',
  balance           numeric(12,2) not null default 0 check (balance >= 0),
  is_admin          boolean not null default false,
  banned            boolean not null default false,
  ban_reason        text not null default '',
  banned_at         timestamptz,
  discord_id        text not null default '',
  discord_username  text not null default '',
  discord_avatar    text not null default '',
  created_at        timestamptz not null default now(),
  constraint username_format check (username ~ '^[A-Za-z0-9_]{3,20}$')
);
alter table public.profiles add column if not exists game_uid text not null default '';
-- เหตุผล / เวลาที่ถูกระงับบัญชี (แสดงให้ลูกค้าเห็น + ส่งแจ้งเตือนเข้า Discord)
alter table public.profiles add column if not exists ban_reason text not null default '';
alter table public.profiles add column if not exists banned_at  timestamptz;
-- ข้อมูลบัญชี Discord ที่เชื่อมต่อผ่าน Discord Login
alter table public.profiles add column if not exists discord_id text not null default '';
alter table public.profiles add column if not exists discord_username text not null default '';
alter table public.profiles add column if not exists discord_avatar text not null default '';
-- บังคับชื่อผู้ใช้เป็นภาษาอังกฤษ ตัวเลข หรือ _ เท่านั้น (ไม่กระทบแถวเก่าหากมีค้างอยู่ เพื่อให้แอดมินกดลบบัญชีเก่าได้)
alter table public.profiles drop constraint if exists username_format;
alter table public.profiles add constraint username_format check (username ~ '^[A-Za-z0-9_]{3,20}$') not valid;
-- กันชื่อซ้ำ (ไม่สนตัวพิมพ์เล็ก/ใหญ่)  Unique username, case-insensitive
create unique index if not exists profiles_username_lower on public.profiles (lower(username));

create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{1,40}$'),
  name_th     text not null,
  name_en     text not null default '',
  desc_th     text not null default '',
  desc_en     text not null default '',
  image_url   text not null default '',
  sort        int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.products (
  id              uuid primary key default gen_random_uuid(),
  category_id     uuid not null references public.categories(id) on delete cascade,
  name_th         text not null,
  name_en         text not null default '',
  desc_th         text not null default '',
  desc_en         text not null default '',
  price           numeric(12,2) not null check (price >= 0),
  images          text[] not null default '{}',
  -- code   = ส่งบัญชี/โค้ดอัตโนมัติจากคลัง (สต็อก = จำนวนที่ยังไม่ขาย)
  -- manual = แอดมินส่งของเอง (สต็อกตามตัวเลข, -1 = ไม่จำกัด)
  delivery        text not null default 'manual' check (delivery in ('code','manual')),
  -- รูปแบบบัญชีที่ส่งอัตโนมัติ: email_pass = อีเมล+รหัสผ่าน, user_pass = ชื่อผู้ใช้+รหัสผ่าน
  credential_type text not null default 'email_pass' check (credential_type in ('email_pass','user_pass','code')),
  stock           int  not null default -1 check (stock >= -1),
  input_label     text not null default '',          -- ถ้าใส่ ลูกค้าต้องกรอกข้อมูลนี้ตอนเติมเกม/ซื้อแต่ละครั้ง เช่น "UID เกม"
  active          boolean not null default true,
  featured        boolean not null default false,
  sort            int  not null default 0,
  sold            int  not null default 0,
  created_at      timestamptz not null default now()
);
alter table public.products add column if not exists credential_type text not null default 'email_pass';
alter table public.products drop constraint if exists products_credential_type_check;
alter table public.products add constraint products_credential_type_check check (credential_type in ('email_pass','user_pass','code'));
create index if not exists products_category on public.products (category_id);

create table if not exists public.product_codes (
  id          bigint generated always as identity primary key,
  product_id  uuid not null references public.products(id) on delete cascade,
  code        text not null,
  order_id    uuid,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists product_codes_product on public.product_codes (product_id);
create index if not exists product_codes_free on public.product_codes (product_id, id) where order_id is null;

create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  product_id      uuid references public.products(id) on delete set null,
  product_name    jsonb not null,
  qty             int not null default 1 check (qty > 0),
  unit_price      numeric(12,2) not null,
  total           numeric(12,2) not null,
  customer_input  text not null default '',
  delivered       text not null default '',
  status          text not null default 'pending' check (status in ('pending','done','cancelled')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists orders_user on public.orders (user_id, created_at desc);
create index if not exists orders_product on public.orders (product_id);
create index if not exists orders_status on public.orders (status, created_at desc);

create table if not exists public.topups (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  amount       numeric(12,2) not null check (amount <> 0),
  method       text not null check (method in ('promptpay','truemoney','bank','admin')),
  game_uid     text not null default '',
  ref          text not null default '',
  slip_path    text not null default '',
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  note         text not null default '',
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz,
  reviewed_by  uuid
);
alter table public.topups add column if not exists game_uid text not null default '';
create index if not exists topups_user on public.topups (user_id, created_at desc);
create index if not exists topups_status on public.topups (status, created_at desc);
-- กันใช้เลขสลิป / ลิงก์ซองอั่งเปาซ้ำ  Block re-using the same slip ref / gift link
create unique index if not exists topups_ref_once on public.topups (method, lower(ref))
  where ref <> '' and status <> 'rejected' and method <> 'admin';

-- แอดมินของบอท Discord (กำหนดเพิ่ม/ถอดได้จากทั้งบอท Discord และหน้าเว็บแอดมิน)
create table if not exists public.bot_admins (
  discord_id  text primary key check (discord_id ~ '^[0-9]{15,22}$'),
  label       text not null default '',
  added_by    text not null default '',
  created_at  timestamptz not null default now()
);

-- ประวัติแจ้งเตือนและกิจกรรมทุกอย่างในระบบ (สำหรับดูผ่านหลังร้านและคำสั่ง /logs ใน Discord)
create table if not exists public.admin_logs (
  id          bigint generated always as identity primary key,
  event_type  text not null,
  title       text not null,
  detail      text not null default '',
  actor       text not null default 'Admin',
  created_at  timestamptz not null default now()
);
create index if not exists admin_logs_created on public.admin_logs (created_at desc);

-- ระบบแชทคุยกับแอดมินและ AI ผู้ช่วยร้านค้า (เชื่อมหน้าเว็บ <-> หลังร้าน <-> บอท Discord แบบเรียลไทม์)
create table if not exists public.support_chats (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.profiles(id) on delete cascade,
  session_id  text not null default '',
  username    text not null default '',
  sender      text not null check (sender in ('user','admin','ai')),
  channel     text not null default 'admin' check (channel in ('admin','ai')),
  message     text not null check (char_length(btrim(message)) between 1 and 2000),
  replied     boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.support_chats alter column user_id drop not null;
alter table public.support_chats add column if not exists session_id text not null default '';
create index if not exists support_chats_user on public.support_chats (user_id, created_at asc);
create index if not exists support_chats_session on public.support_chats (session_id, id asc);
create index if not exists support_chats_pending on public.support_chats (channel, replied, created_at desc);

-- แจ้งเตือนบัญชีโดนระงับ / ปลดระงับ / ถูกลบ (เก็บ snapshot ยอดเงิน+ข้อมูลทั้งหมด ณ ตอนเกิดเหตุ แม้บัญชีจะถูกลบไปแล้ว)
-- บอท Discord จะดึงรายการที่ notified = false ไปโพสต์ทันที และ (ถ้าตั้ง Webhook ไว้) ฐานข้อมูลจะยิงเข้า Discord เองโดยตรง
create table if not exists public.account_alerts (
  id           bigint generated always as identity primary key,
  event        text not null check (event in ('ban','unban','delete','self_delete')),
  user_id      uuid,
  username     text not null default '',
  email        text not null default '',
  balance      numeric(12,2) not null default 0,
  reason       text not null default '',
  actor        text not null default '',
  snapshot     jsonb not null default '{}'::jsonb,
  notified     boolean not null default false,
  notified_at  timestamptz,
  webhook_sent boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists account_alerts_pending on public.account_alerts (notified, id) where not notified;
create index if not exists account_alerts_created on public.account_alerts (created_at desc);

-- ค่าตั้งระบบฝั่งเซิร์ฟเวอร์ (เฉพาะแอดมิน) เช่น discord_webhook_url
create table if not exists public.app_settings (
  key         text primary key check (key ~ '^[a-z0-9_]{2,60}$'),
  value       text not null default '',
  updated_at  timestamptz not null default now()
);

-- ระบบประกาศหน้าเว็บ (Announcements System)
-- รองรับการตั้งประกาศ, กำหนดวันหมดอายุ (เมื่อหมดอายุจะถูกแทนที่ด้วยประกาศถัดไปที่ตั้งไว้), ป้ายกำกับ, รูปภาพ, ลิงก์
create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  content     text not null default '',
  type        text not null default 'info' check (type in ('info', 'promo', 'alert', 'event', 'update')),
  badge       text not null default '',
  image_url   text not null default '',
  link_url    text not null default '',
  link_text   text not null default '',
  is_active   boolean not null default true,
  priority    integer not null default 0,
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_announcements_active on public.announcements(is_active, starts_at, ends_at);
create index if not exists idx_announcements_priority on public.announcements(priority desc, starts_at desc);

-- ระบบ Ticket ประสานงานหน้าเว็บ & Discord Bot
create table if not exists public.tickets (
  id                  uuid primary key default gen_random_uuid(),
  ticket_number       serial,
  user_id             uuid references auth.users(id) on delete set null,
  discord_user_id     text not null default '',
  discord_username    text not null default '',
  discord_channel_id  text not null default '',
  title               text not null default 'สอบถามทั่วไป',
  status              text not null default 'open' check (status in ('open', 'closed')),
  created_at          timestamptz not null default now(),
  closed_at           timestamptz,
  closed_by           text not null default ''
);
create index if not exists idx_tickets_user on public.tickets(user_id, status);
create index if not exists idx_tickets_discord_ch on public.tickets(discord_channel_id);

create table if not exists public.ticket_messages (
  id                  bigserial primary key,
  ticket_id           uuid not null references public.tickets(id) on delete cascade,
  sender              text not null check (sender in ('user', 'admin', 'system')),
  sender_name         text not null default '',
  sender_avatar       text not null default '',
  message             text not null,
  source              text not null default 'web' check (source in ('web', 'discord')),
  discord_msg_id      text not null default '',
  synced_to_discord   boolean not null default false,
  created_at          timestamptz not null default now()
);
create index if not exists idx_tm_ticket on public.ticket_messages(ticket_id, created_at asc);
create index if not exists idx_tm_unsynced on public.ticket_messages(synced_to_discord) where not synced_to_discord;

-- pg_net = ให้ฐานข้อมูลยิง HTTP ไป Discord Webhook ได้เองทันที (ถ้าเปิดไม่ได้ ระบบยังส่งผ่านบอทได้ตามปกติ)
do $$ begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net ไม่พร้อมใช้งาน: แจ้งเตือนจะส่งผ่านบอท Discord เท่านั้น';
end $$;

-- =====================================================================
-- 2) ฟังก์ชันช่วย
-- =====================================================================
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
      or coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '') = 'service_role'
      or coalesce((select is_admin from public.profiles where id = (select auth.uid())), false);
$$;

-- สร้างโปรไฟล์อัตโนมัติเมื่อสมัคร (ชื่อต้องเป็นภาษาอังกฤษเท่านั้น) และยืนยันอีเมลให้อัตโนมัติ (ดึงข้อมูล Discord อัตโนมัติถ้ามี)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uname text := btrim(coalesce(new.raw_user_meta_data->>'username', new.raw_user_meta_data->>'user_name', new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''));
  d_id text := coalesce(new.raw_user_meta_data->>'provider_id', new.raw_user_meta_data->>'sub', '');
  d_name text := coalesce(new.raw_user_meta_data->>'user_name', new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '');
  d_avatar text := coalesce(new.raw_user_meta_data->>'avatar_url', '');
begin
  if uname = '' or uname !~ '^[A-Za-z0-9_]{3,20}$' then
    uname := 'user_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;
  insert into public.profiles (id, username, discord_id, discord_username, discord_avatar)
  values (new.id, uname, d_id, d_name, d_avatar)
  on conflict (id) do update
    set discord_id = coalesce(nullif(excluded.discord_id, ''), public.profiles.discord_id),
        discord_username = coalesce(nullif(excluded.discord_username, ''), public.profiles.discord_username),
        discord_avatar = coalesce(nullif(excluded.discord_avatar, ''), public.profiles.discord_avatar);

  update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = new.id and email_confirmed_at is null;
  insert into public.admin_logs (event_type, title, detail, actor)
  values ('user_reg', '🆕 สมัครสมาชิกใหม่: ' || uname, 'อีเมล: ' || coalesce(new.email, '-') || ' | Discord: ' || coalesce(d_name, '-'), 'เว็บ (' || uname || ')');
  return new;
end $$;

-- ฟังก์ชันสำหรับอัปเดตข้อมูล Discord ของผู้ใช้ปัจจุบัน
create or replace function public.sync_discord_profile(p_discord_id text, p_discord_username text, p_discord_avatar text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  end if;
  update public.profiles
     set discord_id = coalesce(nullif(btrim(p_discord_id), ''), discord_id),
         discord_username = coalesce(nullif(btrim(p_discord_username), ''), discord_username),
         discord_avatar = coalesce(nullif(btrim(p_discord_avatar), ''), discord_avatar)
   where id = v_uid;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.sync_discord_profile(text, text, text) to authenticated, anon;

-- ยืนยันอีเมลให้บัญชีที่อาจค้างอยู่ก่อนหน้านี้ทั้งหมด
update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where email_confirmed_at is null;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- เช็คชื่อว่าง (บังคับภาษาอังกฤษ ตัวเลข และ _ ความยาว 3-20 ตัวเท่านั้น)
create or replace function public.username_available(name text) returns boolean
language sql stable security definer set search_path = public as $$
  select btrim(coalesce(name, '')) ~ '^[A-Za-z0-9_]{3,20}$'
     and not exists (select 1 from public.profiles where lower(username) = lower(btrim(name)));
$$;

-- นับจำนวนบัญชี/โค้ดที่ยังไม่ขาย (คืนเฉพาะตัวเลข ไม่เปิดเผยรหัสจริง)
create or replace function public.code_stock_left(p_product uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.product_codes where product_id = p_product and order_id is null;
$$;

-- สินค้าที่แสดงหน้าร้าน + สต็อกคงเหลือจริง + รูปแบบบัญชีอัตโนมัติ (credential_type)
drop view if exists public.shop_products;
create view public.shop_products with (security_invoker = true) as
  select p.id, p.category_id, c.slug as category_slug, p.name_th, p.name_en, p.desc_th, p.desc_en,
         p.price, p.images, p.delivery, p.credential_type, p.input_label, p.featured, p.sort, p.sold, p.created_at,
         case when p.stock = 0 then 0
              when p.delivery = 'code' then public.code_stock_left(p.id)
              else p.stock end as stock_left
  from public.products p join public.categories c on c.id = p.category_id
  where p.active and c.active;

-- =====================================================================
-- 3) ฟังก์ชันของลูกค้า
-- =====================================================================

-- ซื้อสินค้า / เติมเกม: ตัดเงิน + ตัดสต็อก + ส่งบัญชีอัตโนมัติ ในธุรกรรมเดียว (UID กรอกเฉพาะตอนสั่งซื้อครั้งนี้ ไม่บันทึกถาวร)
create or replace function public.buy_product(p_product uuid, p_qty int default 1, p_input text default '')
returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  me    uuid := auth.uid();
  prof  public.profiles%rowtype;
  prod  public.products%rowtype;
  amt   numeric(12,2);
  codes text[];
  o     public.orders%rowtype;
begin
  if me is null then raise exception 'NOT_LOGGED_IN'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 20 then raise exception 'BAD_QTY'; end if;

  select * into prof from public.profiles where id = me for update;
  if not found then raise exception 'NOT_LOGGED_IN'; end if;
  if prof.banned then raise exception 'BANNED'; end if;

  select p.* into prod from public.products p join public.categories c on c.id = p.category_id
   where p.id = p_product and p.active and c.active for update of p;
  if not found then raise exception 'NO_PRODUCT'; end if;
  if prod.stock = 0 then raise exception 'NO_STOCK'; end if;
  if prod.input_label <> '' and btrim(coalesce(p_input, '')) = '' then raise exception 'NEED_INPUT'; end if;

  amt := prod.price * p_qty;
  if prof.balance < amt then raise exception 'NO_BALANCE'; end if;

  insert into public.orders (user_id, product_id, product_name, qty, unit_price, total, customer_input)
  values (me, prod.id, jsonb_build_object('th', prod.name_th, 'en', coalesce(nullif(prod.name_en, ''), prod.name_th)),
          p_qty, prod.price, amt, left(btrim(coalesce(p_input, '')), 300))
  returning * into o;

  if prod.delivery = 'code' then
    with picked as (
      select id from public.product_codes
       where product_id = prod.id and order_id is null
       order by id limit p_qty for update skip locked
    ), upd as (
      update public.product_codes pc set order_id = o.id, used_at = now()
        from picked where pc.id = picked.id returning pc.code
    )
    select array_agg(code) into codes from upd;
    if coalesce(array_length(codes, 1), 0) < p_qty then raise exception 'NO_STOCK'; end if;
    update public.orders set delivered = array_to_string(codes, E'\n'), status = 'done', updated_at = now()
     where id = o.id returning * into o;
  else
    if prod.stock >= 0 then
      if prod.stock < p_qty then raise exception 'NO_STOCK'; end if;
      update public.products set stock = stock - p_qty where id = prod.id;
    end if;
  end if;

  update public.products set sold = sold + p_qty where id = prod.id;
  update public.profiles set balance = balance - amt where id = me;
  return o;
end $$;

-- แจ้งเติมเงินพร้อมแนบสลิป (ไม่ผูก UID ถาวรกับบัญชี)
drop function if exists public.request_topup(numeric, text, text, text);
create or replace function public.request_topup(
  p_amount numeric,
  p_method text,
  p_ref    text default '',
  p_slip   text default '',
  p_uid    text default ''
)
returns public.topups
language plpgsql security definer set search_path = public as $$
declare
  me   uuid := auth.uid();
  prof public.profiles%rowtype;
  r    public.topups%rowtype;
  ref  text := left(btrim(coalesce(p_ref, '')), 300);
  slip text := btrim(coalesce(p_slip, ''));
  guid text := '';  -- ไม่รับ UID ตอนเติมเงินแล้ว (กรอกเฉพาะตอนซื้อสินค้าที่ใช้ UID) — คง p_uid ไว้เพื่อให้หน้าเว็บเก่าเรียกได้
begin
  if me is null then raise exception 'NOT_LOGGED_IN'; end if;
  select * into prof from public.profiles where id = me;
  if not found then raise exception 'NOT_LOGGED_IN'; end if;
  if prof.banned then raise exception 'BANNED'; end if;
  if p_method not in ('promptpay', 'truemoney') then raise exception 'BAD_METHOD'; end if;
  if p_amount is null or p_amount < public.cfg_min_topup() or p_amount > public.cfg_max_topup() then raise exception 'BAD_AMOUNT'; end if;
  if slip = '' then raise exception 'NEED_SLIP'; end if;
  if slip not like me::text || '/%' then raise exception 'BAD_SLIP'; end if;
  if (select count(*) from public.topups where user_id = me and status = 'pending') >= 5 then raise exception 'TOO_MANY_PENDING'; end if;

  begin
    insert into public.topups (user_id, amount, method, game_uid, ref, slip_path, status)
    values (me, round(p_amount, 2), p_method, guid, ref, slip, 'pending') returning * into r;
  exception when unique_violation then
    raise exception 'DUP_REF';
  end;
  return r;
end $$;

-- (ยกเลิกแล้ว) ระบบแก้ไข UID จากหน้า "บัญชีของฉัน" — UID กรอกได้เฉพาะตอนสั่งซื้อสินค้าที่ต้องใช้ UID เท่านั้น
drop function if exists public.update_my_uid(text);

-- ลบประวัติการคุยของตัวเอง (ทั้งแชท AI และแชทแอดมิน)
create or replace function public.clear_my_chats(p_channel text default 'all', p_session text default '')
returns int
language plpgsql security definer set search_path = public as $$
declare
  me    uuid := auth.uid();
  cnt   int := 0;
  uname text := 'Guest';
begin
  if me is not null then
    select coalesce(username, 'User') into uname from public.profiles where id = me;
    delete from public.support_chats
     where (user_id = me or (p_session <> '' and session_id = p_session))
       and (p_channel = 'all' or channel = p_channel);
    get diagnostics cnt = row_count;
  elsif btrim(coalesce(p_session, '')) <> '' then
    delete from public.support_chats
     where session_id = btrim(p_session)
       and (p_channel = 'all' or channel = p_channel);
    get diagnostics cnt = row_count;
  end if;

  if cnt > 0 then
    insert into public.admin_logs (event_type, title, detail, actor)
    values ('chat_del', '🗑️ ผู้ใช้ลบประวัติแชท (' || cnt || ' ข้อความ)', 'ช่องทาง: ' || coalesce(p_channel, 'all'), 'เว็บ (' || uname || ')');
  end if;
  return cnt;
end $$;

-- ลูกค้าลบบัญชีของตัวเอง
create or replace function public.delete_my_account()
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  p  public.profiles%rowtype;
begin
  if me is null then raise exception 'NOT_LOGGED_IN'; end if;
  select * into p from public.profiles where id = me;
  insert into public.admin_logs (event_type, title, detail, actor)
  values ('user_del', '🗑️ สมาชิกลบบัญชีตัวเอง: ' || coalesce(p.username, me::text), 'ยอดเงินก่อนลบ: ' || coalesce(p.balance, 0) || ' ฿', 'เว็บ (' || coalesce(p.username, 'User') || ')');
  -- บอก trigger แจ้งเตือน Discord ว่าเป็นการลบด้วยตัวเอง
  perform set_config('shark.event', 'self_delete', true);
  perform set_config('shark.reason', 'สมาชิกกดลบบัญชีตัวเองจากหน้าเว็บ', true);
  perform public.detach_user_storage(me);
  delete from public.profiles where id = me;
  delete from auth.users where id = me;
  return true;
end $$;

-- =====================================================================
-- 4) ฟังก์ชันของแอดมิน
-- =====================================================================
create or replace function public.admin_review_topup(p_id uuid, p_approve boolean, p_note text default '', p_amount numeric default null)
returns public.topups
language plpgsql security definer set search_path = public as $$
declare r public.topups%rowtype;
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  select * into r from public.topups where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.status <> 'pending' then raise exception 'ALREADY_REVIEWED'; end if;
  if p_approve then
    if p_amount is not null then
      if p_amount <= 0 then raise exception 'BAD_AMOUNT'; end if;
      r.amount := round(p_amount, 2);
    end if;
    update public.profiles set balance = balance + r.amount where id = r.user_id;
  end if;
  update public.topups
     set status = case when p_approve then 'approved' else 'rejected' end,
         amount = r.amount, note = left(coalesce(p_note, ''), 300), reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_id returning * into r;
  return r;
end $$;

-- เพิ่ม/ลดเงินผู้ใช้ด้วยมือ (บันทึกเป็นรายการ method = admin)
create or replace function public.admin_adjust_balance(p_user uuid, p_delta numeric, p_note text default '')
returns numeric
language plpgsql security definer set search_path = public as $$
declare nb numeric;
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  if p_delta is null or p_delta = 0 then raise exception 'BAD_AMOUNT'; end if;
  update public.profiles set balance = balance + round(p_delta, 2) where id = p_user returning balance into nb;
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into public.topups (user_id, amount, method, status, note, reviewed_at, reviewed_by)
  values (p_user, round(p_delta, 2), 'admin', 'approved', left(coalesce(p_note, ''), 300), now(), auth.uid());
  return nb;
exception when check_violation then
  raise exception 'NEGATIVE_BALANCE';
end $$;

-- ส่งของ / ยกเลิกออเดอร์ (ยกเลิก = คืนเงินอัตโนมัติ)
create or replace function public.admin_update_order(p_id uuid, p_status text, p_delivered text default null)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  if p_status not in ('pending', 'done', 'cancelled') then raise exception 'BAD_STATUS'; end if;
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status = 'cancelled' and p_status <> 'cancelled' then raise exception 'ALREADY_CANCELLED'; end if;

  if p_status = 'cancelled' and o.status <> 'cancelled' then
    update public.profiles set balance = balance + o.total where id = o.user_id;
    update public.products set sold = greatest(0, sold - o.qty),
                               stock = case when delivery = 'manual' and stock >= 0 then stock + o.qty else stock end
     where id = o.product_id;
  end if;

  update public.orders set status = p_status, delivered = coalesce(left(p_delivered, 4000), delivered), updated_at = now()
   where id = p_id returning * into o;
  return o;
end $$;

-- แอดมินลบประวัติการซื้อขาย (ลบทีละรายการ หรือล้างทั้งหมด)
create or replace function public.admin_delete_order(p_id uuid default null, p_clear_all boolean default false)
returns int
language plpgsql security definer set search_path = public as $$
declare
  cnt     int := 0;
  v_actor text := public.current_actor_label();
  o       public.orders%rowtype;
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  if p_clear_all then
    delete from public.orders;
    get diagnostics cnt = row_count;
    insert into public.admin_logs (event_type, title, detail, actor)
    values ('order_del', '🗑️ ล้างประวัติการซื้อขายทั้งหมด', 'ลบออเดอร์ทั้งหมด ' || cnt || ' รายการ', v_actor);
  elsif p_id is not null then
    select * into o from public.orders where id = p_id;
    delete from public.orders where id = p_id;
    get diagnostics cnt = row_count;
    if cnt > 0 then
      insert into public.admin_logs (event_type, title, detail, actor)
      values ('order_del', '🗑️ ลบประวัติการซื้อขาย: ' || coalesce(o.product_name->>'th', p_id::text),
              'จำนวน ' || coalesce(o.qty, 1) || ' ชิ้น (' || coalesce(o.total, 0) || ' ฿)', v_actor);
    end if;
  end if;
  return cnt;
end $$;

-- แอดมินลบประวัติการเติมเงิน (ลบทีละรายการ หรือล้างทั้งหมด)
create or replace function public.admin_delete_topup(p_id uuid default null, p_clear_all boolean default false)
returns int
language plpgsql security definer set search_path = public as $$
declare
  cnt     int := 0;
  v_actor text := public.current_actor_label();
  r       public.topups%rowtype;
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  if p_clear_all then
    delete from public.topups;
    get diagnostics cnt = row_count;
    insert into public.admin_logs (event_type, title, detail, actor)
    values ('topup_del', '🗑️ ล้างประวัติการเติมเงินทั้งหมด', 'ลบประวัติเติมเงินทั้งหมด ' || cnt || ' รายการ', v_actor);
  elsif p_id is not null then
    select * into r from public.topups where id = p_id;
    delete from public.topups where id = p_id;
    get diagnostics cnt = row_count;
    if cnt > 0 then
      insert into public.admin_logs (event_type, title, detail, actor)
      values ('topup_del', '🗑️ ลบประวัติการเติมเงิน (' || coalesce(r.amount, 0) || ' ฿)',
              'ช่องทาง: ' || coalesce(r.method, '-') || ' · สถานะเดิม: ' || coalesce(r.status, '-'), v_actor);
    end if;
  end if;
  return cnt;
end $$;

-- แอดมินลบประวัติการคุยของลูกค้า (ลบรายคน หรือล้างทั้งหมด หรือลบรายข้อความ)
drop function if exists public.admin_delete_chat(uuid, boolean);
drop function if exists public.admin_delete_chat(uuid, boolean, bigint);
create or replace function public.admin_delete_chat(p_user uuid default null, p_clear_all boolean default false, p_msg_id bigint default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  cnt     int := 0;
  v_actor text := public.current_actor_label();
  v_uname text := '';
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  if p_msg_id is not null then
    delete from public.support_chats where id = p_msg_id;
    get diagnostics cnt = row_count;
    insert into public.admin_logs (event_type, title, detail, actor)
    values ('chat_del', '🗑️ แอดมินลบข้อความแชท #' || p_msg_id, 'ลบข้อความแชทเดี่ยว', v_actor);
  elsif p_clear_all then
    delete from public.support_chats;
    get diagnostics cnt = row_count;
    insert into public.admin_logs (event_type, title, detail, actor)
    values ('chat_del', '🗑️ แอดมินล้างประวัติแชททั้งหมด', 'ลบข้อความแชททั้งหมด ' || cnt || ' ข้อความ', v_actor);
  elsif p_user is not null then
    select coalesce(username, p_user::text) into v_uname from public.profiles where id = p_user;
    delete from public.support_chats where user_id = p_user;
    get diagnostics cnt = row_count;
    insert into public.admin_logs (event_type, title, detail, actor)
    values ('chat_del', '🗑️ แอดมินลบประวัติแชทของ ' || coalesce(nullif(v_uname, ''), 'ลูกค้า'), 'ลบทั้งหมด ' || cnt || ' ข้อความ', v_actor);
  end if;
  return cnt;
end $$;

-- แอดมินลบบัญชีผู้ใช้ถาวร (ลบทั้งใน profiles และ auth.users) + แจ้งเตือน Discord พร้อมยอดเงินคงเหลือ
drop function if exists public.admin_delete_user(uuid);
create or replace function public.admin_delete_user(p_user uuid, p_reason text default '')
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  p       public.profiles%rowtype;
  v_actor text := public.current_actor_label();
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  if p_user is null then raise exception 'NOT_FOUND'; end if;
  select * into p from public.profiles where id = p_user;
  if not found then
    -- บัญชีค้างใน auth แต่ไม่มีโปรไฟล์ (เช่น สมัครไม่สำเร็จ) ก็ลบทิ้งได้
    perform public.detach_user_storage(p_user);
    delete from auth.users where id = p_user;
    if not found then raise exception 'NOT_FOUND'; end if;
    return true;
  end if;
  perform public.detach_user_storage(p_user);
  insert into public.admin_logs (event_type, title, detail, actor)
  values ('user_del', '🗑️ ลบบัญชีผู้ใช้: ' || p.username,
          'ยอดเงินคงเหลือเดิม: ' || p.balance || ' ฿' || case when btrim(coalesce(p_reason, '')) <> '' then ' · เหตุผล: ' || left(btrim(p_reason), 300) else '' end,
          v_actor);
  perform set_config('shark.event', 'delete', true);
  perform set_config('shark.reason', left(btrim(coalesce(p_reason, '')), 300), true);
  delete from public.profiles where id = p_user;
  delete from auth.users where id = p_user;
  return true;
end $$;

-- แอดมินลบบัญชีผู้ใช้ด้วยชื่อผู้ใช้ (สำหรับบอท Discord และหน้าเว็บ)
drop function if exists public.admin_delete_by_username(text);
create or replace function public.admin_delete_by_username(p_username text, p_reason text default '')
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid;
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  select id into v_uid from public.profiles where lower(username) = lower(btrim(coalesce(p_username, '')));
  if v_uid is null then raise exception 'NOT_FOUND'; end if;
  return public.admin_delete_user(v_uid, p_reason);
end $$;

drop function if exists public.admin_set_user(uuid, boolean, boolean);
create or replace function public.admin_set_user(p_user uuid, p_is_admin boolean default null, p_banned boolean default null, p_reason text default null)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare p public.profiles%rowtype;
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  if p_user = auth.uid() and (p_is_admin = false or p_banned = true) then raise exception 'NOT_SELF'; end if;
  if p_reason is not null then perform set_config('shark.reason', left(btrim(p_reason), 300), true); end if;
  update public.profiles set is_admin = coalesce(p_is_admin, is_admin), banned = coalesce(p_banned, banned)
   where id = p_user returning * into p;
  if not found then raise exception 'NOT_FOUND'; end if;
  return p;
end $$;

-- ตั้ง/ปลดแอดมินเว็บ หรือ ระงับผู้ใช้ ด้วยชื่อผู้ใช้ (สำหรับบอท Discord และหน้าเว็บแอดมิน)
drop function if exists public.admin_set_by_username(text, boolean, boolean);
create or replace function public.admin_set_by_username(p_username text, p_is_admin boolean default null, p_banned boolean default null, p_reason text default null)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid;
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  select id into v_uid from public.profiles where lower(username) = lower(btrim(coalesce(p_username, '')));
  if v_uid is null then raise exception 'NOT_FOUND'; end if;
  return public.admin_set_user(v_uid, p_is_admin, p_banned, p_reason);
end $$;

-- ระบุชื่อผู้ทำรายการ (หน้าเว็บ หรือ บอท Discord)
create or replace function public.current_actor_label() returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_uname text;
begin
  if v_uid is not null then
    select username into v_uname from public.profiles where id = v_uid;
    return 'เว็บ (' || coalesce(v_uname, substr(v_uid::text, 1, 8)) || ')';
  end if;
  if coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), current_setting('request.jwt.claim.role', true), '') = 'service_role' then
    return 'Discord Bot';
  end if;
  return 'ระบบ / Supabase Dashboard';
end $$;

-- บันทึกแจ้งเตือนและ Log การกระทำทุกอย่างอัตโนมัติ
create or replace function public.log_admin_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := public.current_actor_label();
  v_uname text;
begin
  if tg_table_name = 'products' then
    if tg_op = 'INSERT' then
      insert into public.admin_logs (event_type, title, detail, actor)
      values ('product_add', '➕ เพิ่มสินค้าใหม่: ' || new.name_th,
              'ราคา ' || new.price || ' ฿ · วิธีส่ง: ' ||
              case when new.delivery = 'code' then
                case when new.credential_type = 'user_pass' then 'บัญชีอัตโนมัติ (ชื่อ+รหัส)' else 'บัญชีอัตโนมัติ (อีเมล+รหัส)' end
              else 'แอดมินส่งเอง' end, v_actor);
    elsif tg_op = 'UPDATE' then
      if old.stock <> 0 and new.stock = 0 then
        insert into public.admin_logs (event_type, title, detail, actor)
        values ('product_out', '🔴 สินค้าหมด: ' || new.name_th, 'สินค้าถูกตั้งสถานะเป็นสินค้าหมด (Out of Stock)', v_actor);
      elsif (old.stock is distinct from new.stock and old.sold = new.sold) or (old.active is distinct from new.active) then
        insert into public.admin_logs (event_type, title, detail, actor)
        values ('product_stock', '📦 อัปเดตสต็อก/สถานะ: ' || new.name_th,
                'สต็อก: ' || case when new.stock < 0 then 'ไม่จำกัด' else new.stock::text end || ' · สถานะ: ' || case when new.active then 'เปิดขาย' else 'ปิดซ่อน' end, v_actor);
      elsif old.images is distinct from new.images then
        insert into public.admin_logs (event_type, title, detail, actor)
        values ('product_image', '🖼️ อัปเดตรูปตัวอย่าง: ' || new.name_th,
                'มีรูปตัวอย่างทั้งหมด ' || coalesce(array_length(new.images, 1), 0) || ' รูป', v_actor);
      elsif old.name_th is distinct from new.name_th or old.price is distinct from new.price or old.desc_th is distinct from new.desc_th or old.credential_type is distinct from new.credential_type then
        insert into public.admin_logs (event_type, title, detail, actor)
        values ('product_edit', '✏️ แก้ไขสินค้า: ' || new.name_th, 'ราคา ' || new.price || ' ฿', v_actor);
      end if;
    elsif tg_op = 'DELETE' then
      insert into public.admin_logs (event_type, title, detail, actor)
      values ('product_del', '🗑️ ลบสินค้า: ' || old.name_th, 'ราคาเดิม ' || old.price || ' ฿', v_actor);
    end if;

  elsif tg_table_name = 'categories' then
    if tg_op = 'INSERT' then
      insert into public.admin_logs (event_type, title, detail, actor)
      values ('cat_add', '🗂️ เพิ่มหมวดหมู่ใหม่: ' || new.name_th, 'ลิงก์หมวด: ' || new.slug, v_actor);
    elsif tg_op = 'UPDATE' then
      insert into public.admin_logs (event_type, title, detail, actor)
      values ('cat_edit', '✏️ แก้ไขหมวดหมู่: ' || new.name_th, 'ลิงก์หมวด: ' || new.slug, v_actor);
    elsif tg_op = 'DELETE' then
      insert into public.admin_logs (event_type, title, detail, actor)
      values ('cat_del', '🗑️ ลบหมวดหมู่: ' || old.name_th, 'ลิงก์หมวด: ' || old.slug, v_actor);
    end if;

  elsif tg_table_name = 'profiles' and tg_op = 'UPDATE' then
    if old.is_admin is distinct from new.is_admin then
      insert into public.admin_logs (event_type, title, detail, actor)
      values ('admin_role',
              case when new.is_admin then '👑 ตั้งแอดมินเว็บ: ' else '👑 ถอดแอดมินเว็บ: ' end || new.username,
              'สิทธิ์แอดมินหน้าร้านถูกเปลี่ยนเป็น ' || case when new.is_admin then 'ADMIN' else 'สมาชิกทั่วไป' end, v_actor);
    end if;
    if old.banned is distinct from new.banned then
      insert into public.admin_logs (event_type, title, detail, actor)
      values ('user_ban',
              case when new.banned then '🚫 ระงับผู้ใช้: ' else '🟢 ปลดระงับผู้ใช้: ' end || new.username,
              'สถานะบัญชี: ' || case when new.banned then 'ถูกระงับ' else 'ปกติ' end ||
              ' · ยอดเงินคงเหลือ: ' || new.balance || ' ฿' ||
              case when new.banned and coalesce(new.ban_reason, '') <> '' then ' · เหตุผล: ' || new.ban_reason else '' end, v_actor);
    end if;

  elsif tg_table_name = 'bot_admins' then
    if tg_op = 'INSERT' then
      insert into public.admin_logs (event_type, title, detail, actor)
      values ('bot_admin', '🤖 เพิ่มแอดมินบอท Discord',
              'Discord ID: ' || new.discord_id || case when new.label <> '' then ' (' || new.label || ')' else '' end, v_actor);
    elsif tg_op = 'DELETE' then
      insert into public.admin_logs (event_type, title, detail, actor)
      values ('bot_admin', '🤖 ถอดแอดมินบอท Discord',
              'Discord ID: ' || old.discord_id || case when old.label <> '' then ' (' || old.label || ')' else '' end, v_actor);
    end if;

  elsif tg_table_name = 'topups' then
    if tg_op = 'INSERT' and new.method = 'admin' then
      insert into public.admin_logs (event_type, title, detail, actor)
      values ('balance_adj', '💰 ปรับยอดเงินสมาชิก (' || case when new.amount >= 0 then '+' else '' end || new.amount || ' ฿)',
              coalesce(nullif(new.note, ''), 'ปรับยอดโดยแอดมิน'), v_actor);
    elsif tg_op = 'INSERT' and new.method <> 'admin' then
      select username into v_uname from public.profiles where id = new.user_id;
      insert into public.admin_logs (event_type, title, detail, actor)
      values ('topup_new', '💳 แจ้งเติมเงินใหม่: ' || new.amount || ' ฿',
              'ผู้ใช้: ' || coalesce(v_uname, '-') || ' · ช่องทาง: ' || new.method ||
              case when coalesce(new.game_uid, '') <> '' then ' · UID: ' || new.game_uid else '' end, v_actor);
    elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status in ('approved', 'rejected') then
      insert into public.admin_logs (event_type, title, detail, actor)
      values ('topup_review',
              case when new.status = 'approved' then '✅ อนุมัติเติมเงิน ' else '❌ ปฏิเสธเติมเงิน ' end || new.amount || ' ฿',
              'UID: ' || coalesce(nullif(new.game_uid, ''), '-') || ' · ช่องทาง: ' || new.method || case when coalesce(new.note, '') <> '' then ' · ' || new.note else '' end, v_actor);
    end if;

  elsif tg_table_name = 'orders' then
    if tg_op = 'INSERT' then
      select username into v_uname from public.profiles where id = new.user_id;
      insert into public.admin_logs (event_type, title, detail, actor)
      values ('order_new', '🛒 สั่งซื้อสินค้า: ' || coalesce(new.product_name->>'th', '-'),
              'ผู้ซื้อ: ' || coalesce(v_uname, '-') || ' · จำนวน ' || new.qty || ' ชิ้น (' || new.total || ' ฿)' ||
              case when coalesce(new.customer_input, '') <> '' then ' · ข้อมูล/UID: ' || new.customer_input else '' end, v_actor);
    elsif tg_op = 'UPDATE' then
      if old.status is distinct from new.status and new.status in ('done', 'cancelled') then
        insert into public.admin_logs (event_type, title, detail, actor)
        values ('order_review',
                case when new.status = 'done' then '📨 ส่งออเดอร์แล้ว: ' else '↩️ ยกเลิก/คืนเงินออเดอร์: ' end || coalesce(new.product_name->>'th', '-'),
                'จำนวน ' || new.qty || ' ชิ้น (' || new.total || ' ฿)', v_actor);
      end if;
    end if;

  elsif tg_table_name = 'support_chats' and tg_op = 'INSERT' then
    if new.sender = 'user' and new.channel = 'admin' then
      insert into public.admin_logs (event_type, title, detail, actor)
      values ('chat_new', '💬 ลูกค้าทักแชทแอดมิน: ' || coalesce(nullif(new.username, ''), 'ลูกค้า'),
              left(new.message, 200), 'เว็บ (' || coalesce(nullif(new.username, ''), 'ลูกค้า') || ')');
    end if;
  end if;
  return null;
end $$;

create or replace function public.log_codes_added() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_rec record;
  v_actor text := public.current_actor_label();
begin
  for v_rec in
    select n.product_id, count(*)::int as cnt, coalesce(p.name_th, 'สินค้า') as pname
      from new_rows n
      left join public.products p on p.id = n.product_id
     group by n.product_id, p.name_th
  loop
    insert into public.admin_logs (event_type, title, detail, actor)
    values ('code_add', '➕ เติมบัญชี/รหัสเข้าสต็อก: ' || v_rec.pname, 'เพิ่มสต็อกใหม่ +' || v_rec.cnt || ' บัญชี', v_actor);
  end loop;
  return null;
end $$;

drop trigger if exists trg_log_products   on public.products;
drop trigger if exists trg_log_categories on public.categories;
drop trigger if exists trg_log_profiles   on public.profiles;
drop trigger if exists trg_log_bot_admins on public.bot_admins;
drop trigger if exists trg_log_topups     on public.topups;
drop trigger if exists trg_log_orders     on public.orders;
drop trigger if exists trg_log_codes      on public.product_codes;
drop trigger if exists trg_log_chats      on public.support_chats;

create trigger trg_log_products   after insert or update or delete on public.products      for each row execute function public.log_admin_event();
create trigger trg_log_categories after insert or update or delete on public.categories    for each row execute function public.log_admin_event();
create trigger trg_log_profiles   after update                     on public.profiles      for each row execute function public.log_admin_event();
create trigger trg_log_bot_admins after insert or delete           on public.bot_admins    for each row execute function public.log_admin_event();
create trigger trg_log_topups     after insert or update           on public.topups        for each row execute function public.log_admin_event();
create trigger trg_log_orders     after insert or update           on public.orders        for each row execute function public.log_admin_event();
create trigger trg_log_chats      after insert                     on public.support_chats for each row execute function public.log_admin_event();
create trigger trg_log_codes      after insert                     on public.product_codes referencing new table as new_rows for each statement execute function public.log_codes_added();

-- =====================================================================
-- 4.5) แจ้งเตือน Discord เมื่อบัญชีโดนระงับ / ปลดระงับ / ถูกลบ
--      (บันทึก snapshot ยอดเงินและข้อมูลทั้งหมดก่อนลบ -> บอทโพสต์ทันที + Webhook ยิงตรงถ้าตั้งไว้)
-- =====================================================================

-- ปลดความเป็นเจ้าของไฟล์ใน storage ก่อนลบผู้ใช้ (โปรเจกต์รุ่นเก่ามี FK owner -> auth.users ทำให้ลบบัญชีไม่ผ่าน)
create or replace function public.detach_user_storage(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  begin
    update storage.objects set owner = null where owner = p_user;
  exception when others then null;
  end;
  begin
    execute 'update storage.objects set owner_id = null where owner_id = $1' using p_user::text;
  exception when others then null;
  end;
end $$;

-- รวบรวมข้อมูลสำคัญทั้งหมดของบัญชี ณ ตอนนี้ (ยอดเงิน, ยอดเติม, ยอดซื้อ, รายการค้าง ฯลฯ)
create or replace function public.account_snapshot(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  p       public.profiles%rowtype;
  v_email text;
  v_last  timestamptz;
begin
  select * into p from public.profiles where id = p_user;
  if not found then return '{}'::jsonb; end if;
  select u.email::text, u.last_sign_in_at into v_email, v_last from auth.users u where u.id = p_user;
  return jsonb_build_object(
    'user_id',             p.id,
    'username',            p.username,
    'discord_id',          coalesce(p.discord_id, ''),
    'discord_username',    coalesce(p.discord_username, ''),
    'discord_avatar',      coalesce(p.discord_avatar, ''),
    'email',               coalesce(v_email, ''),
    'balance',             p.balance,
    'is_admin',            p.is_admin,
    'banned',              p.banned,
    'ban_reason',          p.ban_reason,
    'banned_at',           p.banned_at,
    'created_at',          p.created_at,
    'last_sign_in_at',     v_last,
    'topup_total',         (select coalesce(sum(amount), 0) from public.topups where user_id = p_user and status = 'approved' and method <> 'admin'),
    'topup_count',         (select count(*)                 from public.topups where user_id = p_user and status = 'approved' and method <> 'admin'),
    'admin_adjust_total',  (select coalesce(sum(amount), 0) from public.topups where user_id = p_user and method = 'admin'),
    'pending_topup_count', (select count(*)                 from public.topups where user_id = p_user and status = 'pending'),
    'pending_topup_sum',   (select coalesce(sum(amount), 0) from public.topups where user_id = p_user and status = 'pending'),
    'spent_total',         (select coalesce(sum(total), 0)  from public.orders where user_id = p_user and status <> 'cancelled'),
    'order_count',         (select count(*)                 from public.orders where user_id = p_user and status <> 'cancelled'),
    'pending_order_count', (select count(*)                 from public.orders where user_id = p_user and status = 'pending'),
    'pending_order_sum',   (select coalesce(sum(total), 0)  from public.orders where user_id = p_user and status = 'pending'),
    'last_order',          (select jsonb_build_object('name', product_name ->> 'th', 'qty', qty, 'total', total, 'status', status, 'input', customer_input, 'at', created_at)
                              from public.orders where user_id = p_user order by created_at desc limit 1),
    'last_topup',          (select jsonb_build_object('amount', amount, 'method', method, 'status', status, 'at', created_at)
                              from public.topups where user_id = p_user and method <> 'admin' order by created_at desc limit 1)
  );
end $$;

create or replace function public.discord_field(p_name text, p_value text, p_inline boolean default true) returns jsonb
language sql immutable as $$
  select jsonb_build_object('name', left(p_name, 250), 'value', left(coalesce(nullif(btrim(p_value), ''), '-'), 1000), 'inline', p_inline);
$$;

create or replace function public.fmt_baht(n numeric) returns text
language sql stable as $$ select to_char(coalesce(n, 0), 'FM999,999,999,990.00') || ' ฿' $$;

create or replace function public.fmt_th_time(ts timestamptz) returns text
language sql stable as $$ select case when ts is null then '-' else to_char(ts at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI') end $$;

-- ยิงแจ้งเตือนเข้า Discord Webhook โดยตรงจากฐานข้อมูล (ต้องเปิด pg_net + ตั้ง discord_webhook_url ในหลังร้าน)
create or replace function public.send_account_alert_webhook(p_id bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  a       public.account_alerts%rowtype;
  s       jsonb;
  v_url   text;
  v_title text;
  v_color int;
  v_body  jsonb;
begin
  select value into v_url from public.app_settings where key = 'discord_webhook_url';
  if coalesce(v_url, '') !~ '^https://(canary\.|ptb\.)?(discord\.com|discordapp\.com)/api/webhooks/' then return false; end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then return false; end if;
  select * into a from public.account_alerts where id = p_id;
  if not found then return false; end if;
  s := a.snapshot;

  v_title := case a.event when 'ban' then '🚫 บัญชีถูกระงับ' when 'unban' then '🟢 ปลดระงับบัญชี'
                          when 'self_delete' then '🗑️ สมาชิกลบบัญชีตัวเอง' else '🗑️ บัญชีถูกลบโดยแอดมิน' end || ': ' || a.username;
  v_color := case a.event when 'unban' then 4123018 when 'ban' then 16752451 else 16735324 end;

  v_body := jsonb_build_object(
    'username', 'SHARK Shop Alerts',
    'content', case when a.event = 'unban' then '' else '⚠️ **แจ้งเตือนบัญชี** — ยอดเงินคงเหลือ **' || public.fmt_baht(a.balance) || '**' end,
    'embeds', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'title', left(v_title, 250),
      'color', v_color,
      'description', case when a.reason <> '' then '**เหตุผล:** ' || left(a.reason, 1500) else null end,
      'fields', jsonb_build_array(
        public.discord_field('👤 ชื่อผู้ใช้', a.username),
        public.discord_field('📧 อีเมล', a.email),
        public.discord_field('💰 ยอดเงินปัจจุบัน', public.fmt_baht(a.balance)),
        public.discord_field('💳 เติมเงินสะสม', public.fmt_baht((s ->> 'topup_total')::numeric) || ' (' || coalesce(s ->> 'topup_count', '0') || ' ครั้ง)'),
        public.discord_field('🛒 ยอดซื้อสะสม', public.fmt_baht((s ->> 'spent_total')::numeric) || ' (' || coalesce(s ->> 'order_count', '0') || ' ออเดอร์)'),
        public.discord_field('🛠️ แอดมินปรับยอด', public.fmt_baht((s ->> 'admin_adjust_total')::numeric)),
        public.discord_field('⏳ เติมเงินรอตรวจ', coalesce(s ->> 'pending_topup_count', '0') || ' รายการ (' || public.fmt_baht((s ->> 'pending_topup_sum')::numeric) || ')'),
        public.discord_field('📦 ออเดอร์รอส่ง', coalesce(s ->> 'pending_order_count', '0') || ' รายการ (' || public.fmt_baht((s ->> 'pending_order_sum')::numeric) || ')'),
        public.discord_field('👑 สิทธิ์', case when (s ->> 'is_admin')::boolean then 'แอดมินเว็บ' else 'สมาชิกทั่วไป' end),
        public.discord_field('📅 สมัครเมื่อ', public.fmt_th_time((s ->> 'created_at')::timestamptz)),
        public.discord_field('🕒 เข้าสู่ระบบล่าสุด', public.fmt_th_time((s ->> 'last_sign_in_at')::timestamptz)),
        public.discord_field('🆔 User ID', '`' || coalesce(a.user_id::text, '-') || '`', false)
      ),
      'footer', jsonb_build_object('text', 'โดย ' || coalesce(nullif(a.actor, ''), 'ระบบ') || ' • Alert #' || a.id),
      'timestamp', to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )))
  );

  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using v_url, v_body, '{"Content-Type":"application/json"}'::jsonb;
  update public.account_alerts set webhook_sent = true where id = p_id;
  return true;
exception when others then
  return false;
end $$;

-- สร้างรายการแจ้งเตือน (เรียกจาก trigger ด้านล่าง)
create or replace function public.raise_account_alert(p_event text, p_user uuid, p_reason text default '') returns bigint
language plpgsql security definer set search_path = public as $$
declare
  snap    jsonb := public.account_snapshot(p_user);
  v_id    bigint;
begin
  if snap = '{}'::jsonb then return null; end if;
  insert into public.account_alerts (event, user_id, username, email, balance, reason, actor, snapshot)
  values (p_event, p_user, coalesce(snap ->> 'username', ''), coalesce(snap ->> 'email', ''),
          coalesce((snap ->> 'balance')::numeric, 0), left(coalesce(p_reason, ''), 300),
          public.current_actor_label(), snap)
  returning id into v_id;
  perform public.send_account_alert_webhook(v_id);
  return v_id;
end $$;

-- ก่อนอัปเดตโปรไฟล์: บันทึกเวลา/เหตุผลที่ระงับ
create or replace function public.profiles_ban_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.banned and not old.banned then
    new.banned_at  := now();
    new.ban_reason := left(coalesce(nullif(current_setting('shark.reason', true), ''), nullif(btrim(new.ban_reason), ''), ''), 300);
  elsif old.banned and not new.banned then
    new.banned_at  := null;
    new.ban_reason := '';
  end if;
  return new;
end $$;

-- หลังระงับ/ปลดระงับ: แจ้ง Discord
create or replace function public.profiles_ban_alert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.banned is distinct from new.banned then
    perform public.raise_account_alert(case when new.banned then 'ban' else 'unban' end, new.id,
      case when new.banned then new.ban_reason else coalesce(current_setting('shark.reason', true), '') end);
  end if;
  return null;
end $$;

-- ก่อนลบโปรไฟล์ (ทุกช่องทาง: หลังร้าน, บอท, ลูกค้าลบเอง, ลบจาก Supabase Dashboard): เก็บ snapshot + แจ้ง Discord
create or replace function public.profiles_delete_alert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.raise_account_alert(
    coalesce(nullif(current_setting('shark.event', true), ''), 'delete'), old.id,
    coalesce(current_setting('shark.reason', true), ''));
  return old;
end $$;

drop trigger if exists trg_profiles_ban_stamp   on public.profiles;
drop trigger if exists trg_profiles_ban_alert   on public.profiles;
drop trigger if exists trg_profiles_del_alert   on public.profiles;
create trigger trg_profiles_ban_stamp before update of banned on public.profiles for each row execute function public.profiles_ban_stamp();
create trigger trg_profiles_ban_alert after  update of banned on public.profiles for each row execute function public.profiles_ban_alert();
create trigger trg_profiles_del_alert before delete           on public.profiles for each row execute function public.profiles_delete_alert();

-- ทดสอบ Webhook จากหน้าหลังร้าน
create or replace function public.admin_test_discord_webhook() returns boolean
language plpgsql security definer set search_path = public as $$
declare v_url text;
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then raise exception 'NO_PG_NET'; end if;
  select value into v_url from public.app_settings where key = 'discord_webhook_url';
  if coalesce(v_url, '') !~ '^https://(canary\.|ptb\.)?(discord\.com|discordapp\.com)/api/webhooks/' then raise exception 'BAD_WEBHOOK'; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using v_url,
          jsonb_build_object('username', 'SHARK Shop Alerts',
            'content', '✅ ทดสอบการเชื่อมต่อจากหลังร้าน SHARK Shop สำเร็จ — แจ้งเตือนบัญชีโดนระงับ/ลบจะเข้าห้องนี้ (โดย ' || public.current_actor_label() || ')'),
          '{"Content-Type":"application/json"}'::jsonb;
  return true;
end $$;

-- ส่งแจ้งเตือนซ้ำ (บอทจะโพสต์ใหม่ + ยิง Webhook อีกครั้ง)
create or replace function public.admin_resend_alert(p_id bigint) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  update public.account_alerts set notified = false, notified_at = null where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform public.send_account_alert_webhook(p_id);
  return true;
end $$;

-- รายชื่อผู้ใช้ + อีเมล + บัญชี Discord (เฉพาะแอดมิน)
drop function if exists public.admin_users(text, int);
create or replace function public.admin_users(p_q text default '', p_limit int default 50)
returns table (id uuid, username text, email text, balance numeric, is_admin boolean, banned boolean, ban_reason text, banned_at timestamptz, created_at timestamptz, last_sign_in_at timestamptz, discord_username text, discord_id text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  return query
    select p.id, p.username, u.email::text, p.balance, p.is_admin, p.banned, p.ban_reason, p.banned_at, p.created_at, u.last_sign_in_at, p.discord_username, p.discord_id
      from public.profiles p join auth.users u on u.id = p.id
     where coalesce(p_q, '') = ''
        or p.username ilike '%' || p_q || '%'
        or u.email ilike '%' || p_q || '%'
        or p.discord_username ilike '%' || p_q || '%'
        or p.discord_id ilike '%' || p_q || '%'
     order by p.created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 500);
end $$;

-- สรุปยอดหน้าแดชบอร์ด (คำนวณยอดขายโดยยึดตามจุดรีเซ็ตล่าสุดถ้ามี)
create or replace function public.admin_stats()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  res        jsonb;
  v_reset_at timestamptz;
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  select nullif(value, '')::timestamptz into v_reset_at from public.app_settings where key = 'sales_reset_at';
  v_reset_at := coalesce(v_reset_at, '2000-01-01'::timestamptz);

  select jsonb_build_object(
    'users',           (select count(*) from public.profiles),
    'pending_topups',  (select count(*) from public.topups where status = 'pending'),
    'pending_orders',  (select count(*) from public.orders where status = 'pending'),
    'sales_today',     (select coalesce(sum(total), 0) from public.orders where status <> 'cancelled' and created_at >= greatest(v_reset_at, date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok')),
    'sales_30d',       (select coalesce(sum(total), 0) from public.orders where status <> 'cancelled' and created_at >= greatest(v_reset_at, now() - interval '30 days')),
    'topup_30d',       (select coalesce(sum(amount), 0) from public.topups where status = 'approved' and method <> 'admin' and created_at >= now() - interval '30 days'),
    'balance_total',   (select coalesce(sum(balance), 0) from public.profiles),
    'sales_reset_at',  (select value from public.app_settings where key = 'sales_reset_at'),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'v', v) order by d), '[]'::jsonb) from (
                select to_char(g.d, 'YYYY-MM-DD') as d,
                       coalesce((select sum(total) from public.orders o
                                  where o.status <> 'cancelled'
                                    and o.created_at >= v_reset_at
                                    and (o.created_at at time zone 'Asia/Bangkok')::date = g.d::date), 0) as v
                  from generate_series(((now() at time zone 'Asia/Bangkok')::date - 13)::timestamp,
                                       ((now() at time zone 'Asia/Bangkok')::date)::timestamp, interval '1 day') as g(d)
             ) x)
  ) into res;
  return res;
end $$;

-- แอดมินรีเซ็ตยอดขายทั้งหมด (รีเซ็ตตัวเลขขายแล้วของสินค้า + รีเซ็ตสถิติยอดขายเป็น 0 + ล้างออเดอร์เดิม)
create or replace function public.admin_reset_sales(p_clear_orders boolean default true, p_reset_product_sold boolean default true)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_orders_cnt int := 0;
  v_prods_cnt  int := 0;
  v_actor      text := public.current_actor_label();
  v_now        timestamptz := now();
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;

  -- บันทึกจุดเวลาที่รีเซ็ตยอดขายลง app_settings เพื่อให้สถิติคำนวณใหม่เริ่มจาก 0 ฿ ทันที
  insert into public.app_settings (key, value, updated_at)
  values ('sales_reset_at', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), v_now)
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  -- รีเซ็ตตัวนับ "ขายแล้ว" ของสินค้าทุกชิ้นในร้านเป็น 0
  if p_reset_product_sold then
    update public.products set sold = 0;
    get diagnostics v_prods_cnt = row_count;
  end if;

  -- ล้างประวัติออเดอร์ (ถ้าเลือก)
  if p_clear_orders then
    delete from public.orders;
    get diagnostics v_orders_cnt = row_count;
  end if;

  insert into public.admin_logs (event_type, title, detail, actor)
  values ('sales_reset', '🔄 รีเซ็ตยอดขายทั้งหมด',
          'รีเซ็ตยอดขายในระบบเป็น 0 ฿' ||
          case when p_reset_product_sold then ' · รีเซ็ตยอดขายสินค้า ' || v_prods_cnt || ' รายการ' else '' end ||
          case when p_clear_orders then ' · ล้างประวัติออเดอร์ ' || v_orders_cnt || ' รายการ' else '' end,
          v_actor);

  return jsonb_build_object(
    'success', true,
    'orders_cleared', v_orders_cnt,
    'products_reset', v_prods_cnt,
    'reset_at', v_now
  );
end $$;

-- ฟังก์ชันดึงสถานะเซิร์ฟเวอร์ & แอดมินออนไลน์สำหรับหน้าเว็บ (เรียกได้ทั้งผู้ใช้ทั่วไปและแอดมิน)
create or replace function public.get_server_status()
returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(nullif(value, '')::jsonb, '{"admin_online":false,"admins":{"online":0},"players":{"online":0,"offline":0},"members":{"online":0,"offline":0,"total":0}}'::jsonb)
  from public.app_settings
  where key = 'server_status';
$$;

-- =====================================================================
-- 5) สิทธิ์ (Row Level Security)
-- =====================================================================
alter table public.profiles      enable row level security;
alter table public.categories    enable row level security;
alter table public.products      enable row level security;
alter table public.product_codes enable row level security;
alter table public.orders        enable row level security;
alter table public.topups        enable row level security;
alter table public.bot_admins    enable row level security;
alter table public.admin_logs    enable row level security;
alter table public.support_chats enable row level security;
alter table public.account_alerts enable row level security;
alter table public.app_settings   enable row level security;
alter table public.announcements  enable row level security;

drop policy if exists "account_alerts admin" on public.account_alerts;
create policy "account_alerts admin" on public.account_alerts for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "app_settings admin"   on public.app_settings;
drop policy if exists "app_settings read public" on public.app_settings;
create policy "app_settings admin"   on public.app_settings   for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "app_settings read public" on public.app_settings for select to anon, authenticated using (key in ('server_status', 'announcements'));
revoke all on public.account_alerts, public.app_settings from anon;
grant select on public.app_settings to anon, authenticated;

-- สิทธิ์ระบบประกาศ (Announcements): บุคคลทั่วไปอ่านประกาศที่เปิดใช้งานได้, แอดมินจัดการได้ทั้งหมด
drop policy if exists "announcements read" on public.announcements;
create policy "announcements read" on public.announcements for select to anon, authenticated using (true);
drop policy if exists "announcements admin" on public.announcements;
create policy "announcements admin" on public.announcements for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
grant select on public.announcements to anon, authenticated;
grant all on public.announcements to authenticated;

drop policy if exists "profiles read own"    on public.profiles;
drop policy if exists "profiles admin del"   on public.profiles;
create policy "profiles read own"    on public.profiles for select to authenticated using (id = (select auth.uid()) or (select public.is_admin()));
create policy "profiles admin del"   on public.profiles for delete to authenticated using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "categories read"      on public.categories;
drop policy if exists "categories anon read" on public.categories;
drop policy if exists "categories auth read" on public.categories;
drop policy if exists "categories admin"     on public.categories;
drop policy if exists "categories insert"    on public.categories;
drop policy if exists "categories update"    on public.categories;
drop policy if exists "categories delete"    on public.categories;
create policy "categories anon read" on public.categories for select to anon using (active);
create policy "categories auth read" on public.categories for select to authenticated using (active or (select public.is_admin()));
create policy "categories insert"    on public.categories for insert to authenticated with check ((select public.is_admin()));
create policy "categories update"    on public.categories for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "categories delete"    on public.categories for delete to authenticated using ((select public.is_admin()));

drop policy if exists "products read"        on public.products;
drop policy if exists "products anon read"   on public.products;
drop policy if exists "products auth read"   on public.products;
drop policy if exists "products admin"       on public.products;
drop policy if exists "products insert"      on public.products;
drop policy if exists "products update"      on public.products;
drop policy if exists "products delete"      on public.products;
create policy "products anon read"   on public.products for select to anon using (active);
create policy "products auth read"   on public.products for select to authenticated using (active or (select public.is_admin()));
create policy "products insert"      on public.products for insert to authenticated with check ((select public.is_admin()));
create policy "products update"      on public.products for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "products delete"      on public.products for delete to authenticated using ((select public.is_admin()));

drop policy if exists "codes admin"          on public.product_codes;
create policy "codes admin"          on public.product_codes for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "orders read own"      on public.orders;
drop policy if exists "orders admin delete"  on public.orders;
create policy "orders read own"      on public.orders for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "orders admin delete"  on public.orders for delete to authenticated using ((select public.is_admin()));

drop policy if exists "topups read own"      on public.topups;
drop policy if exists "topups admin delete"  on public.topups;
create policy "topups read own"      on public.topups for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "topups admin delete"  on public.topups for delete to authenticated using ((select public.is_admin()));

drop policy if exists "bot_admins admin"     on public.bot_admins;
create policy "bot_admins admin"     on public.bot_admins for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "admin_logs admin"     on public.admin_logs;
create policy "admin_logs admin"     on public.admin_logs for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "support_chats anon read"   on public.support_chats;
drop policy if exists "support_chats anon insert" on public.support_chats;
drop policy if exists "support_chats anon delete" on public.support_chats;
drop policy if exists "support_chats read"        on public.support_chats;
drop policy if exists "support_chats insert"      on public.support_chats;
drop policy if exists "support_chats update"      on public.support_chats;
drop policy if exists "support_chats delete"      on public.support_chats;
create policy "support_chats anon read" on public.support_chats for select to anon
  using (channel = 'ai' and session_id <> '');
create policy "support_chats anon insert" on public.support_chats for insert to anon
  with check (channel = 'ai' and sender = 'user' and user_id is null and char_length(session_id) >= 6);
create policy "support_chats anon delete" on public.support_chats for delete to anon
  using (channel = 'ai' and session_id <> '');
create policy "support_chats read"   on public.support_chats for select to authenticated
  using (user_id = (select auth.uid()) or (channel = 'ai' and session_id <> '') or (select public.is_admin()));
create policy "support_chats insert" on public.support_chats for insert to authenticated
  with check ((user_id = (select auth.uid()) and sender in ('user','ai')) or (select public.is_admin()));
create policy "support_chats update" on public.support_chats for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "support_chats delete" on public.support_chats for delete to authenticated
  using (user_id = (select auth.uid()) or (channel = 'ai' and session_id <> '') or (select public.is_admin()));

-- สิทธิ์ระบบ Ticket
alter table public.tickets enable row level security;
alter table public.ticket_messages enable row level security;

drop policy if exists "tickets select" on public.tickets;
create policy "tickets select" on public.tickets for select to anon, authenticated
  using (
    user_id = (select auth.uid())
    or (select public.is_admin())
    or (discord_user_id <> '' and discord_user_id = (select p.discord_id from public.profiles p where p.id = (select auth.uid())))
  );

drop policy if exists "tickets insert" on public.tickets;
create policy "tickets insert" on public.tickets for insert to authenticated
  with check (
    user_id = (select auth.uid())
    or (select public.is_admin())
  );

drop policy if exists "tickets update" on public.tickets;
create policy "tickets update" on public.tickets for update to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.is_admin())
    or (discord_user_id <> '' and discord_user_id = (select p.discord_id from public.profiles p where p.id = (select auth.uid())))
  );

drop policy if exists "tickets delete" on public.tickets;
create policy "tickets delete" on public.tickets for delete to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.is_admin())
    or (discord_user_id <> '' and discord_user_id = (select p.discord_id from public.profiles p where p.id = (select auth.uid())))
  );

drop policy if exists "ticket_messages select" on public.ticket_messages;
create policy "ticket_messages select" on public.ticket_messages for select to anon, authenticated
  using (
    exists (
      select 1 from public.tickets t
       where t.id = ticket_id
         and (
           t.user_id = (select auth.uid())
           or (select public.is_admin())
           or (t.discord_user_id <> '' and t.discord_user_id = (select p.discord_id from public.profiles p where p.id = (select auth.uid())))
         )
    )
  );

drop policy if exists "ticket_messages insert" on public.ticket_messages;
create policy "ticket_messages insert" on public.ticket_messages for insert to authenticated
  with check (
    exists (
      select 1 from public.tickets t
       where t.id = ticket_id
         and (
           t.user_id = (select auth.uid())
           or (select public.is_admin())
           or (t.discord_user_id <> '' and t.discord_user_id = (select p.discord_id from public.profiles p where p.id = (select auth.uid())))
         )
    )
  );

drop policy if exists "ticket_messages delete" on public.ticket_messages;
create policy "ticket_messages delete" on public.ticket_messages for delete to authenticated
  using (
    exists (
      select 1 from public.tickets t
       where t.id = ticket_id
         and (
           t.user_id = (select auth.uid())
           or (select public.is_admin())
           or (t.discord_user_id <> '' and t.discord_user_id = (select p.discord_id from public.profiles p where p.id = (select auth.uid())))
         )
    )
  );

grant select, insert, update, delete on public.tickets to anon, authenticated;
grant select, insert, update, delete on public.ticket_messages to anon, authenticated;
do $$
begin
  begin grant usage, select on sequence public.tickets_ticket_number_seq to authenticated, anon; exception when others then null; end;
  begin grant usage, select on sequence public.ticket_messages_id_seq to authenticated, anon; exception when others then null; end;
end $$;

-- ลูกค้าแก้ยอดเงิน/ออเดอร์/เติมเงินตรง ๆ ไม่ได้ ต้องผ่านฟังก์ชันด้านบนเท่านั้น (ส่วนแอดมินลบประวัติได้)
revoke insert, update, delete on public.profiles, public.orders, public.topups from anon, authenticated;
grant delete on public.profiles, public.orders, public.topups to authenticated;
revoke all on public.product_codes, public.bot_admins, public.admin_logs from anon;
revoke update on public.support_chats from anon;
grant select, insert, delete on public.support_chats to anon, authenticated;
grant select on public.categories, public.products, public.shop_products to anon, authenticated;

revoke execute on function public.handle_new_user()                                 from public, anon, authenticated;
revoke execute on function public.current_actor_label()                             from public, anon, authenticated;
revoke execute on function public.log_admin_event()                                 from public, anon, authenticated;
revoke execute on function public.log_codes_added()                                 from public, anon, authenticated;
revoke execute on function public.is_admin()                                        from public, anon;
revoke execute on function public.code_stock_left(uuid)                             from public;
revoke execute on function public.username_available(text)                          from public;
revoke execute on function public.buy_product(uuid, int, text)                      from public, anon;
revoke execute on function public.request_topup(numeric, text, text, text, text)    from public, anon;
revoke execute on function public.clear_my_chats(text, text)                        from public;
revoke execute on function public.delete_my_account()                               from public, anon;
revoke execute on function public.admin_review_topup(uuid, boolean, text, numeric)  from public, anon;
revoke execute on function public.admin_adjust_balance(uuid, numeric, text)         from public, anon;
revoke execute on function public.admin_update_order(uuid, text, text)              from public, anon;
revoke execute on function public.admin_delete_order(uuid, boolean)                 from public, anon;
revoke execute on function public.admin_delete_topup(uuid, boolean)                 from public, anon;
revoke execute on function public.admin_delete_chat(uuid, boolean, bigint)                  from public, anon;
revoke execute on function public.admin_delete_user(uuid, text)                     from public, anon;
revoke execute on function public.admin_delete_by_username(text, text)              from public, anon;
revoke execute on function public.admin_set_user(uuid, boolean, boolean, text)      from public, anon;
revoke execute on function public.admin_set_by_username(text, boolean, boolean, text) from public, anon;
revoke execute on function public.admin_users(text, int)                            from public, anon;
revoke execute on function public.admin_stats()                                     from public, anon;
revoke execute on function public.admin_reset_sales(boolean, boolean)                from public, anon;
revoke execute on function public.admin_test_discord_webhook()                      from public, anon;
revoke execute on function public.admin_resend_alert(bigint)                        from public, anon;
revoke execute on function public.detach_user_storage(uuid)                         from public, anon, authenticated;
revoke execute on function public.account_snapshot(uuid)                            from public, anon, authenticated;
revoke execute on function public.raise_account_alert(text, uuid, text)             from public, anon, authenticated;
revoke execute on function public.send_account_alert_webhook(bigint)                from public, anon, authenticated;
revoke execute on function public.profiles_ban_stamp()                              from public, anon, authenticated;
revoke execute on function public.profiles_ban_alert()                              from public, anon, authenticated;
revoke execute on function public.profiles_delete_alert()                           from public, anon, authenticated;

grant execute on function public.buy_product(uuid, int, text)                      to authenticated;
grant execute on function public.request_topup(numeric, text, text, text, text)    to authenticated;
grant execute on function public.clear_my_chats(text, text)                        to anon, authenticated;
grant execute on function public.delete_my_account()                               to authenticated;
grant execute on function public.admin_review_topup(uuid, boolean, text, numeric)  to authenticated;
grant execute on function public.admin_adjust_balance(uuid, numeric, text)         to authenticated;
grant execute on function public.admin_update_order(uuid, text, text)              to authenticated;
grant execute on function public.admin_delete_order(uuid, boolean)                 to authenticated;
grant execute on function public.admin_delete_topup(uuid, boolean)                 to authenticated;
grant execute on function public.admin_delete_chat(uuid, boolean, bigint)                  to authenticated;
grant execute on function public.admin_delete_user(uuid, text)                     to authenticated;
grant execute on function public.admin_delete_by_username(text, text)              to authenticated;
grant execute on function public.admin_set_user(uuid, boolean, boolean, text)      to authenticated;
grant execute on function public.admin_set_by_username(text, boolean, boolean, text) to authenticated;
grant execute on function public.admin_users(text, int)                            to authenticated;
grant execute on function public.admin_stats()                                     to authenticated;
grant execute on function public.admin_reset_sales(boolean, boolean)                to authenticated;
grant execute on function public.admin_test_discord_webhook()                      to authenticated;
grant execute on function public.admin_resend_alert(bigint)                        to authenticated;
grant execute on function public.is_admin()                                        to authenticated;
grant execute on function public.code_stock_left(uuid)                             to anon, authenticated;
grant execute on function public.username_available(text)                          to anon, authenticated;
grant execute on function public.get_server_status()                               to anon, authenticated;
grant execute on function public.sync_discord_profile(text, text, text)            to anon, authenticated;

-- =====================================================================
-- 6) ที่เก็บไฟล์ (Storage): รูปสินค้า = สาธารณะ, สลิป = ส่วนตัว
-- =====================================================================
insert into storage.buckets (id, name, public) values ('products', 'products', true)  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('slips',    'slips',    false) on conflict (id) do nothing;

drop policy if exists "shark products read"   on storage.objects;
drop policy if exists "shark products insert" on storage.objects;
drop policy if exists "shark products update" on storage.objects;
drop policy if exists "shark products delete" on storage.objects;
drop policy if exists "shark slips insert"    on storage.objects;
drop policy if exists "shark slips read"      on storage.objects;
create policy "shark products read"   on storage.objects for select using (bucket_id = 'products');
create policy "shark products insert" on storage.objects for insert to authenticated with check (bucket_id = 'products' and (select public.is_admin()));
create policy "shark products update" on storage.objects for update to authenticated using (bucket_id = 'products' and (select public.is_admin()));
create policy "shark products delete" on storage.objects for delete to authenticated using (bucket_id = 'products' and (select public.is_admin()));
create policy "shark slips insert"    on storage.objects for insert to authenticated
  with check (bucket_id = 'slips' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "shark slips read"      on storage.objects for select to authenticated
  using (bucket_id = 'slips' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin())));

-- =====================================================================
-- 7) อัปเดตแบบเรียลไทม์ (ยอดเงินเด้งทันทีเมื่อแอดมินอนุมัติ + แจ้งเตือนกิจกรรมแอดมินสด)
-- =====================================================================
do $$
begin
  begin alter publication supabase_realtime add table public.profiles;      exception when others then null; end;
  begin alter publication supabase_realtime add table public.products;      exception when others then null; end;
  begin alter publication supabase_realtime add table public.topups;        exception when others then null; end;
  begin alter publication supabase_realtime add table public.orders;        exception when others then null; end;
  begin alter publication supabase_realtime add table public.admin_logs;    exception when others then null; end;
  begin alter publication supabase_realtime add table public.bot_admins;    exception when others then null; end;
  begin alter publication supabase_realtime add table public.support_chats; exception when others then null; end;
  begin alter publication supabase_realtime add table public.account_alerts; exception when others then null; end;
  begin alter publication supabase_realtime add table public.tickets; exception when others then null; end;
  begin alter publication supabase_realtime add table public.ticket_messages; exception when others then null; end;
  begin alter publication supabase_realtime add table public.announcements; exception when others then null; end;
end $$;

-- =====================================================================
-- 8) ข้อมูลตัวอย่าง (ลบส่วนนี้ได้ถ้าไม่ต้องการ)
-- =====================================================================
insert into public.categories (slug, name_th, name_en, desc_th, desc_en, sort) values
  ('topup',   'เติมเกม',     'Game top-up',   'เติมเพชร / คูปองเข้าไอดีเกม',  'Diamonds and coupons to your game ID', 1),
  ('card',    'บัตรเงินสด',  'Gift cards',    'ได้รหัสบัตรทันทีหลังซื้อ',      'Get the card code right after purchase', 2),
  ('account', 'ไอดีเกม',     'Game accounts', 'ไอดีพร้อมเล่น',                'Ready-to-play accounts', 3),
  ('service', 'บริการ',      'Services',      'บริการจากทีมงาน',              'Services from our team', 4)
on conflict (slug) do nothing;

insert into public.products (category_id, name_th, name_en, desc_th, desc_en, price, delivery, credential_type, stock, input_label, featured, sort)
select c.id, v.name_th, v.name_en, v.desc_th, v.desc_en, v.price, v.delivery, v.credential_type, v.stock, v.input_label, v.featured, v.sort
from (values
  ('topup',   'เพชรเกม 100 เม็ด',        '100 Diamonds',          'เติมเข้าไอดีทันที',         'Delivered to your ID',            35,  'manual', 'email_pass', -1, 'UID เกม', true,  1),
  ('topup',   'เพชรเกม 500 เม็ด',        '500 Diamonds',          'คุ้มกว่า ได้โบนัสเพิ่ม',     'Better value with bonus',         165, 'manual', 'email_pass', -1, 'UID เกม', true,  2),
  ('topup',   'เพชรเกม 1000 เม็ด',       '1000 Diamonds',         'แพ็กใหญ่ ราคาประหยัด',       'Big pack, best price',            320, 'manual', 'email_pass', -1, 'UID เกม', false, 3),
  ('card',    'บัตรเติมเงิน 100 บาท',    'Top-up card 100 THB',   'ได้รหัสบัตรทันทีหลังซื้อ',   'Card code delivered instantly',   100, 'code',   'user_pass',  -1, '',        true,  1),
  ('card',    'บัตรเติมเงิน 300 บาท',    'Top-up card 300 THB',   'ได้รหัสบัตรทันทีหลังซื้อ',   'Card code delivered instantly',   295, 'code',   'user_pass',  -1, '',        false, 2),
  ('account', 'ไอดีเริ่มต้น เลเวล 30',   'Starter account Lv.30', 'พร้อมเล่น ตัวละครครบ',      'Ready to play, full roster',      450, 'code',   'email_pass', -1, '',        false, 1),
  ('service', 'บริการเก็บเลเวล',         'Leveling service',      'ทีมงานเล่นให้ ปลอดภัย',      'Played by our team, safely',      250, 'manual', 'email_pass', 10, 'ไอดี / ช่องทางติดต่อ', false, 1)
) as v(cat, name_th, name_en, desc_th, desc_en, price, delivery, credential_type, stock, input_label, featured, sort)
join public.categories c on c.slug = v.cat
where not exists (select 1 from public.products);

update public.products set stock = -1 where delivery = 'code' and sold = 0 and stock = 0;

-- =====================================================================
-- 9) ตั้งตัวเองเป็นแอดมิน: สมัครสมาชิกบนเว็บก่อน แล้วรันบรรทัดนี้ (เปลี่ยนชื่อ)
--    update public.profiles set is_admin = true where lower(username) = lower('your_english_username');
-- =====================================================================

-- โหลดโครงสร้าง API ใหม่ทันที (ให้หน้าเว็บ/บอทเห็นฟังก์ชันที่เปลี่ยน parameter)
notify pgrst, 'reload schema';
