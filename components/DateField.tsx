
import React, { useRef } from 'react';
import { Calendar } from 'lucide-react';
import { formatDayKey } from '../utils/date';

interface DateFieldProps {
  /** Giá trị thật, dạng `YYYY-MM-DD` (rỗng = chưa chọn). */
  value: string;
  onChange: (value: string) => void;
  /** Chữ hiện khi chưa chọn ngày. */
  placeholder?: string;
  title?: string;
  /** Lớp bổ sung cho khung ngoài. */
  className?: string;
  ariaLabel?: string;
}

/**
 * Ô chọn ngày luôn hiển thị DD/MM/YYYY.
 *
 * `<input type="date">` của trình duyệt tự hiển thị theo ngôn ngữ máy — máy cài
 * en-US sẽ ra `mm/dd/yyyy` dù đã đặt `lang`. Vì vậy input thật chỉ dùng để mở
 * lịch (nằm trong suốt đè lên), còn chữ hiển thị do mình vẽ từ `formatDayKey`.
 * Cách này vẫn giữ được lịch chọn ngày gốc và cả nhập bằng bàn phím.
 */
export const DateField: React.FC<DateFieldProps> = ({
  value,
  onChange,
  placeholder = 'dd/mm/yyyy',
  title,
  className = '',
  ariaLabel,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    const el = inputRef.current;
    if (!el) return;
    try {
      // Chrome/Edge: mở bảng lịch ngay tại ô.
      el.showPicker();
    } catch {
      // Trình duyệt cũ không có showPicker: focus/click để nó tự mở.
      el.focus();
      el.click();
    }
  };

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <button
        type="button"
        onClick={openPicker}
        title={title}
        aria-label={ariaLabel}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-slate-50 text-sm font-medium transition-colors"
      >
        <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
        <span className={value ? 'text-slate-700 tabular-nums' : 'text-slate-400'}>
          {value ? formatDayKey(value) : placeholder}
        </span>
      </button>

      {/* Input thật: trong suốt, không bắt chuột — chỉ để mở lịch và nhận giá trị. */}
      <input
        ref={inputRef}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        tabIndex={-1}
        aria-hidden="true"
        className="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
      />
    </div>
  );
};
