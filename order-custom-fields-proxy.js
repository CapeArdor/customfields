// /content/Scripts/order-custom-fields.js
document.addEventListener('DOMContentLoaded', async () => {
  try {
    console.log('✅ Proxy mode script loaded (line-item → product mapping)');

    const els = Array.from(document.querySelectorAll('.item-custom-fields[data-order-product-id][data-order-id]'));
    console.log('📦 placeholders:', els.length);
    if (!els.length) return;

    const orderId = parseInt(els[0].getAttribute('data-order-id'), 10);
    const lineIds = [...new Set(
      els.map(el => parseInt(el.getAttribute('data-order-product-id'), 10))
         .filter(n => !Number.isNaN(n))
    )];

    console.log('🧾 orderId:', orderId, ' lineIds:', lineIds);
    if (!orderId || !lineIds.length) return;

    // Build a quick map for injecting later
    const byLineId = new Map(els.map(el => [String(el.getAttribute('data-order-product-id')), el]));

    // Hit your local proxy (add &key=... if you set PROXY_KEY in .env)
    const url = `http://localhost:8080/proxy-custom-fields?order_id=${orderId}&line_ids=${lineIds.join(',')}`;
    console.log('🌐 calling proxy:', url);
    const res = await fetch(url, { credentials: 'omit' });
    const payload = await res.json();
    console.log('📨 proxy response:', payload);

    const data = payload && payload.customFieldsByLineItem;
    if (!data) return;

    const WANT = new Set(['current_inventory', 'imported', 'status']);

    Object.entries(data).forEach(([lineId, fields]) => {
      const el = byLineId.get(String(lineId));
      if (!el) return;

      if (!fields || !fields.length) {
        const div = document.createElement('div');
        div.className = 'cf cf-empty';
        div.textContent = 'No custom fields';
        el.appendChild(div);
        return;
      }

      fields
        .filter(f => f && f.name && WANT.has(String(f.name).toLowerCase()))
        .forEach(f => {
          const div = document.createElement('div');
          div.className = `cf cf-${f.name}`;
          div.textContent = `${f.name}: ${f.value ?? ''}`;
          el.appendChild(div);
        });
    });

  } catch (err) {
    console.error('❌ Proxy script error:', err);
  }
});
