import * as XLSX from 'xlsx';
import * as fs from 'fs';

const buf = fs.readFileSync('Products (4).xlsx');
const workbook = XLSX.read(buf, { type: 'buffer' });
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const headers = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0];
const data = XLSX.utils.sheet_to_json(sheet).slice(0, 2); // Get first 2 rows for type inference

console.log('Headers:', JSON.stringify(headers));
console.log('Sample Data:', JSON.stringify(data, null, 2));
