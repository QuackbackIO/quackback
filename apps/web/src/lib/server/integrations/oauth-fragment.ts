import { randomBytes } from 'node:crypto'

/** No token reaches server logs, HTML, referrers, or a redirect query string. */
export function oauthFragmentBridge(): Response {
  const nonce = randomBytes(18).toString('base64')
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connecting integration</title></head>
<body><main><h1>Connecting your account</h1><p id="status" role="status">Completing authorization...</p><noscript>Enable JavaScript to finish connecting your account.</noscript></main>
<script nonce="${nonce}">
(async () => {
  const token = new URLSearchParams(location.hash.slice(1)).get('token');
  history.replaceState(null, '', location.pathname + location.search);
  try {
    if (!token) throw new Error('Authorization was not completed. Return to integration settings and try again.');
    const response = await fetch(location.pathname + location.search, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token })
    });
    if (!response.ok) throw new Error('Could not complete authorization. Return to integration settings and try again.');
    const result = await response.json();
    if (typeof result.redirect !== 'string') throw new Error('Could not complete authorization.');
    location.replace(result.redirect);
  } catch (error) { document.getElementById('status').textContent = error.message; }
})();
</script></body></html>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`,
      },
    }
  )
}

/** Fetch must not follow a cross-domain redirect before the browser navigates. */
export function oauthFragmentResult(response: Response): Response {
  const redirect = response.headers.get('location')
  if (!redirect) return response
  const headers = new Headers(response.headers)
  headers.delete('location')
  headers.set('Cache-Control', 'no-store')
  return Response.json({ redirect }, { headers })
}
