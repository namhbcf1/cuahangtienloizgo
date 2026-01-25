import * as XLSX from 'xlsx';
import * as fs from 'fs';

const buf = fs.readFileSync('Products (4).xlsx');
const workbook = XLSX.read(buf, { type: 'buffer' });
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const data = XLSX.utils.sheet_to_json(sheet);

let sqlPoints = [];

// "Mã hàng hóa","Tên hàng hóa","Tên nhóm","ĐVT","Giá trị quy đổi","Giá bán","Giá bán ĐVT Lớn","Giá vốn","Tồn kho"

for (const p of data) {
    const id = p['Mã hàng hóa'];
    const name = p['Tên hàng hóa']?.replace(/'/g, "''") || '';
    const category = p['Tên nhóm']?.replace(/'/g, "''") || '';
    const unit = p['ĐVT']?.replace(/'/g, "''") || 'cái';
    const price = p['Giá bán'] || 0;
    const costPrice = p['Giá vốn'] || 0;
    const stock = p['Tồn kho'] || 0;

    // Simple verification
    if (!id || !name) continue;

    sqlPoints.push(`INSERT OR REPLACE INTO products (id, name, price, cost_price, category, stock, unit) VALUES ('${id}', '${name}', ${price}, ${costPrice}, '${category}', ${stock}, '${unit}');`);
}

// Write to seed.sql
fs.writeFileSync('seed_products.sql', sqlPoints.join('\n'));
console.log(`Generated ${sqlPoints.length} insert statements.`);
