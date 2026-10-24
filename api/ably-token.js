// Vercel serverless function: issues a signed Ably token request so the browser never
// sees the API key. Set ABLY_API_KEY ("appId.keyId:secret") in the Vercel project settings.
import crypto from 'node:crypto';

export default function handler(req, res) {
  const key = process.env.ABLY_API_KEY;
  if (!key || !key.includes(':')) {
    res.status(503).json({ error: 'ABLY_API_KEY is not configured' });
    return;
  }
  const [keyName, keySecret] = key.split(':');
  const raw = String((req.query && req.query.clientId) || '');
  const clientId = raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  if (!clientId) {
    res.status(400).json({ error: 'clientId required' });
    return;
  }
  const ttl = 60 * 60 * 1000;
  const capability = JSON.stringify({ 'gotcha:*': ['publish', 'subscribe', 'presence'] });
  const timestamp = Date.now();
  const nonce = crypto.randomBytes(16).toString('hex');
  const signText = [keyName, ttl, capability, clientId, timestamp, nonce].join('\n') + '\n';
  const mac = crypto.createHmac('sha256', keySecret).update(signText).digest('base64');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ keyName, ttl, capability, clientId, timestamp, nonce, mac });
}
