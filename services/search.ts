/**
 * Chuẩn hoá chuỗi để tìm kiếm tiếng Việt không dấu.
 *
 * "Mỳ trộn" -> "my tron"  nên gõ "my tron" vẫn tìm ra.
 * Áp dụng cho CẢ hai phía (chuỗi sản phẩm và từ khoá người dùng gõ),
 * nên gõ có dấu tìm chuỗi không dấu và ngược lại đều được.
 */
export const normalizeForSearch = (input: string): string => {
  if (!input) return '';
  return input
    // Tách dấu ra khỏi ký tự gốc (ò -> o + dấu huyền)
    .normalize('NFD')
    // Bỏ toàn bộ dấu kết hợp
    .replace(/[\u0300-\u036f]/g, '')
    // đ/Đ không tách được bằng NFD nên phải thay riêng
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    // Gộp khoảng trắng thừa để "my   tron" vẫn khớp "my tron"
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Kiểm tra một chuỗi có chứa từ khoá hay không, bỏ qua dấu và hoa/thường.
 * Từ khoá rỗng luôn khớp.
 */
export const matchesKeyword = (haystack: string | undefined | null, keyword: string): boolean => {
  const needle = normalizeForSearch(keyword);
  if (!needle) return true;
  return normalizeForSearch(haystack ?? '').includes(needle);
};
