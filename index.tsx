import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Tailwind v4 build tĩnh. Trước đây file này chưa từng được import nên
// `dist/` không có file CSS nào và toàn bộ giao diện phụ thuộc CDN lúc chạy.
import './src/index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
