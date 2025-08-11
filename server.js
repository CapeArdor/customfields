// server.js
// Proxy for BigCommerce product custom fields by order line item.
// ESM-compatible (package.json has "type": "module")

import express from 'express';
import fetch   from 'node-fetch';
import dotenv  from 'dotenv';
import cors    from 'cors';

dotenv.config();

const app = express();

const {
  STORE_HASH,          // e.g. "6n8c7qx3i9"
  ADMIN_API_TOKEN,     // Store-level Admin API token
  PORT = 8080,
  ALLOW_ORIGIN = '*',  // comma-separated list, or "*" (use "*" only for dev)
  PROXY_KEY            // optional shared secret; if set, client must send it
} = process.env;

// ---- Basic env checks (non-fatal log) ----
if (!STORE_HASH)      console.warn('⚠️  STORE_HASH is not set');
if (!ADMIN_API_TOKEN) console.warn('⚠️  ADMIN_API_TOKEN is not set');

// ---- CORS (supports multiple origins via ALLOW_ORIGIN) ----
const allowed =
  ALLOW_ORIGIN === '*'
    ? '*'
    : ALLOW_ORIGIN.split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: allowed === '*' ? true : (origin, cb) => {
    // allow same-origin/no-origin (e.g., curl or server-side) and whitelisted origins
    if (!origin || allowed.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Requested-With', 'X-Proxy-Key'],
  maxAge: 600,
}));

// Health
app.get(['/', '/healthz'], (_req, res) => res.json({ ok: true }));

/**
 * GET /proxy-custom-fields
 *   ?order_id=143&line_ids=88,426
 *     -> maps order_product_id(s) to product_id(s), then returns selected custom fields
 *
 * Fallback:
 *   ?ids=5229,1234
 *     -> provide product_id(s) directly
 *
 * Response:
 * {
 *   customFieldsByProduct: { [productId]: [{name,value}, ...], ... },
 *   customFieldsByLineItem: { [order_product_id]: [{name,value}, ...], ... } // present if order_id mapping used
 * }
 */
app.get('/proxy-custom-fields', async (req, res) => {
  try {
    // Optional shared-secret check
    if (PROXY_KEY) {
      const provided = req.query.key || req.get('X-Proxy-Key');
      if (provided !== PROXY_KEY) {
        return res.status(401).json({ error: 'Unauthorized: bad proxy key' });
      }
    }

    // Parse query
    const orderId = parseInt(req.query.order_id, 10) || null;
    const lineIds = String(req.query.line_ids || '')
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !Number.isNaN(n));

    let productIds = [];
    const lineToProduct = {};

    if (orderId && lineIds.length) {
      // 1) Map order_product_id -> product_id via Orders v2
      const url = `https://api.bigcommerce.com/stores/${STORE_HASH}/v2/orders/${orderId}/products`;
      const oRes = await fetch(url, {
        headers: {
          'X-Auth-Token': ADMIN_API_TOKEN,
          'Accept': 'application/json',
        },
      });
      if (!oRes.ok) {
        const t = await oRes.text();
        return res.status(oRes.status).json({ error: 'Orders API error', detail: t });
      }
      const orderProducts = await oRes.json(); // [{ id: order_product_id, product_id, ... }, ...]

      const wanted = new Set(lineIds);
      for (const p of orderProducts) {
        const opid = Number(p.id);
        if (wanted.has(opid) && p.product_id) {
          lineToProduct[opid] = p.product_id;
          productIds.push(p.product_id);
        }
      }
      productIds = [...new Set(productIds)];
      if (!productIds.length) {
        return res.json({ customFieldsByProduct: {}, customFieldsByLineItem: {} });
      }
    } else {
      // Fallback: direct product IDs
      productIds = String(req.query.ids || '')
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !Number.isNaN(n));
      productIds = [...new Set(productIds)];
      if (!productIds.length) {
        return res.status(400).json({ error: 'No ids provided' });
      }
    }

    // 2) Fetch product custom_fields via Catalog v3
    const cUrl = new URL(`https://api.bigcommerce.com/stores/${STORE_HASH}/v3/catalog/products`);
    cUrl.searchParams.set('include', 'custom_fields');
    cUrl.searchParams.set('id:in', productIds.join(','));

    const cRes = await fetch(cUrl.toString(), {
      headers: {
        'X-Auth-Token': ADMIN_API_TOKEN,
        'Accept': 'application/json',
      },
    });
    if (!cRes.ok) {
      const t = await cRes.text();
      return res.status(cRes.status).json({ error: 'Catalog API error', detail: t });
    }
    const cJson = await cRes.json();

    // 3) Keep only the fields we care about (normalized to lowercase names)
    const WANT = new Set([
      'status',
      'wms_available_inventory',
      'expected_in_stock',
      // optional fallbacks / legacy:
      'current_inventory',
      'current_inventory_cap24',
      'imported',
    ]);

    const byProduct = {};
    for (const p of (cJson.data || [])) {
      const fields = Array.isArray(p.custom_fields) ? p.custom_fields : [];
      byProduct[p.id] = fields
        .filter(f => f?.name)
        .map(f => ({
          name: String(f.name).toLowerCase(),
          value: f.value ?? f.text ?? '',
        }))
        .filter(f => WANT.has(f.name));
    }

    // 4) If we mapped line items, return by order_product_id as well
    const byLineItem = {};
    if (Object.keys(lineToProduct).length) {
      for (const [lineId, pid] of Object.entries(lineToProduct)) {
        byLineItem[lineId] = byProduct[pid] || [];
      }
    }

    // Optional: small cache hint (safe, data-bound to order details page)
    res.set('Cache-Control', 'private, max-age=60');

    return res.json({
      customFieldsByProduct: byProduct,
      customFieldsByLineItem: byLineItem,
    });

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: 'Proxy failure', detail: err.message });
  }
});

// Start
app.listen(PORT, () => {
  console.log(`✅ Proxy running on http://localhost:${PORT}/proxy-custom-fields`);
});
