/**
 * sync-web.mjs — Đồng bộ web build (dist/) vào Android assets.
 *
 * Chạy:  node scripts/sync-web.mjs            (dùng dist/ hiện có)
 *        node scripts/sync-web.mjs --build    (chạy `npm run build` trước)
 *
 * v2 — web đã chuyển sang Tailwind v4 build tĩnh (src/index.css -> dist/assets/*.css):
 *   - KHÔNG còn tailwind-cdn.js, KHÔNG còn importmap esm.sh trong index.html
 *   - Script chỉ còn 3 việc: copy dist, đổi path tuyệt đối -> tương đối, chèn shim API
 *
 * Việc script làm:
 *  1. (tuỳ chọn) npm run build ở thư mục cha -> dist/
 *  2. Copy dist/ -> android/app/src/main/assets/www/
 *  3. Vá index.html:
 *     - Đổi src="/assets/..." và href="/assets/..." -> "./assets/..."
 *       (origin app là https://appassets.androidplatform.net, không phải root)
 *     - Chèn zgo-shim.js TRƯỚC module bundle để rewrite /api -> API_BASE
 *  4. Ghi www/zgo-shim.js với API_BASE cấu hình được
 *  5. Kiểm tra: phải có CSS tĩnh, không được còn CDN/importmap
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ANDROID_DIR = path.resolve(__dirname, '..');
const WEB_ROOT = path.resolve(ANDROID_DIR, '..');           // cuahangtienloizgo-master
const DIST = path.join(WEB_ROOT, 'dist');
const WWW = path.join(ANDROID_DIR, 'app', 'src', 'main', 'assets', 'www');

// Tài khoản Cloudflare mới (bangachieu2@gmail.com).
// Đổi từ cuahangtienloizgo.pages.dev vì tài khoản cũ cạn hạn mức D1 Free.
const API_BASE = process.env.ZGO_API_BASE || 'https://cuahangtienloizgo-efi.pages.dev';
const APP_HOST = 'appassets.androidplatform.net';

const doBuild = process.argv.includes('--build');

function log(...a) { console.log('[sync-web]', ...a); }
function fail(msg) { console.error('[sync-web] ERROR:', msg); process.exit(1); }

if (doBuild) {
  log('npm run build ...');
  execSync('npm run build', { cwd: WEB_ROOT, stdio: 'inherit', shell: true });
}

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  fail(`Không thấy ${path.join(DIST, 'index.html')} — chạy "npm run build" trước hoặc dùng --build`);
}

// ---- 1. Copy dist -> www ----
fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });
fs.cpSync(DIST, WWW, { recursive: true });
log('copied dist ->', WWW);

// ---- 2. Vá index.html ----
const indexPath = path.join(WWW, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

// Đường dẫn tuyệt đối -> tương đối (origin là https://appassets.androidplatform.net/assets/www/)
html = html.replace(/(src|href)="\/(?!\/)/g, '$1="./');

// Chèn shim trước module bundle
const shimTag = '<script src="./zgo-shim.js"></script>';
if (!html.includes('zgo-shim.js')) {
  if (html.includes('<script type="module"')) {
    html = html.replace('<script type="module"', shimTag + '\n  <script type="module"');
  } else {
    html = html.replace('</head>', shimTag + '\n</head>');
  }
}

fs.writeFileSync(indexPath, html, 'utf8');
log('patched index.html');

// ---- 3. Ghi shim ----
const shim = `/* zgo-shim.js — sinh tự động bởi scripts/sync-web.mjs, đừng sửa tay.
 * Mục đích: app chạy bundle local (origin https://${APP_HOST})
 * nhưng API nằm ở ${API_BASE}. Rewrite mọi request tương đối /api/... sang API_BASE.
 */
(function () {
  var API_BASE = ${JSON.stringify(API_BASE)};

  function rewrite(input) {
    try {
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      if (typeof url !== 'string') return input;
      if (url.indexOf('/api/') === 0 || url === '/api') {
        var abs = API_BASE + url;
        if (typeof input === 'string') return abs;
        try { return new Request(abs, input); } catch (e) { return abs; }
      }
      return input;
    } catch (e) { return input; }
  }

  // fetch
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  if (nativeFetch) {
    window.fetch = function (input, init) {
      return nativeFetch(rewrite(input), init);
    };
  }

  // XMLHttpRequest (xlsx / thư viện khác có thể dùng)
  var nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments);
    if (typeof url === 'string' && (url.indexOf('/api/') === 0 || url === '/api')) {
      args[1] = API_BASE + url;
    }
    return nativeOpen.apply(this, args);
  };

  // WebSocket — BẮT BUỘC rewrite, nếu không realtime không chạy trong app.
  // Trong WebView, location.host là appassets.androidplatform.net (chỉ phục vụ
  // file tĩnh), nên wss://appassets.../api/live sẽ nối vào hư không và app
  // âm thầm rơi về polling 5 giây. Đây là lý do bản APK chậm hơn trên web.
  var NativeWS = window.WebSocket;
  if (NativeWS) {
    var WS = function (url, protocols) {
      var target = url;
      try {
        var u = String(url);
        if (u.indexOf('/api/') === 0 || u.indexOf('ws://') === 0 || u.indexOf('wss://') === 0) {
          // Lấy phần path sau host (nếu có) rồi ghép vào API_BASE
          var path = u;
          if (u.indexOf('ws://') === 0 || u.indexOf('wss://') === 0) {
            var m = u.match(/^wss?:\\/\\/[^\\/]+(.*)$/);
            path = m ? m[1] : u;
          }
          var base = API_BASE.replace(/^http/, 'ws');
          target = base + path;
        }
      } catch (e) { target = url; }
      if (protocols === undefined) return new NativeWS(target);
      return new NativeWS(target, protocols);
    };
    WS.prototype = NativeWS.prototype;
    WS.CONNECTING = 0; WS.OPEN = 1; WS.CLOSING = 2; WS.CLOSED = 3;
    window.WebSocket = WS;
    console.log('[ZGO] WebSocket rewrite -> ' + API_BASE.replace(/^http/, 'ws'));
  }

  // Cờ nhận biết cho UI (nếu cần)
  window.__ZGO_NATIVE__ = { apiBase: API_BASE, platform: 'android-webview' };
  console.log('[ZGO] shim active, apiBase=' + API_BASE);
})();
`;
fs.writeFileSync(path.join(WWW, 'zgo-shim.js'), shim, 'utf8');
log('wrote zgo-shim.js (API_BASE=' + API_BASE + ')');

// ---- 4. Kiểm tra kết quả ----
const out = fs.readFileSync(indexPath, 'utf8');
const cssFiles = fs.readdirSync(path.join(WWW, 'assets')).filter(f => f.endsWith('.css'));
const jsFiles = fs.readdirSync(path.join(WWW, 'assets')).filter(f => f.endsWith('.js'));
const cssSize = cssFiles.length
  ? fs.statSync(path.join(WWW, 'assets', cssFiles[0])).size
  : 0;

// Bỏ comment HTML trước khi kiểm tra, tránh false-positive vì comment có nhắc
// tới "importmap esm.sh" / "cdn.tailwindcss.com" để giải thích.
const outNoComments = out.replace(/<!--[\s\S]*?-->/g, '');

const checks = {
  'css tĩnh tồn tại': cssFiles.length === 1 && cssSize > 10000,
  'js bundle tồn tại': jsFiles.length === 1,
  'không còn tailwind-cdn.js': !fs.existsSync(path.join(WWW, 'tailwind-cdn.js')),
  'không còn cdn.tailwindcss.com': !outNoComments.includes('cdn.tailwindcss.com'),
  'không còn importmap/esm.sh': !outNoComments.includes('esm.sh') && !outNoComments.includes('importmap'),
  'shim injected': out.includes('zgo-shim.js'),
  'path tương đối': !/(src|href)="\/(?!\/)/.test(outNoComments),
  'có viewport-fit=cover': out.includes('viewport-fit=cover')
};

// Shim phải rewrite WebSocket, nếu không realtime trong app sẽ chết im lặng
// và tự rơi về polling 5 giây (đây là lỗi từng gặp ở bản APK trước).
const shimText = fs.readFileSync(path.join(WWW, 'zgo-shim.js'), 'utf8');
checks['shim rewrite WebSocket'] = shimText.includes('window.WebSocket') && shimText.includes("replace(/^http/, 'ws')");

// Bundle nhúng phải TRÙNG BYTE với dist vừa build. Nếu lệch nghĩa là asset
// trong APK sinh từ một lần build khác (đã xảy ra: CSS trong APK có token
// --color-red-800 mà bản build hiện tại không sinh ra nữa).
const hashOf = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const distJs = fs.readdirSync(path.join(DIST, 'assets')).filter(f => f.endsWith('.js'));
const distCss = fs.readdirSync(path.join(DIST, 'assets')).filter(f => f.endsWith('.css'));
checks['js bundle khớp dist (byte-for-byte)'] =
  jsFiles.length === 1 && distJs.length === 1 &&
  hashOf(path.join(WWW, 'assets', jsFiles[0])) === hashOf(path.join(DIST, 'assets', distJs[0]));
checks['css bundle khớp dist (byte-for-byte)'] =
  cssFiles.length === 1 && distCss.length === 1 &&
  hashOf(path.join(WWW, 'assets', cssFiles[0])) === hashOf(path.join(DIST, 'assets', distCss[0]));

let ok = true;
for (const [k, v] of Object.entries(checks)) {
  log((v ? 'OK   ' : 'FAIL ') + k);
  if (!v) ok = false;
}
log('assets: js=' + jsFiles.join(',') + '  css=' + cssFiles.join(',') + ' (' + cssSize + ' B)');
log('www files:', fs.readdirSync(WWW, { recursive: true }).length);
if (!ok) fail('kiểm tra sau khi vá chưa đạt');
log('DONE');
