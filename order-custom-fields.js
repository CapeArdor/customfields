<script>
document.addEventListener('DOMContentLoaded', async () => {
  // 1) Point this at your deployed proxy
  const PROXY_URL = 'https://<your-render-service>.onrender.com/proxy-custom-fields';
  const PROXY_KEY = ''; // optional: if you set PROXY_KEY on the server, put it here

  try {
    // 2) Collect order + line-item (order_product_id) from the placeholders
    const els = Array.from(
      document.querySelectorAll('.item-custom-fields[data-order-product-id][data-order-id]')
    );
    if (!els.length) return;

    const orderId = parseInt(els[0].dataset.orderId, 10);
    const lineIds = [...new Set(
      els.map(el => parseInt(el.dataset.orderProductId, 10)).filter(n => !Number.isNaN(n))
    )];
    if (!orderId || !lineIds.length) return;

    // 3) Call your proxy (no GraphQL, no storefront token)
    const url = `${PROXY_URL}?order_id=${orderId}&line_ids=${lineIds.join(',')}`;
    const res = await fetch(url, {
      credentials: 'omit',
      headers: PROXY_KEY ? { 'X-Proxy-Key': PROXY_KEY } : {}
    });

    if (!res.ok) {
      console.error('❌ Proxy request failed', res.status, await res.text());
      return;
    }

    const payload = await res.json();
    const byLine = payload.customFieldsByLineItem || {};

    // Show these 3 for now; swap later to ['status','imported','wms_available_inventory'] on live
    const WANT = new Set(['current_inventory', 'imported', 'status']);

    // 4) Render beneath each product name
    els.forEach(el => {
      const lineId = String(el.dataset.orderProductId);
      const fields = byLine[lineId] || [];
      const frag = document.createDocumentFragment();

      fields
        .filter(f => f && f.name && WANT.has(String(f.name).toLowerCase()))
        .forEach(f => {
          const div = document.createElement('div');
          div.className = 'cf-row';
          div.textContent = `${f.name}: ${f.value ?? ''}`;
          frag.appendChild(div);
        });

      el.appendChild(frag);
    });
  } catch (err) {
    console.error('❌ Custom-fields script error:', err);
  }
});
</script>
