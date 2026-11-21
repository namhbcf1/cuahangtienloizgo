import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import { cors } from 'hono/cors'

type Bindings = {
    DB: D1Database
    /** Worker Durable Object đẩy tín hiệu realtime (xem realtime-worker/). */
    REALTIME?: { fetch: (req: Request) => Promise<Response> }
    /** Khoá ký token. Đặt bằng `wrangler secret put AUTH_SECRET`.
     *  Không có thì server tự sinh và lưu trong sync_meta (xem getAuthSecret). */
    AUTH_SECRET?: string
}

/** Thông tin người dùng gắn vào context sau khi xác thực token. */
type Session = { uid: string; role: string; exp: number }

type Env = { Bindings: Bindings; Variables: { session: Session } }

const app = new Hono<Env>().basePath('/api')

// Trình duyệt phải được phép gửi header Authorization, nếu không preflight
// sẽ chặn mọi lệnh ghi kèm token.
app.use('/*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
}))

// ---------- helpers ----------

/**
 * Báo cho mọi máy biết dữ liệu vừa đổi, để chúng gọi /api/sync ngay
 * thay vì đợi chu kỳ 5 giây.
 *
 * Không chặn response: nếu hub lỗi hoặc chưa cấu hình, bỏ qua — client vẫn
 * có chu kỳ dự phòng nên không mất dữ liệu.
 */
const broadcast = (env: Bindings, reason: string, ctx?: ExecutionContext) => {
    if (!env.REALTIME) return
    const url = `https://zgo-realtime.internal/broadcast?reason=${encodeURIComponent(reason)}`
    const task = env.REALTIME.fetch(new Request(url)).then(
        () => undefined,
        (e) => console.warn('broadcast failed:', errMessage(e)),
    )
    if (ctx) ctx.waitUntil(task)
}

/** D1 từ chối giá trị `undefined`; luôn quy về null để tránh D1_TYPE_ERROR. */
const nz = <T>(v: T | undefined | null): T | null => (v === undefined || v === null ? null : v)

/** Cột barcodes lưu dạng JSON text; API trả về mảng cho frontend. */
const parseBarcodes = (raw: unknown): string[] => {
    if (Array.isArray(raw)) return raw.map(String)
    if (typeof raw !== 'string' || !raw.trim()) return []
    try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
        return []
    }
}

const serializeBarcodes = (raw: unknown): string => JSON.stringify(parseBarcodes(raw))

/** Chuẩn hoá 1 row products: thêm costPrice (camelCase) + barcodes (mảng). */
const toProduct = (row: any) => ({
    ...row,
    cost_price: row.cost_price ?? 0,
    costPrice: row.cost_price ?? 0,
    barcodes: parseBarcodes(row.barcodes),
})

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

// ---------- xác thực: token ký HMAC-SHA256 ----------
//
// Trước đây /auth/login chỉ so PIN rồi trả {id,name,role} — không cấp gì để
// chứng minh danh tính ở các request sau. Hệ quả: mọi endpoint ghi
// (POST/PUT/DELETE) mở toang cho bất kỳ ai biết domain. Giờ login cấp token,
// mọi lệnh ghi bắt buộc kèm `Authorization: Bearer <token>`.

/**
 * Token KHÔNG HẾT HẠN.
 *
 * Token chỉ gồm `uid` + `role`, ký HMAC-SHA256 bằng AUTH_SECRET. Không có
 * trường `exp` nên không bao giờ hết hạn — máy bán hàng đăng nhập một lần rồi
 * chạy mãi.
 *
 * Vẫn thu hồi được, không phải "cấp phát vĩnh viễn không cửa đóng":
 *   - Đổi AUTH_SECRET (`wrangler pages secret put AUTH_SECRET`) là vô hiệu
 *     toàn bộ token cũ ngay lập tức.
 *   - Mỗi request vẫn tra `role` từ DB, nên nhân viên bị xoá / bị hạ quyền là
 *     mất hiệu lực tức thì (xem requireAuth).
 *   - Vẫn kiểm chữ ký, nên không thể tự chế token.
 */
const AUTH_SECRET_KEY = 'auth_secret'

const enc = new TextEncoder()

const b64url = (bytes: Uint8Array): string => {
    let bin = ''
    for (const b of bytes) bin += String.fromCharCode(b)
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const b64urlToBytes = (s: string): Uint8Array => {
    const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
}

/**
 * Khoá ký token.
 *
 * Ưu tiên secret do người triển khai đặt (`wrangler secret put AUTH_SECRET`).
 * Không có thì sinh ngẫu nhiên một lần và lưu vào sync_meta — nhờ vậy token
 * vẫn sống qua các lần cold start mà không cần cấu hình gì.
 */
const getAuthSecret = async (env: Bindings): Promise<string> => {
    if (env.AUTH_SECRET && env.AUTH_SECRET.length >= 16) return env.AUTH_SECRET

    try {
        await env.DB.prepare(
            'CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
        ).run()

        const row = await env.DB
            .prepare('SELECT value FROM sync_meta WHERE key = ?')
            .bind(AUTH_SECRET_KEY)
            .first<{ value: string }>()
        if (row?.value) return row.value

        const generated = b64url(crypto.getRandomValues(new Uint8Array(32)))
        await env.DB
            .prepare('INSERT OR IGNORE INTO sync_meta (key, value) VALUES (?, ?)')
            .bind(AUTH_SECRET_KEY, generated)
            .run()

        const again = await env.DB
            .prepare('SELECT value FROM sync_meta WHERE key = ?')
            .bind(AUTH_SECRET_KEY)
            .first<{ value: string }>()
        return again?.value ?? generated
    } catch {
        // DB chưa sẵn sàng: vẫn ký được nhưng token sẽ không qua được lần sau.
        return env.AUTH_SECRET ?? 'zgo-pos-dev-secret-do-not-use-in-production'
    }
}

const hmacKey = (secret: string) =>
    crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])

/** Ký token HS256 dạng `header.payload.signature`. Không có `exp` — không hết hạn. */
const signToken = async (env: Bindings, uid: string, role: string): Promise<string> => {
    const secret = await getAuthSecret(env)
    const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
    const payload = b64url(enc.encode(JSON.stringify({ uid, role })))
    const data = `${header}.${payload}`
    const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data))
    return `${data}.${b64url(new Uint8Array(sig))}`
}

/**
 * Kiểm chữ ký. Trả null nếu không hợp lệ.
 *
 * Token cũ CÓ trường `exp` vẫn được chấp nhận nếu chưa hết hạn — để bản APK
 * đang cài ngoài tiệm không bị đăng xuất hàng loạt khi deploy bản này.
 */
const verifyToken = async (env: Bindings, token: string): Promise<Session | null> => {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [header, payload, signature] = parts
    const secret = await getAuthSecret(env)

    let ok = false
    try {
        ok = await crypto.subtle.verify(
            'HMAC',
            await hmacKey(secret),
            b64urlToBytes(signature),
            enc.encode(`${header}.${payload}`),
        )
    } catch {
        return null
    }
    if (!ok) return null

    try {
        const body = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload))) as Session & { exp?: number }
        if (!body?.uid) return null
        // Chỉ kiểm hạn khi token có `exp` (token cũ). Token mới không có exp.
        if (typeof body.exp === 'number' && body.exp * 1000 < Date.now()) return null
        return { uid: body.uid, role: body.role, exp: body.exp ?? 0 }
    } catch {
        return null
    }
}

/** Đọc Bearer token từ header (hoặc `?token=` cho WebSocket không set header được). */
const readToken = (c: { req: { header: (n: string) => string | undefined; query: (n: string) => string | undefined } }) => {
    const auth = c.req.header('Authorization') ?? ''
    if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()
    return c.req.query('token') ?? ''
}

/**
 * Cache vai trò theo uid, TTL 30 giây.
 *
 * Vì token KHÔNG hết hạn, mỗi request phải xác nhận user còn tồn tại — nếu
 * không, xoá một nhân viên sẽ không cắt được quyền truy cập của máy họ đang
 * giữ token. Truy vấn này rẻ (1 row), nhưng /sync gọi mỗi 5 giây nên vẫn cache
 * 30 giây cho nhẹ hạn mức D1. Xoá user thì có hiệu lực trong tối đa 30 giây.
 */
const roleCache = new Map<string, { role: string; at: number }>()
const ROLE_CACHE_MS = 30_000

const lookupRole = async (db: D1Database, uid: string): Promise<string | null> => {
    const hit = roleCache.get(uid)
    if (hit && Date.now() - hit.at < ROLE_CACHE_MS) return hit.role

    const row = await db
        .prepare('SELECT role FROM users WHERE id = ?')
        .bind(uid)
        .first<{ role: string }>()
    if (!row) {
        roleCache.delete(uid)
        return null
    }
    roleCache.set(uid, { role: row.role, at: Date.now() })
    return row.role
}

/**
 * Middleware: bắt buộc token hợp lệ.
 * `roles` rỗng = mọi nhân viên đã đăng nhập.
 *
 * Luôn tra lại DB để biết user còn tồn tại và vai trò hiện tại — đây là cơ chế
 * thu hồi quyền cho token không hết hạn.
 */
const requireAuth = (roles?: string[]) => async (c: any, next: () => Promise<void>) => {
    const session = await verifyToken(c.env, readToken(c))
    if (!session) return c.json({ error: 'Cần đăng nhập' }, 401)

    const db: D1Database = c.env.DB
    const role = await lookupRole(db, session.uid)
    if (!role) {
        // Nhân viên đã bị xoá: token còn chữ ký hợp lệ nhưng không còn quyền.
        return c.json({ error: 'Cần đăng nhập' }, 401)
    }
    if (roles && roles.length > 0 && !roles.includes(role)) {
        return c.json({ error: 'Không đủ quyền' }, 403)
    }

    session.role = role
    c.set('session', session)
    await next()
}

// ---------- cổng xác thực ----------
//
// Đặt TRƯỚC mọi route. Chỉ hai thứ được gọi khi chưa đăng nhập:
//   GET  /users       — màn đăng nhập cần danh sách để chọn (chỉ id/name/role)
//   POST /auth/login  — đương nhiên
//
// /check và /live cũng bắt buộc token: /check trả doanh thu, tiền mặt trong ca,
// tên nhân viên — không phải dữ liệu công khai. Service Android lấy token do
// trang web lưu qua cầu nối `ZGO.saveToken()` lúc đăng nhập (xem MainActivity).
//
// Mọi lệnh ghi đều bắt buộc token; riêng bảng users chỉ ADMIN.

app.use('/products', requireAuth())
app.use('/products/*', requireAuth())
app.use('/shifts', requireAuth())
app.use('/shifts/*', requireAuth())
app.use('/transactions', requireAuth())
app.use('/transactions/*', requireAuth())
app.use('/sync', requireAuth())
app.use('/check', requireAuth())
app.use('/count', requireAuth())
app.use('/live', requireAuth())

// Danh sách nhân viên cho màn đăng nhập: mở cho GET đúng đường dẫn /api/users
// (chỉ trả id/name/role, không có PIN). Mọi method khác và mọi đường dẫn con
// đều phải là ADMIN.
const usersGate = async (c: any, next: () => Promise<void>) => {
    if (c.req.method === 'GET' && c.req.path === '/api/users') return next()
    return requireAuth(['ADMIN'])(c, next)
}
app.use('/users', usersGate)
app.use('/users/*', usersGate)

/**
 * Phiên bản dữ liệu sản phẩm.
 *
 * KHÔNG còn quét cả bảng products (837 row mỗi lần gọi — đây là thứ đốt
 * hạn mức D1 Free nhanh nhất). Giờ chỉ đọc 1 row từ bảng sync_meta, và giá trị
 * đó được tăng mỗi khi có thay đổi sản phẩm.
 */
const productsVersion = async (db: D1Database): Promise<string> => {
    const row = await db
        .prepare("SELECT value FROM sync_meta WHERE key = 'products_version'")
        .first<{ value: string }>()
    return row?.value ?? '1'
}

/** Tăng phiên bản sản phẩm. Gọi sau mọi thao tác ghi vào bảng products. */
const bumpProductsVersion = async (db: D1Database): Promise<void> => {
    await db
        .prepare("UPDATE sync_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'products_version'")
        .run()
    // Cache thống kê cũng phải bỏ vì tồn kho đổi
    await db.prepare("UPDATE sync_meta SET value = '' WHERE key = 'stats_cache'").run()
}

/** Bỏ cache thống kê (gọi sau khi có giao dịch mới). */
const invalidateStats = async (db: D1Database): Promise<void> => {
    await db.prepare("UPDATE sync_meta SET value = '' WHERE key = 'stats_cache'").run()
}

/** Thống kê mặc định khi cache trống. */
type Stats = { totalCount: number; totalRevenue: number; todayRevenue: number; todayCount: number }

const EMPTY_STATS: Stats = { totalCount: 0, totalRevenue: 0, todayRevenue: 0, todayCount: 0 }

/**
 * Thống kê doanh thu, có cache trong sync_meta.
 *
 * Trước đây mỗi lần đồng bộ đều COUNT + SUM toàn bảng transactions (1.817 row).
 * Giờ chỉ tính lại khi cache trống (sau khi bán hàng) hoặc quá 60 giây.
 */
const getStats = async (db: D1Database): Promise<Stats> => {
    const row = await db
        .prepare("SELECT value FROM sync_meta WHERE key = 'stats_cache'")
        .first<{ value: string }>()

    if (row?.value) {
        try {
            const cached = JSON.parse(row.value) as Stats & { at?: number }
            if (cached.at && Date.now() - cached.at < 60_000) {
                return {
                    totalCount: cached.totalCount,
                    totalRevenue: cached.totalRevenue,
                    todayRevenue: cached.todayRevenue,
                    todayCount: cached.todayCount,
                }
            }
        } catch {
            /* cache hỏng: tính lại */
        }
    }

    const start = todayStartIso()
    const fresh = await db
        .prepare(
            `SELECT COUNT(*) AS totalCount,
                    COALESCE(SUM(total), 0) AS totalRevenue,
                    COALESCE(SUM(CASE WHEN date >= ? THEN total ELSE 0 END), 0) AS todayRevenue,
                    COALESCE(SUM(CASE WHEN date >= ? THEN 1 ELSE 0 END), 0) AS todayCount
             FROM transactions`
        )
        .bind(start, start)
        .first<any>()

    const stats: Stats = {
        totalCount: Number(fresh?.totalCount ?? 0),
        totalRevenue: Number(fresh?.totalRevenue ?? 0),
        todayRevenue: Number(fresh?.todayRevenue ?? 0),
        todayCount: Number(fresh?.todayCount ?? 0),
    }

    await db
        .prepare("UPDATE sync_meta SET value = ? WHERE key = 'stats_cache'")
        .bind(JSON.stringify({ ...stats, at: Date.now() }))
        .run()

    return stats
}

/**
 * Đồng bộ gọn cho client.
 *
 * Query:
 *   pv     — phiên bản products client đang giữ; trùng thì server KHÔNG gửi lại
 *            (đây là thứ giảm băng thông từ 164 KB xuống ~0)
 *   after  — mốc thời gian giao dịch cuối client đã có; chỉ gửi đơn mới hơn
 *
 * Trả về:
 *   pv          — phiên bản products hiện tại
 *   products    — chỉ có khi `pv` khác hoặc client chưa có
 *   shifts      — luôn gửi (2 KB, cần cho đối soát ca)
 *   transactions— chỉ đơn mới hơn `after`
 *   stats       — tổng hợp tính ở server (client không cần tải hết 1.817 đơn)
 *   now         — giờ server để client làm mốc cho lần sau
 */
app.get('/sync', async (c) => {
    try {
        const db = c.env.DB
        const clientPv = c.req.query('pv') ?? ''
        const after = c.req.query('after') ?? ''
        const shiftId = c.req.query('shiftId') ?? ''

        const pv = await productsVersion(db)
        const productsChanged = clientPv !== pv

        const products = productsChanged
            ? (await db.prepare('SELECT * FROM products').all()).results.map(toProduct)
            : null

        const { results: shifts } = await db.prepare('SELECT * FROM shifts').all()

        // Chỉ lấy đơn mới hơn mốc. Lần đầu (after rỗng) lấy 50 đơn gần nhất
        // để hiện lịch sử, không kéo cả 1.800 đơn.
        let txQuery: string
        let txBinds: unknown[]
        if (after) {
            txQuery = 'SELECT * FROM transactions WHERE date > ? ORDER BY date ASC LIMIT 200'
            txBinds = [after]
        } else {
            txQuery = 'SELECT * FROM transactions ORDER BY date DESC LIMIT 50'
            txBinds = []
        }

        let transactions = (await db.prepare(txQuery).bind(...txBinds).all()).results as any[]

        // Có shiftId -> lấy đủ đơn của ca đó (dùng cho màn tổng kết ca)
        if (shiftId) {
            transactions = (
                await db.prepare('SELECT * FROM transactions WHERE shiftId = ? ORDER BY date ASC LIMIT 500')
                    .bind(shiftId)
                    .all()
            ).results as any[]
        }

        // Ghép items cho các đơn sắp trả về (1 truy vấn/lô, không N+1).
        // Phải chia lô: nhánh `after` lấy tới 200 đơn -> 201 tham số bind,
        // vượt giới hạn của D1 ("too many SQL variables").
        const ids = transactions.map((t) => t.id)
        const items = await fetchItemsFor(db, ids)

        const enriched = transactions.map((t) => ({
            ...t,
            items: items.filter((i) => i.transactionId === t.id),
        }))

        // Tổng hợp ở server, có cache — không quét toàn bảng mỗi lần đồng bộ
        const stats = await getStats(db)

        return c.json({
            pv,
            products,
            shifts,
            transactions: enriched,
            stats,
            now: new Date().toISOString(),
        })
    } catch (e) {
        return c.json({ error: errMessage(e) }, 500)
    }
})

/**
 * Endpoint gọn cho service Android ở nền.
 *
 * Trước đây service gọi /api/transactions mỗi 30 giây — quét toàn bảng 1.817
 * row, riêng việc đó đã vượt hạn mức D1 Free. Endpoint này chỉ trả những gì
 * service cần, và dùng index + cache nên chỉ đọc vài row.
 */
app.get('/check', async (c) => {
    try {
        const db = c.env.DB

        // Đơn mới nhất: dùng index date, đọc 1 row
        const latest = await db
            .prepare('SELECT id, date, total, cashierName FROM transactions ORDER BY date DESC LIMIT 1')
            .first<any>()

        // 5 đơn gần nhất để báo "đơn hàng mới"
        const { results: recent } = await db
            .prepare(
                `SELECT t.id, t.date, t.total, t.cashierName,
                        (SELECT COUNT(*) FROM transaction_items i WHERE i.transactionId = t.id) AS itemKinds,
                        (SELECT COALESCE(SUM(i.quantity), 0) FROM transaction_items i WHERE i.transactionId = t.id) AS quantity
                 FROM transactions t ORDER BY t.date DESC LIMIT 5`
            )
            .all()

        // Ca đang mở: bảng nhỏ (10 row), không đáng lo
        const { results: openShifts } = await db
            .prepare("SELECT * FROM shifts WHERE status = 'OPEN'")
            .all()

        // Thống kê (đã cache): 1 row
        const stats = await getStats(db)

        // Tồn kho: cache 5 phút vì đếm hết hàng phải quét bảng products
        const stockAlert = await getStockAlert(db)

        return c.json({
            latestId: latest?.id ?? null,
            recent,
            openShifts,
            stats,
            stockAlert,
            now: new Date().toISOString(),
        })
    } catch (e) {
        return c.json({ error: errMessage(e) }, 500)
    }
})

/**
 * Đếm đơn mới nằm NGOÀI cửa sổ 5 dòng mà /check trả về.
 *
 * /check chỉ trả 5 đơn gần nhất. Khi máy POS bán liên tục (hoặc service ngủ,
 * mạng đứt), số đơn mới có thể nhiều hơn 5 và phần dư sẽ bị mốc `last_tx_id`
 * nuốt mất — tức là mất đơn, sót thông báo. Service gọi endpoint này để biết
 * tổng số đơn mới rồi báo phần dư thành một dòng tổng hợp.
 *
 *   after  = id đơn cuối cùng đã báo (mốc cũ)
 *   before = id đơn mới nhất hiện có
 *
 * id là `Date.now().toString()` (xem POS.handleCheckout) nên so sánh chuỗi có
 * đúng thứ tự thời gian. COUNT bọc subquery có LIMIT 500 để một lần lỗi đồng hồ
 * không đếm cả bảng; quá 500 thì báo "500+", đủ để người dùng biết đang sót.
 */
app.get('/count', async (c) => {
    try {
        const after = c.req.query('after') ?? ''
        const before = c.req.query('before') ?? ''

        const row = await c.env.DB
            .prepare(
                `SELECT COUNT(*) AS n FROM (
                    SELECT id FROM transactions
                    WHERE id < ?1 AND id > ?2
                    LIMIT 500
                 )`
            )
            .bind(before, after)
            .first<any>()

        return c.json({ count: Number(row?.n ?? 0) })
    } catch (e) {
        return c.json({ error: errMessage(e) }, 500)
    }
})

type StockAlert = { outOfStock: number; worstName: string | null; worstStock: number }

/**
 * Đếm hàng hết và tìm mặt hàng tồn âm nặng nhất.
 *
 * Quét bảng products (837 row) nên phải cache. Chỉ tính lại khi cache cũ hơn
 * 5 phút hoặc khi phiên bản sản phẩm đổi (tức là vừa có bán/nhập hàng).
 */
const getStockAlert = async (db: D1Database): Promise<StockAlert> => {
    const row = await db
        .prepare("SELECT value FROM sync_meta WHERE key = 'stock_cache'")
        .first<{ value: string }>()

    if (row?.value) {
        try {
            const cached = JSON.parse(row.value) as StockAlert & { at?: number; pv?: string }
            const pv = await productsVersion(db)
            // Còn mới và dữ liệu chưa đổi -> dùng cache
            if (cached.at && Date.now() - cached.at < 300_000 && cached.pv === pv) {
                return {
                    outOfStock: cached.outOfStock,
                    worstName: cached.worstName,
                    worstStock: cached.worstStock,
                }
            }
        } catch {
            /* cache hỏng: tính lại */
        }
    }

    const fresh = await db
        .prepare(
            `SELECT COUNT(*) AS outOfStock,
                    COALESCE(MIN(stock), 0) AS worstStock
             FROM products WHERE stock <= 0`
        )
        .first<any>()

    let worstName: string | null = null
    if (Number(fresh?.outOfStock ?? 0) > 0) {
        const w = await db
            .prepare('SELECT name FROM products WHERE stock <= 0 ORDER BY stock ASC LIMIT 1')
            .first<{ name: string }>()
        worstName = w?.name ?? null
    }

    const alert: StockAlert = {
        outOfStock: Number(fresh?.outOfStock ?? 0),
        worstName,
        worstStock: Number(fresh?.worstStock ?? 0),
    }

    const pv = await productsVersion(db)
    await db
        .prepare("INSERT INTO sync_meta (key, value) VALUES ('stock_cache', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(JSON.stringify({ ...alert, at: Date.now(), pv }))
        .run()

    return alert
}

/**
 * WebSocket realtime: chuyển tiếp kết nối từ trình duyệt vào Durable Object hub.
 *
 * Client nối tới /api/live, nhận tín hiệu {type:'changed'} mỗi khi có dữ liệu
 * mới, rồi tự gọi /api/sync để tải phần thay đổi (chỉ vài KB).
 *
 * Nếu chưa cấu hình REALTIME, trả 503 — client tự quay về chu kỳ 5 giây.
 */
app.get('/live', async (c) => {
    if (!c.env.REALTIME) {
        return c.json({ error: 'Realtime chưa được cấu hình' }, 503)
    }
    if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
        return c.json({ error: 'Cần header Upgrade: websocket' }, 426)
    }
    // Chuyển nguyên request sang hub, giữ header Upgrade.
    return c.env.REALTIME.fetch(new Request('https://zgo-realtime.internal/', c.req.raw))
})

/** Mốc 00:00 hôm nay theo giờ Việt Nam (UTC+7), dạng ISO để so với cột date. */
const todayStartIso = (): string => {
    const now = new Date()
    // Dịch sang giờ VN rồi lấy ngày, sau đó trả về đúng thời điểm 00:00 VN.
    const vn = new Date(now.getTime() + 7 * 60 * 60 * 1000)
    const y = vn.getUTCFullYear()
    const m = String(vn.getUTCMonth() + 1).padStart(2, '0')
    const d = String(vn.getUTCDate()).padStart(2, '0')
    return new Date(`${y}-${m}-${d}T00:00:00+07:00`).toISOString()
}

// --- Users ---
app.get('/users', async (c) => {
    try {
        // Không trả `pin` ra ngoài: trước đây bất kỳ ai gọi endpoint này đều
        // đọc được PIN của toàn bộ nhân viên.
        const { results } = await c.env.DB.prepare('SELECT id, name, role FROM users').all()
        return c.json(results)
    } catch (e) {
        return c.json({ error: errMessage(e) }, 500)
    }
})

// Đăng nhập bằng PIN, xác thực ở server thay vì so sánh trong trình duyệt.
// Trả kèm token: mọi lệnh ghi sau đó phải gửi `Authorization: Bearer <token>`.
app.post('/auth/login', async (c) => {
    try {
        const body = await c.req.json().catch(() => null)
        const id = body?.id ? String(body.id) : ''
        const pin = body?.pin ? String(body.pin) : ''
        if (!id || !pin) return c.json({ error: 'Thiếu mã nhân viên hoặc PIN' }, 400)

        const user = await c.env.DB
            .prepare('SELECT id, name, role, pin FROM users WHERE id = ?')
            .bind(id)
            .first<{ id: string; name: string; role: string; pin: string }>()

        if (!user || user.pin !== pin) {
            return c.json({ error: 'Mã PIN không đúng' }, 401)
        }

        const token = await signToken(c.env, user.id, user.role)

        return c.json({
            id: user.id,
            name: user.name,
            role: user.role,
            token,
            // Token không hết hạn: 0 = vô hạn. Giữ tên trường để client cũ đọc được.
            expiresIn: 0,
            // Trường này giữ để tương thích bản APK 1.2.0 đang cài: nó lưu
            // `deviceToken` cho service nền. Giờ chỉ còn một loại token.
            deviceToken: token,
            deviceExpiresIn: 0,
        })
    } catch (e) {
        return c.json({ error: errMessage(e) }, 500)
    }
})

/**
 * Gia hạn token.
 *
 * Từ nay token không hết hạn nên endpoint này chỉ để client cũ (bản 1.1.0 /
 * 1.2.0 đang cài ngoài tiệm) gọi và nhận token mới không hạn. Giữ lại để
 * không phá bản đang chạy.
 */
app.post('/auth/refresh', async (c) => {
    try {
        const session = await verifyToken(c.env, readToken(c))
        if (!session) return c.json({ error: 'Token không hợp lệ' }, 401)

        const row = await c.env.DB
            .prepare('SELECT id, name, role FROM users WHERE id = ?')
            .bind(session.uid)
            .first<{ id: string; name: string; role: string }>()
        if (!row) return c.json({ error: 'Tài khoản không còn tồn tại' }, 401)

        const token = await signToken(c.env, row.id, row.role)
        return c.json({
            token,
            id: row.id,
            name: row.name,
            role: row.role,
            expiresIn: 0,
        })
    } catch (e) {
        return c.json({ error: errMessage(e) }, 500)
    }
})

app.post('/users', async (c) => {
    try {
        const user = await c.req.json()
        await c.env.DB.prepare('INSERT INTO users (id, name, role, pin) VALUES (?, ?, ?, ?)')
            .bind(user.id, user.name, user.role, user.pin)
            .run()
        broadcast(c.env, 'users', c.executionCtx)
        return c.json(user, 201)
    } catch (e) {
        return c.json({ error: errMessage(e) }, 500)
    }
})

app.put('/users/:id', async (c) => {
    const id = c.req.param('id')
    try {
        const user = await c.req.json()
        await c.env.DB.prepare('UPDATE users SET name=?, role=?, pin=? WHERE id=?')
            .bind(user.name, user.role, user.pin, id)
            .run()
        // Đổi vai trò phải có hiệu lực ngay, không chờ cache hết hạn.
        roleCache.delete(id)
        broadcast(c.env, 'users', c.executionCtx)
        return c.json({ ...user, id })
    } catch (e) {
        return c.json({ error: errMessage(e) }, 500)
    }
})

app.delete('/users/:id', async (c) => {
    const id = c.req.param('id')
    try {
        await c.env.DB.prepare('DELETE FROM users WHERE id=?').bind(id).run()
        // Xoá cache vai trò: nếu để 30 giây, nhân viên vừa bị xoá vẫn dùng được
        // token trong khoảng đó. Thu hồi quyền phải có hiệu lực ngay.
        roleCache.delete(id)
        broadcast(c.env, 'users', c.executionCtx)
        return c.json({ success: true })
    } catch (e) {
        return c.json({ error: errMessage(e) }, 500)
    }
})

// --- Products ---
app.get('/products', async (c) => {
    try {
        const { results } = await c.env.DB.prepare('SELECT * FROM products').all()
        return c.json((results as any[]).map(toProduct))
    } catch (e) {
        return c.json({ error: errMessage(e) }, 500)
    }
})

app.post('/products', async (c) => {
    try {
        const p = await c.req.json()
        if (!p?.id || !p?.name) return c.json({ error: 'Thiếu mã hàng hoặc tên sản phẩm' }, 400)

        await c.env.DB.prepare(
            `INSERT INTO products (id, name, price, cost_price, category, stock, unit, image, barcodes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
            .bind(
                p.id,
                p.name,
                Number(p.price) || 0,
                Number(p.costPrice ?? p.cost_price) || 0,
                nz(p.category),
                Number(p.stock) || 0,
                nz(p.unit),
                nz(p.image),
                serializeBarcodes(p.barcodes),
            )
            .run()

        broadcast(c.env, 'products', c.executionCtx)
        await bumpProductsVersion(c.env.DB)
        return c.json(toProduct({ ...p, barcodes: serializeBarcodes(p.barcodes) }), 201)
    } catch (e) {
        return c.json({ error: errMessage(e) }, 500)
    }
})

app.put('/products/:id', async (c) => {
    const id = c.req.param('id')
    try {
        const p = await c.req.json()

        // Kiểm tra ở server, không tin client: giá âm hoặc tên rỗng là dữ liệu
        // hỏng, sẽ làm sai mọi báo cáo doanh thu/lợi nhuận về sau.
        if (typeof p?.name !== 'string' || !p.name.trim()) {
            return c.json({ error: 'Tên sản phẩm không được để trống' }, 400)
        }
        const price = Number(p.price)
        if (!Number.isFinite(price) || price < 0) {
            return c.json({ error: 'Giá bán không hợp lệ' }, 400)
        }
        const cost = Number(p.costPrice ?? p.cost_price) || 0
        if (!Number.isFinite(cost) || cost < 0) {
            return c.json({ error: 'Giá vốn không hợp lệ' }, 400)
        }

        await c.env.DB.prepare(
            `UPDATE products SET name=?, price=?, cost_price=?, category=?, stock=?, unit=?, image=?, barcodes=?
             WHERE id=?`
        )
            .bind(
                p.name.trim(),
                price,
                cost,
                nz(p.category),
                Number(p.stock) || 0,
                nz(p.unit),
                nz(p.image),
                serializeBarcodes(p.barcodes),
                id,
            )
            .run()

        broadcast(c.env, 'products', c.executionCtx)
        await bumpProductsVersion(c.env.DB)
        return c.json(toProduct({ ...p, id, barcodes: serializeBarcodes(p.barcodes) }))
    } catch (e) {
        return c.json({ error: errMessage(e) }, 500)
    }
})

/**
 * Xoá một sản phẩm khỏi kho (chỉ ADMIN).
 *
 * Cố ý KHÔNG xoá cứng nếu sản phẩm đã từng bán: transaction_items giữ
 * productId để đối soát doanh thu/lợi nhuận. Xoá cứng sẽ làm mồ côi lịch sử.
 * Có 2 chế độ:
 *   - mặc định: chặn nếu đã có giao dịch (409) để người dùng biết mà chọn
 *   - ?force=1 : vẫn cho xoá, lịch sử cũ giữ nguyên (báo cáo đọc theo tên
 *               và giá đã lưu trong transaction_items, không đọc lại products)
 */
app.delete('/products/:id', requireAuth(['ADMIN']), async (c) => {
    const id = c.req.param('id')
    const force = c.req.query('force') === '1'
    try {
        const product = await c.env.DB.prepare('SELECT id, name FROM products WHERE id = ?')
            .bind(id)
            .first<{ id: string; name: string }>()
        if (!product) return c.json({ error: 'Không tìm thấy sản phẩm' }, 404)

        const sold = await c.env.DB.prepare(
            'SELECT count(*) AS n FROM transaction_items WHERE productId = ?'
        )
            .bind(id)
            .first<{ n: number }>()
        const soldCount = Number(sold?.n) || 0

        if (soldCount > 0 && !force) {
            return c.json(
                {
                    error: `Sản phẩm đã bán ${soldCount} lần, không xoá để giữ lịch sử`,
                    soldCount,
                },
                409,
            )
        }

        await c.env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run()

        broadcast(c.env, 'products', c.executionCtx)
        await bumpProductsVersion(c.env.DB)
        return c.json({ id, name: product.name, deleted: true, soldCount })
    } catch (e) {
        return c.json({ error: errMessage(e) }, 500)
    }
})

/**
 * Import hàng loạt từ Excel.
 * Body: { products: Array<{id, name, price, costPrice, category, stock, unit, barcodes}> }
 * - id đã tồn tại  -> UPDATE
 * - id mới, nhưng có barcode trùng sản phẩm khác -> UPDATE sản phẩm đó
 * - còn lại -> INSERT
 */
app.post('/products/bulk-upsert', async (c) => {
    try {
        const body = await c.req.json().catch(() => null)
        const items: any[] = Array.isArray(body?.products) ? body.products : []

        if (items.length === 0) {
            return c.json({ error: 'Danh sách sản phẩm trống' }, 400)
        }

        // Bản đồ barcode -> product id hiện có, để nhận ra "cùng một món, mã khác".
        const { results: existingRows } = await c.env.DB.prepare(
            'SELECT id, barcodes FROM products'
        ).all()

        const idSet = new Set<string>()
        const barcodeToId = new Map<string, string>()
        for (const row of existingRows as any[]) {
            idSet.add(row.id)
            for (const bc of parseBarcodes(row.barcodes)) barcodeToId.set(bc, row.id)
        }

        const inserts: any[] = []
        const updates: any[] = []
        const seenIds = new Set<string>()

        for (const raw of items) {
            const id = raw?.id ? String(raw.id).trim() : ''
            if (!id) continue
            if (seenIds.has(id)) continue
            seenIds.add(id)

            const incomingBarcodes = parseBarcodes(raw.barcodes)
            const matchedByBarcode = incomingBarcodes
                .map(bc => barcodeToId.get(bc))
                .find(target => target && target !== id)

            const record = {
                id,
                name: raw.name ? String(raw.name) : '',
                price: Number(raw.price) || 0,
                cost: Number(raw.costPrice ?? raw.cost_price) || 0,
                category: raw.category ? String(raw.category) : '',
                stock: Number(raw.stock) || 0,
                unit: raw.unit ? String(raw.unit) : 'cái',
                barcodes: incomingBarcodes,
            }

            if (idSet.has(id)) {
                updates.push({ ...record, targetId: id, merge: true })
            } else if (matchedByBarcode) {
                // Mã hàng đổi nhưng barcode phụ khớp -> cập nhật sản phẩm cũ,
                // giữ nguyên id cũ để lịch sử giao dịch không bị mồ côi.
                updates.push({ ...record, targetId: matchedByBarcode, merge: true })
            } else {
                inserts.push(record)
            }
        }

        const statements: D1PreparedStatement[] = []

        for (const r of inserts) {
            statements.push(
                c.env.DB.prepare(
                    `INSERT INTO products (id, name, price, cost_price, category, stock, unit, barcodes)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(r.id, r.name, r.price, r.cost, r.category, r.stock, r.unit, serializeBarcodes(r.barcodes))
            )
        }

        for (const r of updates) {
            statements.push(
                c.env.DB.prepare(
                    `UPDATE products
                     SET name=?, price=?, cost_price=?, category=?, stock=?, unit=?, barcodes=?
                     WHERE id=?`
                ).bind(r.name, r.price, r.cost, r.category, r.stock, r.unit, serializeBarcodes(r.barcodes), r.targetId)
            )
        }

        if (statements.length > 0) await c.env.DB.batch(statements)

        await bumpProductsVersion(c.env.DB)
        broadcast(c.env, 'products', c.executionCtx)
        return c.json({ inserted: inserts.length, updated: updates.length })
    } catch (e) {
        return c.json({ error: errMessage(e) }, 500)
    }
})

// --- Shifts ---
app.get('/shifts', async (c) => {
    try {
        const { results } = await c.env.DB.prepare('SELECT * FROM shifts').all()
        return c.json(results)
    } catch (e) {
        return c.json({ error: errMessage(e) }, 500)
    }
})

app.post('/shifts', async (c) => {
    try {
        const s = await c.req.json()
        await c.env.DB.prepare(
            `INSERT INTO shifts (id, userId, userName, startTime, endTime, startCash, cashSales, expectedCash, endCash, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
            .bind(
                s.id,
                s.userId,
                nz(s.userName),
                s.startTime,
                nz(s.endTime),
                Number(s.startCash) || 0,
                Number(s.cashSales) || 0,
                Number(s.expectedCash) || 0,
                nz(s.endCash),
                s.status,
            )
            .run()
        broadcast(c.env, 'shifts', c.executionCtx)
        return c.json(s, 201)
    } catch (e) {
        return c.json({ error: errMessage(e) }, 500)
    }
})

app.put('/shifts/:id', async (c) => {
    const id = c.req.param('id')
    try {
        const s = await c.req.json()
        // Ca đang mở không có endTime/endCash -> undefined. D1 ném D1_TYPE_ERROR
        // nếu bind undefined, nên phải quy về null trước khi ghi.
        await c.env.DB.prepare(
            `UPDATE shifts SET endTime=?, endCash=?, expectedCash=?, cashSales=?, status=? WHERE id=?`
        )
            .bind(
                nz(s.endTime),
                nz(s.endCash),
                Number(s.expectedCash) || 0,
                Number(s.cashSales) || 0,
                s.status,
                id,
            )
            .run()
        broadcast(c.env, 'shifts', c.executionCtx)
        return c.json({ ...s, id })
    } catch (e) {
        return c.json({ error: errMessage(e) }, 500)
    }
})

// --- Transactions ---

/**
 * Bộ lọc lịch sử giao dịch dùng chung cho mọi truy vấn bên dưới.
 *
 * `from`/`to` là mốc ISO đầy đủ (client tự tính theo giờ máy), nên server
 * không phải đoán múi giờ: 00:00 ngày A ở Việt Nam đã được quy ra UTC sẵn.
 * Đây là thứ bảo đảm "tiền ngày nào đúng ngày ấy" — doanh thu của một ngày
 * được SUM trên toàn bộ đơn trong khoảng đó, không phải trên trang đang xem.
 */
type TxFilter = {
    /** Mốc ISO đầy đủ (tương thích cũ). */
    from?: string
    to?: string
    /** Ngày theo lịch cửa hàng, dạng YYYY-MM-DD — ưu tiên dùng thay cho from/to. */
    fromDay?: string
    toDay?: string
    shiftId?: string
    /** Con trỏ keyset: chỉ lấy đơn cũ hơn mốc này (phân trang "Tải thêm"). */
    before?: string
    beforeId?: string
}

/**
 * Mốc ISO của 00:00 một ngày theo giờ Việt Nam.
 *
 * Ngày do người dùng chọn trong ô lọc là ngày *lịch của cửa hàng*, không phải
 * ngày theo múi giờ của máy đang mở app. Server tự quy đổi nên dù máy đặt sai
 * múi giờ, "doanh thu ngày 20/11" vẫn đúng là của ngày 20/11 ở Việt Nam.
 */
const vnDayStartIso = (day: string): string | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
    const d = new Date(`${day}T00:00:00+07:00`)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Mốc ISO của 00:00 ngày KẾ TIẾP — dùng làm biên trên độc quyền (`date < ?`). */
const vnNextDayStartIso = (day: string): string | null => {
    const start = vnDayStartIso(day)
    if (!start) return null
    return new Date(new Date(start).getTime() + 86_400_000).toISOString()
}

const buildTxWhere = (f: TxFilter, includeCursor: boolean): { sql: string; binds: unknown[] } => {
    const clauses: string[] = []
    const binds: unknown[] = []

    // Ngày lịch (VN) được ưu tiên; from/to ISO chỉ còn để tương thích.
    const from = f.fromDay ? vnDayStartIso(f.fromDay) : f.from
    const toExclusive = f.toDay ? vnNextDayStartIso(f.toDay) : null

    if (toExclusive) {
        // Biên trên độc quyền: `date < 00:00 ngày kế tiếp` phủ trọn ngày cuối,
        // kể cả đơn 23:59:59.999 — không phụ thuộc việc chọn `<= 23:59:59`.
        clauses.push('date < ?')
        binds.push(toExclusive)
    } else if (f.to) {
        clauses.push('date <= ?')
        binds.push(f.to)
    }
    if (from) {
        clauses.push('date >= ?')
        binds.push(from)
    }
    if (f.shiftId) {
        clauses.push('shiftId = ?')
        binds.push(f.shiftId)
    }
    // Keyset: id là Date.now().toString() nên so chuỗi cùng độ dài là đúng
    // thứ tự; dùng id làm khoá phụ khi nhiều đơn trùng mốc mili-giây.
    if (includeCursor && f.before) {
        if (f.beforeId) {
            clauses.push('(date < ? OR (date = ? AND id < ?))')
            binds.push(f.before, f.before, f.beforeId)
        } else {
            clauses.push('date < ?')
            binds.push(f.before)
        }
    }

    return {
        sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
        binds,
    }
}

const readTxFilter = (c: any): TxFilter => ({
    from: c.req.query('from') || undefined,
    to: c.req.query('to') || undefined,
    fromDay: c.req.query('fromDay') || undefined,
    toDay: c.req.query('toDay') || undefined,
    shiftId: c.req.query('shiftId') || undefined,
    before: c.req.query('before') || undefined,
    beforeId: c.req.query('beforeId') || undefined,
})

/** Kẹp số đơn một trang để một request không kéo cả bảng. */
const clampLimit = (raw: unknown, fallback = 50, max = 200): number => {
    const n = Math.floor(Number(raw))
    if (!Number.isFinite(n) || n <= 0) return fallback
    return Math.min(n, max)
}

/** D1 giới hạn ~100 tham số bind một câu; chia lô để không vượt "too many SQL variables". */
const ID_CHUNK = 90

/**
 * Lấy items cho danh sách đơn — chia lô theo ID_CHUNK.
 *
 * Trước đây ghép tất cả id vào một câu `IN (...)`; với trang 200 đơn (201 id)
 * D1 báo "too many SQL variables at offset 256". Chia lô giữ truy vấn nhỏ và
 * ổn định với mọi kích thước trang.
 */
const fetchItemsFor = async (db: D1Database, ids: string[]): Promise<any[]> => {
    if (ids.length === 0) return []
    const out: any[] = []
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
        const chunk = ids.slice(i, i + ID_CHUNK)
        const placeholders = chunk.map(() => '?').join(',')
        const { results } = await db
            .prepare(`SELECT * FROM transaction_items WHERE transactionId IN (${placeholders})`)
            .bind(...chunk)
            .all()
        out.push(...(results as any[]))
    }
    return out
}

/**
 * Tổng số đơn + doanh thu của TOÀN BỘ tập lọc (không phải của một trang).
 *
 * Đây là con số hiển thị trên màn lịch sử: dù danh sách mới tải 50 đơn đầu,
 * "Đơn hàng" và "Doanh thu" vẫn là của cả khoảng ngày đã chọn.
 */
const txTotals = async (db: D1Database, f: TxFilter) => {
    // Không lọc gì -> dùng cache thống kê sẵn có, khỏi quét bảng mỗi lần mở.
    if (!f.from && !f.to && !f.fromDay && !f.toDay && !f.shiftId) {
        const stats = await getStats(db)
        return { count: stats.totalCount, revenue: stats.totalRevenue }
    }

    const where = buildTxWhere(f, false)
    const row = await db
        .prepare(
            `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS revenue
             FROM transactions ${where.sql}`
        )
        .bind(...where.binds)
        .first<any>()

    return { count: Number(row?.count ?? 0), revenue: Number(row?.revenue ?? 0) }
}

/**
 * Lịch sử giao dịch có phân trang "Tải thêm" (keyset, không OFFSET).
 *
 * Cursor thay vì OFFSET vì đơn mới luôn chen lên đầu: dùng OFFSET thì trang 2
 * có thể lặp hoặc sót một đơn giữa hai lần bấm. Keyset chỉ lấy đơn *cũ hơn*
 * mốc cuối danh sách nên danh sách đang xem không bao giờ bị xáo.
 *
 * Trả về:
 *   transactions  — tối đa `limit` đơn, mới nhất trước
 *   hasMore       — còn đơn cũ hơn để tải tiếp
 *   nextBefore / nextBeforeId — con trỏ cho lần "Tải thêm" kế tiếp
 *   count / revenue — tổng của CẢ tập lọc (xem chú thích ở buildTxWhere)
 */
app.get('/transactions/history', async (c) => {
    try {
        const db = c.env.DB
        const f = readTxFilter(c)
        const limit = clampLimit(c.req.query('limit'))

        const where = buildTxWhere(f, true)
        // Lấy dư 1 đơn để biết còn trang sau hay không, khỏi COUNT thêm lần nữa.
        const rows = (
            await db
                .prepare(
                    `SELECT * FROM transactions ${where.sql}
                     ORDER BY date DESC, id DESC LIMIT ?`
                )
                .bind(...where.binds, limit + 1)
                .all()
        ).results as any[]

        const hasMore = rows.length > limit
        const page = hasMore ? rows.slice(0, limit) : rows

        // Ghép items cho đúng số đơn của trang (1 truy vấn/lô, không N+1)
        const ids = page.map((t) => t.id)
        const items = await fetchItemsFor(db, ids)

        const transactions = page.map((t) => ({
            ...t,
            items: items.filter((i) => i.transactionId === t.id),
        }))

        const totals = await txTotals(db, f)

        return c.json({
            transactions,
            hasMore,
            nextBefore: hasMore ? page[page.length - 1]?.date ?? null : null,
            nextBeforeId: hasMore ? page[page.length - 1]?.id ?? null : null,
            count: totals.count,
            revenue: totals.revenue,
        })
    } catch (e) {
        return c.json({ error: errMessage(e) }, 500)
    }
})

/**
 * Tổng hợp tiền của một tập lọc — dùng cho màn tổng kết ca và banner ca đang
 * làm. Tính bằng SUM trên SQL nên không phụ thuộc số đơn client đang giữ.
 */
app.get('/transactions/summary', async (c) => {
    try {
        const db = c.env.DB
        const f = readTxFilter(c)
        // Bắt buộc phải có phạm vi: summary của toàn bộ cửa hàng đã có trong
        // /sync (stats), gọi ở đây chỉ để lấy theo ca hoặc theo ngày.
        if (!f.shiftId && !f.from && !f.to && !f.fromDay && !f.toDay) {
            return c.json({ error: 'Cần shiftId hoặc khoảng ngày' }, 400)
        }

        const where = buildTxWhere(f, false)
        const row = await db
            .prepare(
                `SELECT COUNT(*) AS count,
                        COALESCE(SUM(total), 0) AS revenue,
                        COALESCE(SUM(CASE WHEN paymentMethod = 'CASH' THEN total ELSE 0 END), 0) AS cash,
                        COALESCE(SUM(CASE WHEN paymentMethod = 'CARD' THEN total ELSE 0 END), 0) AS card,
                        COALESCE(SUM(CASE WHEN paymentMethod = 'TRANSFER' THEN total ELSE 0 END), 0) AS transfer
                 FROM transactions ${where.sql}`
            )
            .bind(...where.binds)
            .first<any>()

        return c.json({
            count: Number(row?.count ?? 0),
            revenue: Number(row?.revenue ?? 0),
            cash: Number(row?.cash ?? 0),
            card: Number(row?.card ?? 0),
            transfer: Number(row?.transfer ?? 0),
        })
    } catch (e) {
        return c.json({ error: errMessage(e) }, 500)
    }
})

/**
 * Doanh thu theo từng ngày (giờ Việt Nam).
 *
 * Gom nhóm ngay trong SQL bằng `date + 7 giờ` nên một ngày ở đây là đúng
 * ngày theo lịch của cửa hàng, kể cả đơn bán lúc 23h30 (UTC vẫn là hôm trước).
 * Dùng cho bảng "tiền ngày nào đúng ngày ấy" ở màn lịch sử.
 */
app.get('/transactions/daily', async (c) => {
    try {
        const db = c.env.DB
        const f = readTxFilter(c)
        const where = buildTxWhere(f, false)

        const { results } = await db
            .prepare(
                `SELECT substr(datetime(date, '+7 hours'), 1, 10) AS day,
                        COUNT(*) AS count,
                        COALESCE(SUM(total), 0) AS revenue,
                        COALESCE(SUM(CASE WHEN paymentMethod = 'CASH' THEN total ELSE 0 END), 0) AS cash,
                        COALESCE(SUM(CASE WHEN paymentMethod = 'CARD' THEN total ELSE 0 END), 0) AS card,
                        COALESCE(SUM(CASE WHEN paymentMethod = 'TRANSFER' THEN total ELSE 0 END), 0) AS transfer
                 FROM transactions ${where.sql}
                 GROUP BY day
                 ORDER BY day DESC`
            )
            .bind(...where.binds)
            .all()

        return c.json({
            days: (results as any[]).map((d) => ({
                day: d.day,
                count: Number(d.count ?? 0),
                revenue: Number(d.revenue ?? 0),
                cash: Number(d.cash ?? 0),
                card: Number(d.card ?? 0),
                transfer: Number(d.transfer ?? 0),
            })),
        })
    } catch (e) {
        return c.json({ error: errMessage(e) }, 500)
    }
})

app.get('/transactions', async (c) => {
    try {
        const { results: transactions } = await c.env.DB.prepare('SELECT * FROM transactions').all()
        const { results: items } = await c.env.DB.prepare('SELECT * FROM transaction_items').all()

        const enriched = (transactions as any[]).map((t) => ({
            ...t,
            items: (items as any[]).filter((i) => i.transactionId === t.id),
        }))

        return c.json(enriched)
    } catch (e) {
        return c.json({ error: errMessage(e) }, 500)
    }
})

app.post('/transactions', async (c) => {
    try {
        const t = await c.req.json()
        const items: any[] = Array.isArray(t?.items) ? t.items : []
        if (items.length === 0) return c.json({ error: 'Đơn hàng không có sản phẩm' }, 400)
        if (!t?.id) return c.json({ error: 'Thiếu mã giao dịch' }, 400)

        // Idempotency: nếu đã có giao dịch cùng id (client gửi lại do mạng chập),
        // trả luôn 200 và KHÔNG trừ kho lần thứ hai.
        const existing = await c.env.DB
            .prepare('SELECT id FROM transactions WHERE id = ?')
            .bind(t.id)
            .first()
        if (existing) {
            return c.json({ ...t, duplicated: true }, 200)
        }

        // Chặn bán vượt tồn ở tầng server: client có thể bị sửa hoặc dữ liệu
        // tồn đã cũ. Cho phép bán khi tồn đang âm (dữ liệu lịch sử) nhưng
        // không được làm âm thêm quá số đang có.
        const need = new Map<string, number>()
        for (const item of items) {
            const id = String(item.productId)
            need.set(id, (need.get(id) ?? 0) + (Number(item.quantity) || 0))
        }

        const { results: stockRows } = await c.env.DB
            .prepare(`SELECT id, name, stock FROM products WHERE id IN (${[...need.keys()].map(() => '?').join(',')})`)
            .bind(...need.keys())
            .all()

        const stockById = new Map<string, { name: string; stock: number }>()
        for (const row of stockRows as any[]) {
            stockById.set(row.id, { name: row.name, stock: Number(row.stock) || 0 })
        }

        const shortages: string[] = []
        for (const [id, qty] of need) {
            const p = stockById.get(id)
            if (!p) { shortages.push(`${id}: không tồn tại`); continue }
            // Tồn âm sẵn (dữ liệu cũ) thì cho bán tiếp, chỉ chặn khi bán vượt
            // quá số lượng đang có mà tồn đang dương.
            if (p.stock > 0 && qty > p.stock) {
                shortages.push(`${p.name}: còn ${p.stock}, cần ${qty}`)
            }
        }

        if (shortages.length > 0) {
            return c.json({ error: `Không đủ tồn kho — ${shortages.join('; ')}` }, 409)
        }

        const batch: D1PreparedStatement[] = [
            c.env.DB.prepare(
                'INSERT INTO transactions (id, date, total, paymentMethod, shiftId, cashierName) VALUES (?, ?, ?, ?, ?, ?)'
            ).bind(t.id, t.date, Number(t.total) || 0, t.paymentMethod, nz(t.shiftId), nz(t.cashierName)),
        ]

        for (const item of items) {
            batch.push(
                c.env.DB.prepare(
                    'INSERT INTO transaction_items (transactionId, productId, name, price, cost_price, quantity) VALUES (?, ?, ?, ?, ?, ?)'
                ).bind(
                    t.id,
                    item.productId,
                    nz(item.name),
                    Number(item.price) || 0,
                    nz(item.costPrice ?? item.cost_price),
                    Number(item.quantity) || 0,
                )
            )
            batch.push(
                c.env.DB.prepare('UPDATE products SET stock = stock - ? WHERE id = ?')
                    .bind(Number(item.quantity) || 0, item.productId)
            )
        }

        if (t.shiftId && t.paymentMethod === 'CASH') {
            batch.push(
                c.env.DB.prepare('UPDATE shifts SET cashSales = cashSales + ? WHERE id = ?')
                    .bind(Number(t.total) || 0, t.shiftId)
            )
        }

        await c.env.DB.batch(batch)

        // Tồn kho và doanh thu đã đổi -> phiên bản sản phẩm tăng, cache thống kê bỏ
        await bumpProductsVersion(c.env.DB)

        // Đẩy tín hiệu để mọi máy cập nhật ngay, không đợi chu kỳ 5 giây.
        broadcast(c.env, 'transactions', c.executionCtx)
        return c.json(t, 201)
    } catch (e) {
        return c.json({ error: errMessage(e) }, 500)
    }
})

export const onRequest = handle(app)
