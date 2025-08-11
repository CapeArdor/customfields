import fetch from 'node-fetch';

(async () => {
  const url = `https://api.bigcommerce.com/stores/${process.env.STORE_HASH}/v3/channels`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Auth-Token': process.env.ADMIN_API_TOKEN,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  const { data } = await res.json();
  console.log('Channels list:', data);
  // Find the entry with domain matching your storefront URL
})();
