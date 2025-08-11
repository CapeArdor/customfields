// server.js
import express from 'express';
import fetch   from 'node-fetch';
import dotenv  from 'dotenv';
import cors    from 'cors';

dotenv.config();

const app = express();

const {
  STORE_HASH,          // e.g. 6n8c7qx3i9
  ADMIN_API_TOKEN,     // Store-level Admin API token
  PORT = 8080,
  ALLOW_ORIGIN = '*',  // comma-separated list, or '*' for all (dev only)
  PROXY_KEY            // optional shared secret
} = process.env;

// -------- CORS (support multiple origins via ALLOW_ORIGIN) --------
const allowed =
  ALLOW_ORIGIN === '*'
    ? '*'
    : ALLOW_ORIGIN.split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: allowed === '*' ? true : (origin, cb) => {
    // allow same-origin/fetch from server (no origin) and whitelisted origins
    if (!origin || allowed.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Requested-With', 'X-Proxy-Key'],
  maxAge: 600
}));

// Health
app.get(['/', '/healthz'], (_req, res) => res.json({ ok: true }));

// GET /proxy-custom-fields?order_id=143&line_ids=88,426
// or fallback: /proxy-custom-fields?ids=5229,1234 (product IDs directly)
app.get('/proxy-custom-fields', async (req, res) => {
  try {
    // Optional shared-secret
    if (PROXY_KEY) {
      const provided = req.query.key || req.get('X-Proxy-Key');
      if (provided !== PROXY_KEY) {
        return res.status(401).json({ error: 'Unauthorized: bad proxy key' });
      }
    }

    const orderId = parseInt(req.query.order_id, 10) || null;
    const lineIds = String(req.query.line_ids || '')
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !Number.isNaN(n));

    let productIds = [];
    const lineToProduct = {};

    if (orderId && lineIds.length) {
      // 1) Map line-item ids → product ids (Orders v2)
      const url = `https://api.bigcommerce.com/stores/${STORE_HASH}/v2/orders/${orderId}/products`;
      const oRes = await fetch(url, {
        headers: { 'X-Auth-Token': ADMIN_API_TOKEN, 'Accept': 'application/json' },
      });
      if (!oRes.ok) {
        const t = await oRes.text();
        return res.status(oRes.status).json({ error: 'Orders API error', detail: t });
      }
      const orderProducts = await oRes.json();

      const wanted = new Set(lineIds);
      orderProducts.forEach(p => {
        if (wanted.has(Number(p.id)) && p.product_id) {
          lineToProduct[p.id] = p.product_id;
          productIds.push(p.product_id);
        }
      });

      productIds = [...new Set(productIds)];
      if (!productIds.length) {
        return res.json({ customFieldsByProduct: {}, customFieldsByLineItem: {} });
      }
    } else {
      // Fallback: take product ids directly
      productIds = String(req.query.ids || '')
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !Number.isNaN(n));
      productIds = [...new Set(productIds)];
      if (!productIds.length) {
        return res.status(400).json({ error: 'No ids provided' });
      }
    }

    // 2) Fetch custom_fields (Catalog v3)
    const cUrl = new URL(`https://api.bigcommerce.com/stores/${STORE_HASH}/v3/catalog/products`);
    cUrl.searchParams.set('include', 'custom_fields');
    cUrl.searchParams.set('id:in', productIds.join(','));

    const cRes = await fetch(cUrl.toString(), {
      headers: { 'X-Auth-Token': ADMIN_API_TOKEN, 'Accept': 'application/json' },
    });
    if (!cRes.ok) {
      const t = await cRes.text();
      return res.status(cRes.status).json({ error: 'Catalog API error', detail: t });
    }
    const cJson = await cRes.json();

    // 3) Reduce to just the fields we care about
    const WANT = new Set(['current_inventory', 'imported', 'status']);
    const byProduct = {};

    (cJson.data || []).forEach(p => {
      const fields = Array.isArray(p.custom_fields) ? p.custom_fields : [];
      byProduct[p.id] = fields
        .filter(f => f?.name)
        .filter(f => WANT.has(String(f.name).toLowerCase()))
        .map(f => ({ name: f.name, value: f.value ?? f.text ?? '' }));
    });

    // Also return by line item if we mapped them
    const byLineItem = {};
    if (Object.keys(lineToProduct).length) {
      Object.entries(lineToProduct).forEach(([lineId, pid]) => {
        byLineItem[lineId] = byProduct[pid] || [];
      });
    }

    res.json({
      customFieldsByProduct: byProduct,
      customFieldsByLineItem: byLineItem,
    });

  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Proxy failure', detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Proxy running on http://localhost:${PORT}/proxy-custom-fields`);
});
