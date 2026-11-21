/* zgo-shim.js — sinh tự động bởi scripts/sync-web.mjs, đừng sửa tay.
 * Mục đích: app chạy bundle local (origin https://appassets.androidplatform.net)
 * nhưng API nằm ở https://cuahangtienloizgo-efi.pages.dev. Rewrite mọi request tương đối /api/... sang API_BASE.
 */
(function () {
  var API_BASE = "https://cuahangtienloizgo-efi.pages.dev";

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
            var m = u.match(/^wss?:\/\/[^\/]+(.*)$/);
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
