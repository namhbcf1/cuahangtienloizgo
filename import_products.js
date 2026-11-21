import * as XLSX from 'xlsx';
import * as fs from 'fs';

/**
 * Sinh seed_products.sql từ "Products (4).xlsx".
 *
 * Ba lỗi của bản cũ đã được sửa:
 *  1. Tên hàng chứa \r\n làm câu INSERT bị xuống dòng -> file SQL gãy, chỉ import được
 *     phần đầu. Nay newline được gộp thành khoảng trắng.
 *  2. "INSERT OR REPLACE" không liệt kê cột barcodes/image nên REPLACE xoá trắng 2 cột đó.
 *     Nay dùng ON CONFLICT DO UPDATE, chỉ ghi các cột có trong Excel.
 *  3. Không kiểm tra header: nếu Excel đổi tên cột, script im lặng sinh 0 dòng.
 *     Nay báo lỗi rõ ràng kèm danh sách cột thực tế.
 */

const XLSX_PATH = 'Products (4).xlsx';
const OUT_PATH = 'seed_products.sql';

// Tên cột chuẩn + biến thể, để script báo lỗi rõ thay vì lặng lẽ ra 0 dòng.
const FIELDS = {
    id: ['Mã hàng hóa', 'Mã hàng hoá', 'Mã sản phẩm', 'Mã SP'],
    name: ['Tên hàng hóa', 'Tên hàng hoá', 'Tên sản phẩm'],
    category: ['Tên nhóm', 'Nhóm hàng', 'Danh mục'],
    unit: ['ĐVT', 'Đơn vị tính'],
    price: ['Giá bán'],
    cost: ['Giá vốn'],
    stock: ['Tồn kho'],
};

const text = (v, fallback = '') => {
    if (v === undefined || v === null) return fallback;
    return String(v)
        .replace(/\r\n|\r|\n/g, ' ') // newline trong tên hàng làm gãy câu SQL
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/'/g, "''");
};

const num = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

// ---------- đọc file ----------
if (!fs.existsSync(XLSX_PATH)) {
    console.error(`Không tìm thấy file: ${XLSX_PATH}`);
    process.exit(1);
}

const workbook = XLSX.read(fs.readFileSync(XLSX_PATH), { type: 'buffer' });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
if (!sheet) {
    console.error(`Sheet rỗng: ${XLSX_PATH}`);
    process.exit(1);
}

// ---------- kiểm tra header ----------
const headerRow = (XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })[0] || [])
    .map(h => (h === null ? '' : String(h).trim()));

const resolved = {};
const missing = [];
for (const [field, aliases] of Object.entries(FIELDS)) {
    const hit = aliases.find(a => headerRow.includes(a));
    if (hit) resolved[field] = hit;
    else missing.push(`  - ${field}: không có cột nào trong [${aliases.join(' | ')}]`);
}

if (missing.length) {
    console.error('Header Excel không khớp. Thiếu:');
    console.error(missing.join('\n'));
    console.error(`\nHeader thực tế: ${headerRow.filter(Boolean).join(' | ')}`);
    process.exit(1);
}

// ---------- dựng dữ liệu ----------
const data = XLSX.utils.sheet_to_json(sheet, { defval: null });

const rows = [];
const seen = new Set();
const dupes = [];
const skipped = [];
let withCategory = 0;

for (const raw of data) {
    const id = text(raw[resolved.id]);
    const name = text(raw[resolved.name]);

    if (!id || !name) {
        skipped.push(id || name || '(dòng trống)');
        continue;
    }
    if (seen.has(id)) {
        dupes.push(id);
        continue;
    }
    seen.add(id);

    const category = text(raw[resolved.category]);
    if (category) withCategory++;

    rows.push({
        id,
        name,
        price: num(raw[resolved.price]),
        cost: num(raw[resolved.cost]),
        category,
        stock: num(raw[resolved.stock]),
        unit: text(raw[resolved.unit], 'cái'),
    });
}

// ---------- sinh SQL ----------
// ON CONFLICT thay vì REPLACE: chỉ ghi các cột có trong Excel,
// giữ nguyên barcodes / image đang có trong DB.
const statements = rows.map(r =>
    `INSERT INTO products (id, name, price, cost_price, category, stock, unit) ` +
    `VALUES ('${r.id}', '${r.name}', ${r.price}, ${r.cost}, '${r.category}', ${r.stock}, '${r.unit}') ` +
    `ON CONFLICT(id) DO UPDATE SET ` +
    `name=excluded.name, price=excluded.price, cost_price=excluded.cost_price, ` +
    `category=excluded.category, stock=excluded.stock, unit=excluded.unit;`
);

fs.writeFileSync(OUT_PATH, statements.join('\n') + '\n', 'utf8');

// ---------- báo cáo ----------
console.log(`Sheet            : ${workbook.SheetNames[0]}`);
console.log(`Dòng trong Excel : ${data.length}`);
console.log(`Đã sinh          : ${rows.length} câu lệnh -> ${OUT_PATH}`);
console.log(`Có nhóm hàng     : ${withCategory}`);
console.log(`Không có nhóm    : ${rows.length - withCategory}`);
if (skipped.length) console.warn(`Bỏ qua (thiếu mã/tên): ${skipped.length} -> ${skipped.slice(0, 5).join(', ')}`);
if (dupes.length) console.warn(`Mã trùng, chỉ lấy dòng đầu: ${dupes.length} -> ${dupes.slice(0, 5).join(', ')}`);
