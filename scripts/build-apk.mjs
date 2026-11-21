#!/usr/bin/env node
/**
 * Build APK Android từ web hiện tại — một lệnh duy nhất.
 *
 *   npm run apk              # build release APK + AAB
 *   node scripts/build-apk.mjs --debug
 *
 * Tự động:
 *   1. Kiểm tra JDK 17 + Android SDK
 *   2. Build web (vite build)
 *   3. Chạy test tự động (bỏ qua bằng --skip-test)
 *   4. Sync web vào project Android
 *   5. Gradle assembleRelease + bundleRelease
 *   6. In SHA256 + đường dẫn file
 *
 * Không cần mở Android Studio.
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ANDROID_DIR = join(ROOT, 'android');
const JDK = process.env.JAVA_HOME || 'C:\\AndroidBuild\\jdk-17.0.20.1+1';
const SDK = process.env.ANDROID_HOME || 'C:\\AndroidBuild\\sdk';

const args = process.argv.slice(2);
const debugOnly = args.includes('--debug');
const skipTest = args.includes('--skip-test');

const step = (n, t) => console.log(`\n\x1b[1m[${n}] ${t}\x1b[0m`);
const ok = (t) => console.log(`  \x1b[32m✓\x1b[0m ${t}`);
const bad = (t) => { console.error(`  \x1b[31m✗\x1b[0m ${t}`); process.exit(1); };

const run = (cmd, cwd = ROOT, shell = true) => {
  const r = spawnSync(cmd, { cwd, shell, stdio: 'inherit', env: { ...process.env, JAVA_HOME: JDK, ANDROID_HOME: SDK, ANDROID_SDK_ROOT: SDK } });
  if (r.status !== 0) bad(`Lệnh thất bại: ${cmd}`);
};

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').toUpperCase();
const mb = (p) => (statSync(p).size / 1024 / 1024).toFixed(2);

// ---------- 1. Môi trường ----------
step(1, 'Kiểm tra môi trường');
if (!existsSync(join(JDK, 'bin', 'javac.exe'))) bad(`Không thấy JDK 17 tại ${JDK}\n  Đặt biến JAVA_HOME hoặc cài Temurin 17.`);
ok(`JDK: ${JDK}`);
if (!existsSync(join(SDK, 'platforms'))) bad(`Không thấy Android SDK tại ${SDK}\n  Đặt biến ANDROID_HOME.`);
ok(`SDK: ${SDK}`);
if (!existsSync(ANDROID_DIR)) bad(`Không thấy thư mục android/ trong ${ROOT}`);

// ---------- 2. Build web ----------
step(2, 'Build web (vite)');
run('npm run build');
ok('dist/ đã build');

// ---------- 3. Test ----------
if (!skipTest) {
  step(3, 'Chạy kiểm thử tự động');
  console.log('  (bỏ qua bằng --skip-test)');
  const port = 8788;
  const { spawn } = await import('node:child_process');
  const server = spawn('npx', ['wrangler', 'pages', 'dev', 'dist', '--port', String(port)], {
    cwd: ROOT, shell: true, stdio: 'ignore',
  });

  // chờ server lên
  let up = false;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const res = await fetch(`http://127.0.0.1:${port}`);
      if (res.ok) { up = true; break; }
    } catch { /* chưa lên */ }
  }

  if (!up) {
    server.kill();
    bad('Server test không khởi động được');
  }

  const test = spawnSync('node', ['scripts/verify.mjs'], { cwd: ROOT, shell: true, stdio: 'inherit' });
  server.kill();

  if (test.status !== 0) bad('Kiểm thử thất bại — KHÔNG build APK. Sửa lỗi rồi chạy lại.');
  ok('Toàn bộ test PASS');
} else {
  step(3, 'Bỏ qua kiểm thử (--skip-test)');
}

// ---------- 4. Sync web vào Android ----------
step(4, 'Sync web vào project Android');
if (existsSync(join(ANDROID_DIR, 'scripts', 'sync-web.mjs'))) {
  run('node scripts/sync-web.mjs', ANDROID_DIR);
  ok('Đã sync dist/ → android/app/src/main/assets/www/');
} else {
  bad('Không thấy android/scripts/sync-web.mjs');
}

// ---------- 5. Gradle ----------
step(5, 'Gradle build');
const gradlew = join(ANDROID_DIR, 'gradlew.bat');
if (!existsSync(gradlew)) bad(`Không thấy ${gradlew}`);

// Kiểm tra drift: asset trong android/ phải trùng byte với dist/ vừa build.
// Nếu lệch, APK sẽ đóng gói một bản web khác với bản đã test ở bước 3.
step('5a', 'Kiểm tra assets/www khớp dist/');
{
  const WWW = join(ANDROID_DIR, 'app', 'src', 'main', 'assets', 'www');
  const DIST = join(ROOT, 'dist');
  const hash = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
  const pairs = [
    ['assets/www/assets js', join(WWW, 'assets'), join(DIST, 'assets'), '.js'],
    ['assets/www/assets css', join(WWW, 'assets'), join(DIST, 'assets'), '.css'],
  ];
  for (const [label, wwwDir, distDir, ext] of pairs) {
    const pick = (d) => readdirSync(d).filter((f) => f.endsWith(ext));
    const w = pick(wwwDir);
    const d = pick(distDir);
    if (w.length !== 1 || d.length !== 1) bad(`${label}: số file bất thường (www=${w.length}, dist=${d.length})`);
    if (hash(join(wwwDir, w[0])) !== hash(join(distDir, d[0]))) {
      bad(`${label}: ${w[0]} KHÁC ${d[0]} — asset trong APK không sinh từ dist hiện tại`);
    }
    ok(`${label}: ${w[0]} khớp byte`);
  }
}

const task = debugOnly ? 'assembleDebug' : 'assembleRelease bundleRelease';
run(`"${gradlew}" --no-daemon ${task}`, ANDROID_DIR);
ok(`Gradle xong: ${task}`);

// ---------- 6. Kết quả ----------
step(6, 'Kết quả');
const outputs = debugOnly
  ? [join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')]
  : [
    join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
    join(ANDROID_DIR, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab'),
  ];

let missing = false;
for (const f of outputs) {
  if (!existsSync(f)) { console.log(`  \x1b[31m✗ Không thấy ${f}\x1b[0m`); missing = true; continue; }
  console.log(`  \x1b[32m✓\x1b[0m ${f}`);
  console.log(`      ${mb(f)} MB   SHA256 ${sha256(f)}`);
}
if (missing) bad('Thiếu file đầu ra');

console.log(`\n\x1b[1mXong.\x1b[0m Cài lên máy: adb install -r "${outputs[0]}"`);
