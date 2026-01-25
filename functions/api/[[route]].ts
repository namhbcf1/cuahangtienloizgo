import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import { cors } from 'hono/cors'

type Bindings = {
    DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>().basePath('/api')

app.use('/*', cors())

// --- Users ---
app.get('/users', async (c) => {
    try {
        const { results } = await c.env.DB.prepare('SELECT * FROM users').all()
        return c.json(results)
    } catch (e) {
        return c.json({ error: e.message }, 500)
    }
})

app.post('/users', async (c) => {
    try {
        const user = await c.req.json()
        await c.env.DB.prepare('INSERT INTO users (id, name, role, pin) VALUES (?, ?, ?, ?)').bind(user.id, user.name, user.role, user.pin).run()
        return c.json(user, 201)
    } catch (e) {
        return c.json({ error: e.message }, 500)
    }
})

app.put('/users/:id', async (c) => {
    const id = c.req.param('id')
    const user = await c.req.json()
    await c.env.DB.prepare('UPDATE users SET name=?, role=?, pin=? WHERE id=?').bind(user.name, user.role, user.pin, id).run()
    return c.json(user)
})

app.delete('/users/:id', async (c) => {
    const id = c.req.param('id')
    await c.env.DB.prepare('DELETE FROM users WHERE id=?').bind(id).run()
    return c.json({ success: true })
})

// --- Products ---
app.get('/products', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM products').all()
    return c.json(results)
})

app.post('/products', async (c) => {
    const p = await c.req.json()
    await c.env.DB.prepare('INSERT INTO products (id, name, price, cost_price, category, stock, unit, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(p.id, p.name, p.price, p.costPrice || 0, p.category, p.stock, p.unit, p.image).run()
    return c.json(p, 201)
})

app.put('/products/:id', async (c) => {
    const id = c.req.param('id')
    const p = await c.req.json()
    await c.env.DB.prepare('UPDATE products SET name=?, price=?, cost_price=?, category=?, stock=?, unit=?, image=? WHERE id=?')
        .bind(p.name, p.price, p.costPrice || 0, p.category, p.stock, p.unit, p.image, id).run()
    return c.json(p)
})

// --- Shifts ---
app.get('/shifts', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM shifts').all()
    return c.json(results)
})

app.post('/shifts', async (c) => {
    try {
        const s = await c.req.json()
        await c.env.DB.prepare(`INSERT INTO shifts (id, userId, userName, startTime, endTime, startCash, cashSales, expectedCash, endCash, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(s.id, s.userId, s.userName, s.startTime, s.endTime || null, s.startCash, s.cashSales, s.expectedCash, s.endCash || null, s.status).run()
        return c.json(s, 201)
    } catch (e) {
        return c.json({ error: e.message }, 500)
    }
})

app.put('/shifts/:id', async (c) => {
    const id = c.req.param('id')
    const s = await c.req.json()
    await c.env.DB.prepare(`UPDATE shifts SET endTime=?, endCash=?, expectedCash=?, cashSales=?, status=? WHERE id=?`).bind(s.endTime, s.endCash, s.expectedCash, s.cashSales, s.status, id).run()
    return c.json(s)
})

// --- Transactions ---
app.get('/transactions', async (c) => {
    const { results: transactions } = await c.env.DB.prepare('SELECT * FROM transactions').all()
    const { results: items } = await c.env.DB.prepare('SELECT * FROM transaction_items').all()

    // @ts-ignore
    const enriched = transactions.map((t: any) => ({
        ...t,
        items: items.filter((i: any) => i.transactionId === t.id)
    }))

    return c.json(enriched)
})

app.post('/transactions', async (c) => {
    try {
        const t = await c.req.json()
        const batch = [
            c.env.DB.prepare('INSERT INTO transactions (id, date, total, paymentMethod, shiftId, cashierName) VALUES (?, ?, ?, ?, ?, ?)')
                .bind(t.id, t.date, t.total, t.paymentMethod, t.shiftId || null, t.cashierName || null)
        ]

        // @ts-ignore
        for (const item of t.items) {
            batch.push(
                c.env.DB.prepare('INSERT INTO transaction_items (transactionId, productId, name, price, quantity) VALUES (?, ?, ?, ?, ?)')
                    .bind(t.id, item.productId, item.name, item.price, item.quantity)
            )
            batch.push(
                c.env.DB.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').bind(item.quantity, item.productId)
            )
        }

        if (t.shiftId && t.paymentMethod === 'CASH') {
            batch.push(
                c.env.DB.prepare('UPDATE shifts SET cashSales = cashSales + ? WHERE id = ?').bind(t.total, t.shiftId)
            )
        }

        await c.env.DB.batch(batch)
        return c.json(t, 201)
    } catch (e) {
        return c.json({ error: e.message }, 500)
    }
})

export const onRequest = handle(app)
