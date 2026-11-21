/**
 * ZGO Realtime Hub — Durable Object đẩy tín hiệu "có thay đổi" tới mọi máy.
 *
 * Vì sao cần: Cloudflare Pages KHÔNG cho tạo Durable Object trong project Pages
 * (docs ghi rõ "You cannot create and deploy a Durable Object within a Pages
 * project"). Nên hub này là một Worker riêng, được bind vào Pages qua service
 * binding.
 *
 * Dùng WebSocket Hibernation API:
 *  - Khi không có tin nhắn, Durable Object ngủ -> không tính giờ chạy.
 *  - Không dùng Hibernation thì một kết nối mở liên tục bị tính 128 MB × toàn
 *    bộ thời gian, vượt hạn mức 13.000 GB-giây/ngày của gói Free.
 *
 * Giao thức rất đơn giản: server không gửi dữ liệu, chỉ gửi tín hiệu.
 * Client nhận tín hiệu rồi tự gọi /api/sync để lấy phần dữ liệu nhỏ đã thay đổi.
 */

export interface Env {
  REALTIME: DurableObjectNamespace;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

export class RealtimeHub implements DurableObject {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // --- WebSocket: máy khách kết nối để nhận tín hiệu ---
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // Hibernation: đăng ký nhận sự kiện nhưng KHÔNG giữ object thức
      this.state.acceptWebSocket(server);

      // Gửi ngay một tín hiệu để client đồng bộ lúc vừa nối
      try {
        server.send(JSON.stringify({ type: 'changed', reason: 'hello' }));
      } catch {
        /* client đóng ngay: bỏ qua */
      }

      return new Response(null, { status: 101, webSocket: client });
    }

    // --- HTTP: Pages gọi vào đây khi có thay đổi dữ liệu ---
    if (url.pathname.endsWith('/broadcast')) {
      const reason = url.searchParams.get('reason') ?? 'change';
      const sent = this.broadcast({ type: 'changed', reason, at: new Date().toISOString() });
      return new Response(JSON.stringify({ ok: true, sent }), { headers: JSON_HEADERS });
    }

    if (url.pathname.endsWith('/status')) {
      const sockets = this.state.getWebSockets();
      return new Response(
        JSON.stringify({ connections: sockets.length, at: new Date().toISOString() }),
        { headers: JSON_HEADERS }
      );
    }

    return new Response('Not found', { status: 404 });
  }

  /** Hibernation: được gọi khi có tin nhắn từ client. */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Client gửi "ping" để giữ kết nối; trả lời gọn để không tốn thời gian chạy.
    const text = typeof message === 'string' ? message : '';
    if (text === 'ping') {
      try { ws.send('pong'); } catch { /* bỏ qua */ }
    }
  }

  /** Hibernation: dọn dẹp khi kết nối đóng — không cần giữ trạng thái. */
  async webSocketClose(_ws: WebSocket): Promise<void> {}

  async webSocketError(_ws: WebSocket): Promise<void> {}

  /** Gửi tín hiệu tới mọi máy đang kết nối. Trả về số máy đã gửi. */
  private broadcast(payload: unknown): number {
    const text = JSON.stringify(payload);
    let sent = 0;
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(text);
        sent++;
      } catch {
        /* kết nối đã chết: bỏ qua, lần sau nó tự nối lại */
      }
    }
    return sent;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Mọi máy trong một cửa hàng dùng chung một hub -> cùng một DO id.
    const id = env.REALTIME.idFromName('zgo-store');
    const stub = env.REALTIME.get(id);

    // Chuyển tiếp nguyên request (WebSocket nâng cấp hoặc HTTP) vào DO.
    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;