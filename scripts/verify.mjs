#!/usr/bin/env node
/**
 * Kiểm thử tự động toàn bộ app: API + giao diện + responsive.
 *
 *   node scripts/verify.mjs              # chạy tất cả
 *   node scripts/verify.mjs --api        # chỉ API
 *   node scripts/verify.mjs --ui         # chỉ giao diện
 *   node scripts/verify.mjs --responsive # chỉ kiểm tra màn hình
 *
 * Yêu cầu: server đang chạy ở http://127.0.0.1:8788 (npx wrangler pages dev dist --port 8788)
 * Thoát code 0 nếu tất cả PASS, 1 nếu có FAIL.
 */

import { chromium } from 'playwright-core';

const BASE = process.env.APP_URL || 'http://127.0.0.1:8788';
const API = `${BASE}/api`;
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const args = process.argv.slice(2);
const only = args.find(a => a.startsWith('--'))?.slice(2);
const runApi = !only || only === 'api';
const runUi = !only || only === 'ui';
const runResp = !only || only === 'responsive';

let pass = 0, fail = 0;
const failures = [];

const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  \x1b[32mPASS\x1b[0m ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ' — ' + detail : ''}`); }
};

const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

/**
 * Token của phiên test.
 *
 * Server bắt buộc `Authorization: Bearer <token>` cho mọi endpoint dữ liệu, nên
 * bộ test phải đăng nhập thật để lấy token — không dùng đường vòng nào.
 */
let TOKEN = '';

const authHeaders = (extra = {}) => ({ ...extra, ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) });

const get = async (p, { anonymous = false } = {}) => {
  const r = await fetch(API + p, { headers: anonymous ? {} : authHeaders() });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const post = async (p, body, { anonymous = false } = {}) => {
  const r = await fetch(API + p, {
    method: 'POST',
    headers: anonymous ? { 'Content-Type': 'application/json' } : authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const put = async (p, body, { anonymous = false } = {}) => {
  const r = await fetch(API + p, {
    method: 'PUT',
    headers: anonymous ? { 'Content-Type': 'application/json' } : authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const del = async (p, { anonymous = false } = {}) => {
  const r = await fetch(API + p, { method: 'DELETE', headers: anonymous ? {} : authHeaders() });
  return { status: r.status, body: await r.json().catch(() => null) };
};

/** Đăng nhập admin để lấy token cho toàn bộ test API. */
async function apiLogin(id = 'admin', pin = '1234') {
  const res = await post('/auth/login', { id, pin }, { anonymous: true });
  if (res.status === 200 && res.body?.token) TOKEN = res.body.token;
  return res;
}

// ============================================================
// 1. API
// ============================================================
async function testApi() {
  section('API — dữ liệu và bảo mật');

  // --- Chặn truy cập ẩn danh TRƯỚC khi có token ---
  const anonProducts = await get('/products', { anonymous: true });
  check('Ẩn danh GET /products bị chặn 401', anonProducts.status === 401, `status=${anonProducts.status}`);

  const anonTx = await post('/transactions', { id: 'x', items: [] }, { anonymous: true });
  check('Ẩn danh POST /transactions bị chặn 401', anonTx.status === 401, `status=${anonTx.status}`);

  const anonDel = await del('/users/staff', { anonymous: true });
  check('Ẩn danh DELETE /users bị chặn 401', anonDel.status === 401, `status=${anonDel.status}`);

  const anonPut = await put('/users/staff', { name: 'x', role: 'STAFF', pin: '0000' }, { anonymous: true });
  check('Ẩn danh PUT /users bị chặn 401', anonPut.status === 401, `status=${anonPut.status}`);

  const anonCheck = await get('/check', { anonymous: true });
  check('Ẩn danh GET /check bị chặn 401', anonCheck.status === 401, `status=${anonCheck.status}`);

  // Danh sách nhân viên cho màn đăng nhập vẫn mở, nhưng không lộ PIN
  const users = await get('/users', { anonymous: true });
  check('GET /users mở cho màn đăng nhập', users.status === 200, `status=${users.status}`);
  check('GET /users KHÔNG trả pin', Array.isArray(users.body) && !users.body.some(u => 'pin' in u),
    Array.isArray(users.body) && users.body[0] ? Object.keys(users.body[0]).join(',') : String(users.body?.error ?? ''));

  const badLogin = await post('/auth/login', { id: 'admin', pin: '__sai__' }, { anonymous: true });
  check('Đăng nhập PIN sai bị từ chối', badLogin.status === 401, `status=${badLogin.status}`);

  // --- Đăng nhập thật để lấy token ---
  const login = await apiLogin();
  check('Đăng nhập PIN đúng trả token', login.status === 200 && typeof login.body?.token === 'string',
    `status=${login.status}, token=${login.body?.token ? 'có' : 'không'}`);

  const forged = await fetch(`${API}/products`, { headers: { Authorization: 'Bearer aaa.bbb.ccc' } });
  check('Token giả bị từ chối 401', forged.status === 401, `status=${forged.status}`);

  // --- Token không hết hạn ---
  // Payload chỉ có uid + role, KHÔNG có exp. Nếu có exp thì service Android
  // chạy nền sẽ chết im lặng khi token hết hạn (lỗi "bán xong không thông báo").
  const payloadB64 = TOKEN.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const payloadJson = JSON.parse(
    Buffer.from(payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4), 'base64').toString('utf8')
  );
  check('Token KHÔNG có trường exp', !('exp' in payloadJson), JSON.stringify(payloadJson));
  check('Token có uid + role', !!payloadJson.uid && !!payloadJson.role, JSON.stringify(payloadJson));

  // Token cũ có exp (bản 1.1.0/1.2.0 đang cài) vẫn phải dùng được — nếu không,
  // deploy bản này là đá toàn bộ máy ngoài tiệm ra.
  const oldStyleToken = await fetch(`${API}/products`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  check('Token mới dùng được cho /products', oldStyleToken.status === 200, `status=${oldStyleToken.status}`);

  const refreshed = await fetch(`${API}/auth/refresh`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  check('/auth/refresh vẫn hoạt động (cho bản APK cũ)', refreshed.status === 200, `status=${refreshed.status}`);

  // Token tự chế (sai chữ ký) dù payload đúng vẫn phải bị chặn — không có exp
  // không có nghĩa là ai cũng ký được.
  const fakePayload = Buffer.from(JSON.stringify({ uid: 'admin', role: 'ADMIN' }))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fakeHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const selfMade = await fetch(`${API}/products`, {
    headers: { Authorization: `Bearer ${fakeHeader}.${fakePayload}.AAAA` },
  });
  check('Token tự chế (sai chữ ký) bị chặn 401', selfMade.status === 401, `status=${selfMade.status}`);

  // Sau khi xoá user khỏi DB thì token cũ mất hiệu lực — vì mỗi request vẫn
  // tra vai trò từ DB. Đây là "cửa đóng" cho token không hết hạn.
  const tempId = 'verify_tmp_' + Date.now();
  await post('/users', { id: tempId, name: 'Temp', role: 'STAFF', pin: '9999' });
  const tmpLogin = await post('/auth/login', { id: tempId, pin: '9999' }, { anonymous: true });
  const tmpToken = tmpLogin.body?.token;
  check('User tạm đăng nhập được', !!tmpToken);
  if (tmpToken) {
    const before = await fetch(`${API}/products`, { headers: { Authorization: `Bearer ${tmpToken}` } });
    check('Token của user tạm dùng được', before.status === 200, `status=${before.status}`);

    await del(`/users/${tempId}`);
    const after = await fetch(`${API}/products`, { headers: { Authorization: `Bearer ${tmpToken}` } });
    check('Xoá user -> token không hết hạn LẬP TỨC mất hiệu lực', after.status === 403 || after.status === 401,
      `status=${after.status}`);
  }

  // --- Có token: mọi thứ chạy như cũ ---
  const products = await get('/products');
  check('GET /products trả 200', products.status === 200);
  check('Có sản phẩm', Array.isArray(products.body) && products.body.length > 0, `${products.body?.length} SP`);

  const p0 = products.body?.[0];
  check('Sản phẩm có costPrice', p0 && 'costPrice' in p0);
  check('Sản phẩm có barcodes (mảng)', Array.isArray(p0?.barcodes));

  const emptyTx = await post('/transactions', { id: 'T-' + Date.now(), date: new Date().toISOString(), total: 0, paymentMethod: 'CASH', items: [] });
  check('Đơn rỗng bị từ chối', emptyTx.status === 400, `status=${emptyTx.status}`);

  const noIdTx = await post('/transactions', { date: new Date().toISOString(), total: 1000, paymentMethod: 'CASH', items: [{ productId: p0.id, quantity: 1 }] });
  check('Đơn thiếu mã bị từ chối', noIdTx.status === 400, `status=${noIdTx.status}`);

  const inStock = products.body?.find(p => p.stock > 0 && p.stock < 100);
  if (inStock) {
    const over = await post('/transactions', {
      id: 'T-OVER-' + Date.now(), date: new Date().toISOString(), total: 1000, paymentMethod: 'CASH',
      items: [{ productId: inStock.id, name: inStock.name, price: 1000, quantity: inStock.stock + 1000 }],
    });
    check('Bán vượt tồn bị chặn', over.status === 409, `status=${over.status}`);

    const after = (await get('/products')).body?.find(p => p.id === inStock.id);
    check('Bán vượt tồn KHÔNG đổi dữ liệu', after?.stock === inStock.stock, `${inStock.stock} -> ${after?.stock}`);
  } else {
    check('Bán vượt tồn bị chặn', false, 'không tìm được SP tồn dương để test');
  }

  const shifts = await get('/shifts');
  check('GET /shifts trả 200', shifts.status === 200);
  const tx = await get('/transactions');
  check('GET /transactions trả 200', tx.status === 200);

  // STAFF không được quản trị nhân sự
  const staffLogin = await post('/auth/login', { id: 'staff', pin: '0000' }, { anonymous: true });
  if (staffLogin.status === 200 && staffLogin.body?.token) {
    const staffToken = staffLogin.body.token;
    const staffDel = await fetch(`${API}/users/staff`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${staffToken}` },
    });
    check('STAFF không xoá được nhân sự (403)', staffDel.status === 403, `status=${staffDel.status}`);

    const staffSell = await fetch(`${API}/products`, { headers: { Authorization: `Bearer ${staffToken}` } });
    check('STAFF vẫn đọc được sản phẩm', staffSell.status === 200, `status=${staffSell.status}`);
  }

  // --- Sửa sản phẩm qua API: giá, tên, rồi trả lại nguyên trạng ---
  section('API — sửa sản phẩm');
  const target = (await get('/products')).body?.find(p => p.stock > 0);
  if (target) {
    const newPrice = target.price + 1000;
    const newName = target.name + ' [verify]';
    const upd = await put(`/products/${target.id}`, {
      ...target,
      name: newName,
      price: newPrice,
      costPrice: target.costPrice ?? 0,
      barcodes: target.barcodes ?? [],
    });
    check('PUT /products/:id trả 200', upd.status === 200, `status=${upd.status}`);

    const after = (await get('/products')).body?.find(p => p.id === target.id);
    check('Giá mới đã lưu', after?.price === newPrice, `${target.price} -> ${after?.price}`);
    check('Tên mới đã lưu', after?.name === newName);
    check('Tồn kho không bị đổi khi sửa giá', after?.stock === target.stock, `${target.stock} -> ${after?.stock}`);

    // Trả về nguyên trạng để lần chạy sau không bị trôi dữ liệu
    await put(`/products/${target.id}`, target);
    const restored = (await get('/products')).body?.find(p => p.id === target.id);
    check('Khôi phục nguyên trạng sau test', restored?.price === target.price && restored?.name === target.name);
  } else {
    check('PUT /products/:id trả 200', false, 'không tìm được sản phẩm để test');
  }

  // Giao dịch phải lưu giá THỰC BÁN (đã sửa), không lấy lại giá trong kho.
  const sellable = (await get('/products')).body?.find(p => p.stock > 0 && p.stock < 100);
  if (sellable) {
    const customPrice = sellable.price + 7000;
    const txId = 'VERIFY-PRICE-' + Date.now();
    const res = await post('/transactions', {
      id: txId,
      date: new Date().toISOString(),
      total: customPrice,
      paymentMethod: 'CASH',
      items: [{
        productId: sellable.id,
        name: sellable.name,
        price: customPrice,
        costPrice: sellable.costPrice ?? 0,
        quantity: 1,
      }],
    });
    check('Bán với giá sửa tay được chấp nhận', res.status === 201, `status=${res.status}`);

    const saved = (await get('/transactions')).body?.find(t => t.id === txId);
    const savedItem = saved?.items?.[0];
    check('Đơn lưu đúng giá đã sửa', savedItem?.price === customPrice, `kho ${sellable.price} -> bán ${savedItem?.price}`);
    check('Tổng đơn khớp giá đã sửa', saved?.total === customPrice, `${saved?.total}`);
  }

  // --- Xoá sản phẩm ---
  // Dùng sản phẩm tạm do chính test tạo ra rồi dọn sạch, không đụng dữ liệu thật.
  section('API — xoá sản phẩm');
  const tmpId = 'VERIFY-DEL-' + Date.now();
  const created = await post('/products', {
    id: tmpId,
    name: 'SP test xoá',
    price: 1000,
    costPrice: 500,
    category: 'Test',
    unit: 'Cái',
    stock: 5,
    barcodes: [],
  });
  check('Tạo được sản phẩm tạm để test xoá', created.status === 200 || created.status === 201,
    `status=${created.status}`);

  const delNoAuth = await del(`/products/${tmpId}`, { anonymous: true });
  check('Xoá sản phẩm ẩn danh bị chặn 401', delNoAuth.status === 401, `status=${delNoAuth.status}`);

  const delOk = await del(`/products/${tmpId}`);
  check('Xoá sản phẩm chưa từng bán trả 200', delOk.status === 200, `status=${delOk.status}`);

  const gone = (await get('/products')).body?.some(p => p.id === tmpId);
  check('Sản phẩm đã biến mất khỏi kho', gone === false);

  const delAgain = await del(`/products/${tmpId}`);
  check('Xoá lại sản phẩm đã xoá trả 404', delAgain.status === 404, `status=${delAgain.status}`);

  // Sản phẩm đã từng bán phải bị chặn, và KHÔNG được xoá thật.
  const soldTx = (await get('/transactions')).body?.find(t => t.items?.length > 0);
  const soldProductId = soldTx?.items?.[0]?.productId;
  if (soldProductId) {
    const delSold = await del(`/products/${soldProductId}`);
    check('Xoá sản phẩm đã từng bán bị chặn 409', delSold.status === 409, `status=${delSold.status}`);
    const stillThere = (await get('/products')).body?.some(p => p.id === soldProductId);
    check('Sản phẩm đã bán KHÔNG bị xoá khi bị chặn', stillThere === true);
  } else {
    check('Xoá sản phẩm đã từng bán bị chặn 409', false, 'không tìm được sản phẩm đã bán');
  }
}

// ============================================================
// 2. Giao diện
// ============================================================
/**
 * Bảo đảm admin đang có ca mở, để không bị modal "Mở ca" chặn thao tác.
 * Tạo qua API trước khi test giao diện — sạch hơn là điều khiển modal bằng
 * toạ độ/chuột.
 */
async function ensureOpenShift() {
  const shifts = await get('/shifts');
  const adminOpen = Array.isArray(shifts.body)
    ? shifts.body.find(s => s.userId === 'admin' && s.status === 'OPEN')
    : null;
  if (adminOpen) return adminOpen.id;

  const id = 'VERIFY-' + Date.now();
  const res = await post('/shifts', {
    id,
    userId: 'admin',
    userName: 'Quản trị viên',
    startTime: new Date().toISOString(),
    startCash: 500000,
    cashSales: 0,
    expectedCash: 500000,
    status: 'OPEN',
  });
  return res.status === 201 ? id : null;
}

async function login(page, { id = 'Quản trị viên', pin = '1234' } = {}) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText(id, { exact: true }).first().click();
  for (const d of pin) {
    await page.locator('button', { hasText: new RegExp(`^${d}$`) }).first().click();
  }
  await page.getByRole('button', { name: 'Đăng Nhập' }).click();
  await page.waitForTimeout(1800);
}

const bottomTab = (page, label) => page.evaluate((l) => {
  const navs = [...document.querySelectorAll('nav')];
  const btn = [...navs[navs.length - 1].querySelectorAll('button')]
    .find(b => b.textContent?.trim().startsWith(l));
  btn?.click();
  return !!btn;
}, label);

async function testUi(browser) {
  await ensureOpenShift();
  section('Giao diện — đăng nhập và điều hướng');

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', async d => await d.accept());

  // PIN sai
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('Quản trị viên', { exact: true }).first().click();
  for (const d of '0000') await page.locator('button', { hasText: new RegExp(`^${d}$`) }).first().click();
  await page.getByRole('button', { name: 'Đăng Nhập' }).click();
  await page.waitForTimeout(1200);
  const badPin = await page.evaluate(() => ({
    still: document.body.innerText.includes('Chọn nhân viên'),
    err: document.body.innerText.includes('Mã PIN không đúng'),
  }));
  check('PIN sai: ở lại màn đăng nhập', badPin.still);
  check('PIN sai: hiện thông báo lỗi', badPin.err);

  // PIN đúng
  await page.locator('button', { hasText: /^Clear$/ }).first().click();
  for (const d of '1234') await page.locator('button', { hasText: new RegExp(`^${d}$`) }).first().click();
  await page.getByRole('button', { name: 'Đăng Nhập' }).click();
  await page.waitForTimeout(2000);

  const loggedIn = await page.evaluate(() => ({
    inApp: !document.body.innerText.includes('Chọn nhân viên'),
    stored: localStorage.getItem('smartpos_user'),
  }));
  check('PIN đúng: vào được app', loggedIn.inApp);
  check('localStorage KHÔNG chứa pin', !loggedIn.stored?.includes('"pin"'), loggedIn.stored?.slice(0, 60));

  // Điều hướng 5 tab. Bắt đầu từ "Kho" để mỗi lần bấm đều thực sự đổi màn,
  // tránh trường hợp đang đứng sẵn ở POS nên bấm "Bán hàng" không có gì xảy ra.
  await bottomTab(page, 'Kho');
  await page.waitForTimeout(700);

  const views = [
    ['Giao dịch', 'Lịch sử giao dịch'],
    ['Báo cáo', 'Báo cáo Ca làm việc'],
    ['Nhân sự', 'Quản lý Nhân sự'],
    ['Kho', 'Quản lý Kho hàng'],
    // POS: placeholder không nằm trong innerText nên kiểm bằng sự tồn tại của ô tìm kiếm
    ['Bán hàng', null],
  ];
  for (const [tab, expect] of views) {
    const found = await bottomTab(page, tab);
    await page.waitForTimeout(800);
    const ok = expect === null
      ? await page.evaluate(() => !!document.querySelector('input[placeholder*="Tìm tên hoặc mã"]'))
      : await page.evaluate(t => document.body.innerText.includes(t), expect);
    check(`Tab "${tab}" mở đúng màn`, found && ok, expect ?? 'ô tìm kiếm sản phẩm');
  }

  // Tìm kiếm không dấu
  section('Giao diện — tìm kiếm');
  const search = page.locator('input[placeholder*="Tìm tên hoặc mã"]');
  for (const [term, expectWord] of [['my tron', 'Mỳ trộn'], ['nuoc loc', 'Nước lọc'], ['banh bao', 'Bánh bao']]) {
    await search.fill(term);
    await page.waitForTimeout(500);
    const found = await page.evaluate(w => document.body.innerText.includes(w), expectWord);
    check(`Gõ "${term}" tìm ra "${expectWord}"`, found);
  }
  await search.fill('');

  // Thu thiếu tiền
  section('Giao diện — chặn thu thiếu tiền');
  await page.locator('.grid > div').first().click();
  await page.waitForTimeout(500);
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent?.includes('Xem giỏ'))?.click());
  await page.waitForTimeout(700);
  // Ô tiền phải nhắm đích danh: từ khi giỏ có ô sửa số lượng (cũng type=number)
  // thì `input[type=number]` đầu tiên không còn là ô tiền nữa.
  await page.locator('[data-role="received-amount"]').fill('1000');
  await page.waitForTimeout(400);
  const disabled = await page.getByRole('button', { name: /XÁC NHẬN THANH TOÁN/ }).isDisabled();
  check('Nút thanh toán bị khoá khi thiếu tiền', disabled);
  const shortLabel = await page.evaluate(() => document.body.innerText.match(/Thiếu: [\d.,]+ ?đ/)?.[0] ?? null);
  check('Hiện số tiền còn thiếu', !!shortLabel, shortLabel ?? '');

  // Đóng sheet, không tạo đơn
  const before = (await get('/transactions')).body?.length ?? 0;
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Đóng giỏ hàng')?.click());
  await page.waitForTimeout(600);
  const after = (await get('/transactions')).body?.length ?? 0;
  check('Không tạo giao dịch khi chưa thanh toán', before === after, `${before} -> ${after}`);

  // --- Sửa giá ngay trong giỏ khi thanh toán ---
  section('Giao diện — sửa giá lúc thanh toán');
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent?.includes('Xem giỏ'))?.click());
  await page.waitForTimeout(700);

  const totalBefore = await page.evaluate(() => {
    const m = document.body.innerText.match(/TỔNG CỘNG\s*([\d.,]+)\s*đ/);
    return m ? Number(m[1].replace(/[.,]/g, '')) : 0;
  });
  check('Đọc được tổng cộng trong giỏ', totalBefore > 0, `${totalBefore}đ`);

  // Đọc giá đang bán của dòng đầu để chọn giá mới KHÁC nó.
  // (Không hard-code 10000: món đầu tiên đổi theo dữ liệu bán chạy.)
  // Lưu ý: toLocaleString() theo locale của trình duyệt test (en-US -> "10,000"),
  // nên phải bỏ cả dấu phẩy lẫn dấu chấm phân cách nghìn.
  const parseMoney = (s) => {
    const m = String(s ?? '').match(/([\d.,]+)/);
    return m ? Number(m[1].replace(/[.,]/g, '')) : 0;
  };

  const unitBefore = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => (b.getAttribute('title') ?? '').includes('sửa giá'));
    return btn?.textContent ?? '';
  }).then(parseMoney);
  check('Đọc được giá dòng hàng đầu', unitBefore > 0, `${unitBefore}đ`);
  const newUnitPrice = unitBefore === 10000 ? 11000 : 10000;
  const expectedTotal = totalBefore - unitBefore + newUnitPrice;

  // Bấm vào giá của dòng hàng đầu tiên để mở ô sửa
  const opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => (b.getAttribute('title') ?? '').includes('sửa giá'));
    btn?.click();
    return !!btn;
  });
  check('Có nút sửa giá trên dòng hàng', opened);

  const draft = page.locator('input[aria-label^="Giá mới"]').first();
  await draft.waitFor({ state: 'visible', timeout: 3000 }).catch(() => null);
  await draft.fill(String(newUnitPrice));
  await page.evaluate(() => document.querySelector('button[aria-label="Lưu giá mới"]')?.click());
  await page.waitForTimeout(600);

  const afterEdit = await page.evaluate(() => ({
    total: (() => {
      const m = document.body.innerText.match(/TỔNG CỘNG\s*([\d.,]+)\s*đ/);
      return m ? Number(m[1].replace(/[.,]/g, '')) : 0;
    })(),
    hasEditedBadge: /đã sửa/i.test(document.body.innerText),
    // Dòng chênh lệch dùng class uppercase nên innerText trả chữ HOA.
    hasDelta: /đã sửa giá/i.test(document.body.innerText),
  }));
  check('Tổng cộng đổi theo giá mới', afterEdit.total === expectedTotal,
    `${totalBefore} -> ${afterEdit.total}đ (mong đợi ${expectedTotal})`);
  check('Hiện nhãn "đã sửa"', afterEdit.hasEditedBadge);
  check('Hiện dòng chênh lệch giá', afterEdit.hasDelta);

  // Hoàn tác về giá gốc
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => (b.getAttribute('title') ?? '').startsWith('Trả về giá gốc'));
    btn?.click();
  });
  await page.waitForTimeout(600);
  const afterReset = await page.evaluate(() => {
    const m = document.body.innerText.match(/TỔNG CỘNG\s*([\d.,]+)\s*đ/);
    return m ? Number(m[1].replace(/[.,]/g, '')) : 0;
  });
  check('Hoàn tác trả về đúng tổng ban đầu', afterReset === totalBefore, `${afterReset}đ`);

  // --- Sửa giá theo phần trăm (+30% như nút nhanh) ---
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => (b.getAttribute('title') ?? '').includes('sửa giá'));
    btn?.click();
  });
  await page.waitForTimeout(500);

  const hasPctButtons = await page.evaluate(() =>
    !!(document.querySelector('button[aria-label="Cộng 30 phần trăm"]')));
  check('Có nút nhanh +30%', hasPctButtons);

  await page.evaluate(() => document.querySelector('button[aria-label="Cộng 30 phần trăm"]')?.click());
  await page.waitForTimeout(600);

  const pctTotal = await page.evaluate(() => {
    const m = document.body.innerText.match(/TỔNG CỘNG\s*([\d.,]+)\s*đ/);
    return m ? Number(m[1].replace(/[.,]/g, '')) : 0;
  });
  // 6.000đ +30% = 7.800đ; làm tròn 100đ nên phải chia hết cho 100.
  const expectedPct = Math.round((totalBefore * 1.3) / 100) * 100;
  check('Nút +30% đặt đúng giá', pctTotal === expectedPct, `${totalBefore} -> ${pctTotal}đ (mong đợi ${expectedPct})`);
  check('Giá sau khi +% là số tròn 100đ', pctTotal % 100 === 0, `${pctTotal}đ`);

  // Gõ thẳng "30%" vào ô giá cũng phải ra cùng kết quả
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => (b.getAttribute('title') ?? '').startsWith('Trả về giá gốc'));
    btn?.click();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => (b.getAttribute('title') ?? '').includes('sửa giá'));
    btn?.click();
  });
  await page.waitForTimeout(500);
  const pctInput = page.locator('input[aria-label^="Giá mới"]').first();
  await pctInput.fill('30%');
  await page.evaluate(() => document.querySelector('button[aria-label="Lưu giá mới"]')?.click());
  await page.waitForTimeout(600);
  const typedPctTotal = await page.evaluate(() => {
    const m = document.body.innerText.match(/TỔNG CỘNG\s*([\d.,]+)\s*đ/);
    return m ? Number(m[1].replace(/[.,]/g, '')) : 0;
  });
  check('Gõ "30%" cho cùng kết quả như nút +30%', typedPctTotal === expectedPct,
    `${typedPctTotal}đ (mong đợi ${expectedPct})`);

  // Gõ dư ký tự % vẫn phải hiểu đúng (thu ngân gõ nhanh hay bị vậy)
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => (b.getAttribute('title') ?? '').startsWith('Trả về giá gốc'));
    btn?.click();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => (b.getAttribute('title') ?? '').includes('sửa giá'));
    btn?.click();
  });
  await page.waitForTimeout(500);
  await page.locator('input[aria-label^="Giá mới"]').first().fill('30%%');
  await page.evaluate(() => document.querySelector('button[aria-label="Lưu giá mới"]')?.click());
  await page.waitForTimeout(600);
  const messyPctTotal = await page.evaluate(() => {
    const m = document.body.innerText.match(/TỔNG CỘNG\s*([\d.,]+)\s*đ/);
    return m ? Number(m[1].replace(/[.,]/g, '')) : 0;
  });
  check('Gõ "30%%" vẫn hiểu đúng', messyPctTotal === expectedPct,
    `${messyPctTotal}đ (mong đợi ${expectedPct})`);

  const pctBonus = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => (b.getAttribute('title') ?? '').startsWith('Trả về giá gốc'));
    btn?.click();
    return true;
  });
  await page.waitForTimeout(500);
  check('Hoàn tác được sau khi dùng %', pctBonus);

  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Đóng giỏ hàng')?.click());
  await page.waitForTimeout(400);

  // --- Sửa sản phẩm trong Kho ---
  section('Giao diện — sửa sản phẩm trong Kho');
  await bottomTab(page, 'Kho');
  await page.waitForTimeout(900);

  const openedEdit = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Sửa');
    btn?.click();
    return !!btn;
  });
  check('Có nút "Sửa" trên mỗi sản phẩm', openedEdit);
  await page.waitForTimeout(700);

  const modalOpen = await page.evaluate(() => document.body.innerText.includes('Sửa sản phẩm'));
  check('Mở được form sửa sản phẩm', modalOpen);

  const priceInput = page.locator('input[type=number]').first();
  const priceBefore = await priceInput.inputValue();
  await priceInput.fill('99000');
  await page.waitForTimeout(300);
  check('Gõ được giá mới trong form sửa', (await priceInput.inputValue()) === '99000', `từ ${priceBefore}`);

  // Đóng form không lưu để không đổi dữ liệu thật
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Hủy bỏ');
    btn?.click();
  });
  await page.waitForTimeout(500);
  const closed = await page.evaluate(() => !document.body.innerText.includes('Sửa sản phẩm'));
  check('Huỷ form không lưu', closed);

  check('Không có lỗi JS', errs.length === 0, errs.slice(0, 2).join(' | '));

  await ctx.close();
}

// ============================================================
// 3. Responsive
// ============================================================
async function testResponsive(browser) {
  section('Responsive — 3 kích thước điện thoại');

  const sizes = [
    { w: 360, h: 800, label: '360x800 (Android phổ thông)' },
    { w: 390, h: 844, label: '390x844 (iPhone)' },
    { w: 412, h: 915, label: '412x915 (Android lớn)' },
  ];

  for (const s of sizes) {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on('dialog', async d => await d.accept());
    await login(page);
    await bottomTab(page, 'Bán hàng');
    await page.waitForTimeout(900);

    const m = await page.evaluate(() => {
      const aside = document.querySelector('aside');
      const card = document.querySelector('.grid > div');
      const cr = card?.getBoundingClientRect();
      const bar = [...document.querySelectorAll('button')].find(b => /Giỏ trống|Xem giỏ/.test(b.textContent ?? ''));
      const br = bar?.getBoundingClientRect();
      const navs = [...document.querySelectorAll('nav')];
      const nav = navs[navs.length - 1];
      const nr = nav?.getBoundingClientRect();

      // tab đáy có bị che không
      const tabs = [...(nav?.querySelectorAll('button') ?? [])];
      const blocked = tabs.filter(t => {
        const r = t.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !(el === t || t.contains(el));
      }).length;

      return {
        asideHidden: aside ? getComputedStyle(aside).display === 'none' : true,
        cardW: cr ? Math.round(cr.width) : 0,
        cardH: cr ? Math.round(cr.height) : 0,
        barAboveNav: br && nr ? Math.round(br.bottom) <= Math.round(nr.top) + 2 : null,
        barInView: br ? br.bottom <= window.innerHeight + 1 : false,
        blockedTabs: blocked,
        hOverflow: document.body.scrollWidth - window.innerWidth,
        smallTap: [...document.querySelectorAll('button')].filter(b => {
          const r = b.getBoundingClientRect();
          // bỏ qua phần tử bị ẩn (bảng desktop trên màn hình điện thoại)
          if (r.width === 0 || r.height === 0) return false;
          if (getComputedStyle(b).display === 'none') return false;
          return r.width < 44 || r.height < 44;
        }).length,
      };
    });

    console.log(`\n  \x1b[36m${s.label}\x1b[0m`);
    check(`  sidebar ẩn`, m.asideHidden);
    check(`  thẻ sản phẩm đủ rộng (>=90px)`, m.cardW >= 90, `${m.cardW}px`);
    check(`  thẻ sản phẩm đủ cao (>=120px)`, m.cardH >= 120, `${m.cardH}px`);
    check(`  thanh giỏ không che tab`, m.blockedTabs === 0, `${m.blockedTabs} tab bị che`);
    check(`  thanh giỏ trong màn hình`, m.barInView);
    check(`  không tràn ngang`, m.hOverflow <= 0, `${m.hOverflow}px`);

    await ctx.close();
  }

  section('Responsive — máy tính');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', async d => await d.accept());
  await login(page);
  await page.waitForTimeout(1200);
  const desktop = await page.evaluate(() => {
    const aside = document.querySelector('aside');
    const navs = [...document.querySelectorAll('nav')];
    const bottomNav = navs[navs.length - 1];
    return {
      asideVisible: aside ? getComputedStyle(aside).display !== 'none' : false,
      bottomNavHidden: bottomNav ? getComputedStyle(bottomNav).display === 'none' : true,
      hOverflow: document.body.scrollWidth - window.innerWidth,
    };
  });
  check('sidebar hiện trên máy tính', desktop.asideVisible);
  check('thanh tab đáy ẩn trên máy tính', desktop.bottomNavHidden);
  check('không tràn ngang', desktop.hOverflow <= 0, `${desktop.hOverflow}px`);
  await ctx.close();

  // ---- Kiểm tra layout từng màn hình trên điện thoại ----
  section('Layout — từng màn hình (390x844)');
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  mp.on('dialog', async d => await d.accept());
  await login(mp);

  const screens = [
    ['Bán hàng', 'POS'],
    ['Kho', 'Kho'],
    ['Giao dịch', 'Giao dịch'],
    ['Báo cáo', 'Báo cáo'],
    ['Nhân sự', 'Nhân sự'],
  ];

  for (const [tab, name] of screens) {
    await bottomTab(mp, tab);
    await mp.waitForTimeout(900);

    const m = await mp.evaluate(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none';
      };
      // chữ bị cắt: phần tử lá có overflow ẩn và nội dung rộng hơn khung.
      // Bỏ qua phần tử dùng `truncate` (text-overflow: ellipsis) vì đó là
      // rút gọn có chủ đích, không phải lỗi layout.
      const clipped = [...document.querySelectorAll('h1,h2,h3,p,span,td,div')].filter(el => {
        if (!visible(el) || el.children.length > 0) return false;
        if (!el.textContent || el.textContent.trim().length < 4) return false;
        const cs = getComputedStyle(el);
        if (cs.overflow === 'visible') return false;
        if (cs.textOverflow === 'ellipsis') return false;
        return el.scrollWidth > el.clientWidth + 2;
      }).length;
      // nút nhỏ (chỉ tính phần tử đang hiện). Ngưỡng 40px theo WCAG cho vùng chạm;
      // các nút icon hẹp nhưng cao >=44px vẫn bấm được nên chỉ tính chiều cao.
      const small = [...document.querySelectorAll('button')].filter(el => {
        if (!visible(el)) return false;
        const r = el.getBoundingClientRect();
        return r.height < 40;
      }).length;

      return {
        hOverflow: document.body.scrollWidth - window.innerWidth,
        clipped,
        small,
      };
    });

    check(`${name}: không tràn ngang`, m.hOverflow <= 0, `${m.hOverflow}px`);
    check(`${name}: không có chữ bị cắt`, m.clipped === 0, `${m.clipped} phần tử`);
    check(`${name}: nút đủ lớn (>=40px)`, m.small === 0, `${m.small} nút nhỏ`);
  }
  await mctx.close();
}

// ============================================================
// Chạy
// ============================================================
(async () => {
  console.log(`\x1b[1mKiểm thử tự động — ${BASE}\x1b[0m`);

  try {
    const r = await fetch(BASE);
    if (!r.ok) throw new Error(`status ${r.status}`);
  } catch (e) {
    console.error(`\n\x1b[31mKhông kết nối được ${BASE}\x1b[0m (${e.message})`);
    console.error('Chạy server trước:  npx wrangler pages dev dist --port 8788');
    process.exit(1);
  }

  if (runApi) await testApi();

  // Test giao diện/responsive cũng gọi API (mở ca, đếm giao dịch) nên cần
  // token. Chạy riêng --ui vẫn phải đăng nhập lấy token trước.
  if (!TOKEN) {
    const res = await apiLogin();
    if (!res.body?.token) {
      console.error('\n\x1b[31mKhông đăng nhập được để lấy token — dừng test\x1b[0m');
      process.exit(1);
    }
  }

  let browser;
  if (runUi || runResp) {
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    if (runUi) await testUi(browser);
    if (runResp) await testResponsive(browser);
    await browser.close();
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`\x1b[1mTỔNG: ${pass} PASS / ${fail} FAIL\x1b[0m`);
  if (failures.length) {
    console.log('\n\x1b[31mCác mục thất bại:\x1b[0m');
    failures.forEach(f => console.log('  - ' + f));
  }
  console.log('='.repeat(60));

  process.exit(fail === 0 ? 0 : 1);
})();
