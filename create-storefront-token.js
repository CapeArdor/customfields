// create-storefront-token.js

import fetch  from 'node-fetch';   // HTTP client for Node.js 
import dotenv from 'dotenv';       // Environment variable loader :contentReference[oaicite:1]{index=1}

dotenv.config();                   // Load STORE_HASH and ADMIN_API_TOKEN from .env

const STORE_HASH  = process.env.STORE_HASH;
const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN;
// Lock token to your Developer Staging Site channel
const CHANNEL_ID  = 1731174;       // Developer Staging Site channel ID :contentReference[oaicite:2]{index=2}
// CORS origin for the token
const ORIGINS     = [`https://developer-staging-site--1731174.mybigcommerce.com`];

// 1) Compute expiry 30 days from now (in seconds)
const expiresAt = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);

async function createStorefrontToken() {
  // 2) Use the singular /api-token endpoint to create a new token :contentReference[oaicite:3]{index=3}
  const url = `https://api.bigcommerce.com/stores/${STORE_HASH}/v3/storefront/api-token`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      // 3) Authenticate with your Admin API token 
      'X-Auth-Token': ADMIN_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      // 4) Required fields: allowed_cors_origins, channel_ids, expires_at 
      allowed_cors_origins: ORIGINS,
      channel_ids:         [CHANNEL_ID],
      expires_at:          expiresAt
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }

  const { data } = await res.json();
  console.log('✅ New Storefront Token:', data.token);
}

createStorefrontToken().catch(err => {
  console.error('❌ Failed to create storefront token:', err.message);
});
