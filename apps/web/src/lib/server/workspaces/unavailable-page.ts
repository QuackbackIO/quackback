/**
 * What a visitor sees when the workspace at this address is not serving.
 *
 * The visitor is the workspace's own customer — someone opening its portal,
 * its widget or its custom domain — not the team that runs it. So the
 * registry's reason (`deleted`, `trial_ended`, `admin`, …) is never shown: it
 * is the control plane's business, and a billing reason in particular is not a
 * stranger's to read. The page says only whether the workspace is gone or
 * paused, and points whoever runs it at their Quackback dashboard.
 *
 * A browser navigation gets a small branded page. A client that asked for JSON
 * gets JSON. Anything else gets one line of text, as every refusal did before.
 */
import { QUACKBACK_DUCK_SVG } from './quackback-duck'

export type UnavailableState = 'deleted' | 'paused' | 'unknown'

interface Copy {
  title: string
  body: (host: string) => string
  owner: string
}

const COPY: Record<UnavailableState, Copy> = {
  deleted: {
    title: "This workspace isn't available",
    body: (host) => `${host} has been deleted by the team that ran it.`,
    owner: 'Do you run this workspace? Sign in to Quackback to restore it.',
  },
  paused: {
    title: 'This workspace is paused',
    body: () => "It isn't taking feedback right now. Anything you've already shared is kept.",
    owner: "Do you run this workspace? Sign in to Quackback to see why it's paused.",
  },
  unknown: {
    title: "There's no workspace here",
    body: (host) =>
      `Nothing is set up at ${host}. Check the address, or ask whoever sent you the link.`,
    owner: 'Setting up a workspace? Sign in to Quackback.',
  },
}

/**
 * The control plane's sign-in page, when this process knows where the control
 * plane is. A self-hosted install has none, and its page simply omits the line.
 */
export function controlPlaneUrl(path: string): string | null {
  const raw = process.env.QUACKBACK_CONTROL_PLANE_URL
  if (!raw || !raw.startsWith('https://')) return null
  return `${raw.replace(/\/$/, '')}${path}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function wantsHtml(request: Request): boolean {
  const dest = request.headers.get('sec-fetch-dest')
  if (dest === 'document' || dest === 'iframe') return true
  return (request.headers.get('accept') ?? '').includes('text/html')
}

function wantsJson(request: Request): boolean {
  return (request.headers.get('accept') ?? '').includes('application/json')
}

// The page carries everything it needs. It is served on a hostname that is not
// serving, so it cannot count on the app's own assets or stylesheets.
const PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"

function renderPage(state: UnavailableState, host: string): string {
  const copy = COPY[state]
  const signIn = controlPlaneUrl('/login')
  const safeHost = escapeHtml(host || 'this address')
  const owner = signIn
    ? `<p class="owner">${escapeHtml(copy.owner)}</p>
      <a class="btn" href="${escapeHtml(signIn)}">Sign in to Quackback</a>`
    : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(copy.title)}</title>
<style>
:root{--bg:#f7f6f2;--card:#fff;--fg:#111;--muted:#5f5d56;--line:#e8e5dc;--duck:#f7cc29;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#121211;--card:#191917;--fg:#f3f1ea;--muted:#a6a398;--line:#2b2a26;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--fg);font:16px/1.55 Figtree,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:32px 28px;display:grid;gap:14px;justify-items:center;text-align:center}
h1{margin:0;font-size:24px;line-height:1.15;font-weight:800;letter-spacing:-.02em;text-wrap:balance}
p{margin:0;color:var(--muted)}
.owner{font-size:14px}
.btn{display:inline-flex;align-items:center;padding:10px 14px;border:1px solid color-mix(in srgb,var(--fg) 28%,transparent);border-radius:8px;color:var(--fg);font-weight:600;font-size:14px;text-decoration:none}
.btn:focus-visible{outline:2px solid var(--fg);outline-offset:2px;box-shadow:0 0 0 5px var(--duck)}
.by{display:flex;gap:6px;align-items:center;margin-top:6px;font-size:12.5px;color:var(--muted);text-decoration:none}
.by svg{width:16px;height:16px}
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(copy.title)}</h1>
  <p>${copy.body(safeHost)}</p>
  ${owner}
  <a class="by" href="https://quackback.io">${QUACKBACK_DUCK_SVG}Powered by Quackback</a>
</main>
</body>
</html>`
}

/**
 * The refusal for a workspace that is not serving, negotiated on what the
 * client asked for. Never cacheable: a cached refusal on a shared edge would
 * pin the address into an outage after the workspace is restored.
 */
export function unavailableResponse(
  request: Request,
  state: UnavailableState,
  options: { status: number; host: string; headers?: Record<string, string> }
): Response {
  const headers: Record<string, string> = {
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex',
    ...options.headers,
  }
  if (wantsHtml(request)) {
    return new Response(renderPage(state, options.host), {
      status: options.status,
      headers: {
        ...headers,
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': PAGE_CSP,
      },
    })
  }
  if (wantsJson(request)) {
    return Response.json(
      { error: { code: 'workspace_unavailable', state } },
      { status: options.status, headers }
    )
  }
  return new Response(`${COPY[state].title}.`, {
    status: options.status,
    headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' },
  })
}
