/**
 * Return a one-use browser bridge for Trello's fragment-based token response.
 *
 * URL fragments are not sent to the server. The bridge reads the token in the
 * browser and POSTs it to the same callback URL, keeping the long-lived token
 * out of query strings, browser history, referrers, and reverse-proxy logs.
 */
export function trelloFragmentBridgeResponse(): Response {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Completing Trello connection</title>
  </head>
  <body>
    <p>Completing Trello connection…</p>
    <script>
      (() => {
        const fragment = new URLSearchParams(window.location.hash.slice(1));
        const token = fragment.get('token');
        const error = fragment.get('error');
        const form = document.createElement('form');
        form.method = 'post';
        form.action = window.location.pathname + window.location.search;

        const field = document.createElement('input');
        field.type = 'hidden';
        field.name = token ? 'code' : 'error';
        field.value = token || error || 'missing_token';
        form.appendChild(field);

        window.history.replaceState(null, '', form.action);
        document.body.appendChild(form);
        form.submit();
      })();
    </script>
  </body>
</html>`

  return new Response(html, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'Content-Type': 'text/html; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
