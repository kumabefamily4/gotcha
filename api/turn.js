// Vercel serverless function: hands TURN relay credentials to the browser for voice chat.
// Optional. Set TURN_URLS (comma separated), TURN_USERNAME and TURN_CREDENTIAL in Vercel.
export default function handler(req, res) {
  const urls = (process.env.TURN_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
  res.setHeader('Cache-Control', 'no-store');
  if (!urls.length) {
    res.status(200).json({ iceServers: [] });
    return;
  }
  res.status(200).json({
    iceServers: [{ urls, username: process.env.TURN_USERNAME || '', credential: process.env.TURN_CREDENTIAL || '' }],
  });
}
