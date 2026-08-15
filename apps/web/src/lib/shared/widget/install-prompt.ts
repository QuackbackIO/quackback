export interface WidgetInstallPromptInput {
  instanceUrl: string
  widgetSecret: string | null
}

export const WIDGET_SECRET_ENV = 'QUACKBACK_WIDGET_SECRET'
export const WIDGET_SECRET_PLACEHOLDER = 'wgt_YOUR_WIDGET_SECRET'

const INSTALL_DOCS_URL = 'https://quackback.io/docs/widget/installation'
const IDENTIFY_DOCS_URL = 'https://quackback.io/docs/widget/identify-users'

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/** Canonical prompt an agent can paste to install the widget in a host codebase. */
export function buildWidgetInstallPrompt(input: WidgetInstallPromptInput): string {
  const instanceUrl = trimTrailingSlash(input.instanceUrl)
  const secret = input.widgetSecret ?? WIDGET_SECRET_PLACEHOLDER
  const secretNote = input.widgetSecret
    ? 'A widget secret is included below. Store it in a server-only env var. Never ship it to the browser, commit it, or log it.'
    : 'No widget secret has been generated yet. Use the placeholder below and ask the user to paste the real secret from Admin → Settings → Widget after they regenerate it.'

  return `# Install the Quackback widget

${secretNote}

## Workspace
- Instance URL: ${instanceUrl}
- SDK script: ${instanceUrl}/api/widget/sdk.js
- Widget secret (server-only): ${secret}
- Env var name: ${WIDGET_SECRET_ENV}

## What to do
Detect this repository's stack and implement a complete install. Do not invent APIs.

1. Load the widget on every product page where customers should see it.
   - HTML / any site: paste the snippet before \`</body>\`.
   - SPA (React, Next, Vue, Svelte): the snippet or \`npm install @quackback/widget\` both work. Prefer the approach that matches existing patterns.
2. Add a server-only endpoint that signs a short-lived HS256 JWT with \`${WIDGET_SECRET_ENV}\` and returns \`{ ssoToken }\`.
3. After the host app knows who the user is, call \`Quackback("identify", { ssoToken })\`. Anonymous visitors need no identify call — the widget still appears.
4. Call \`Quackback("logout")\` from the host logout handler.
5. Put the secret in \`.env\` / \`.env.local\` (or the host's secret store). Do not import it into client bundles.

## Snippet
\`\`\`html
<script>
  (function(w,d){if(w.Quackback)return;w.Quackback=function(){
  (w.Quackback.q=w.Quackback.q||[]).push(arguments)};
  var s=d.createElement("script");s.async=true;
  s.src="${instanceUrl}/api/widget/sdk.js";
  d.head.appendChild(s)})(window,document);

  Quackback("init");
</script>
\`\`\`

## Identity (required for signed-in users)
Identify is verified-only. The client must not pass raw id/email. Your backend signs:

- alg: HS256
- claims: \`sub\` (stable host user id, required), \`email\` (required), \`name\` (optional), \`exp\` (~5 minutes from now, required)
- response JSON key: \`ssoToken\` (not \`token\`)

Example client call after auth resolves:

\`\`\`js
const { ssoToken } = await fetch("/api/widget-sso", { method: "POST" }).then((r) => {
  if (!r.ok) throw new Error("Failed to fetch widget token");
  return r.json();
});
Quackback("identify", { ssoToken });
\`\`\`

## Rules
- Never put \`${WIDGET_SECRET_ENV}\` in client code, public env vars (\`NEXT_PUBLIC_*\`, \`VITE_*\`), or the snippet.
- Do not call \`Quackback("identify", { id, email })\` — that unverified shape is rejected.
- Do not rename \`ssoToken\`.
- Match the host app's auth, routing, and package manager. Reuse existing session helpers.
- If you cannot tell where layout or auth live, ask one question, then continue.
- Fetch these docs if you need more detail:
  - ${INSTALL_DOCS_URL}
  - ${IDENTIFY_DOCS_URL}

## Done when
- The snippet or SDK init runs on the right pages.
- A server route signs \`ssoToken\` with the widget secret.
- Signed-in users are identified; logout clears identity.
- The secret is server-side only.
`
}

/** Mask the live secret in the on-screen preview so screenshots do not leak it. */
export function maskWidgetSecretInPrompt(prompt: string, secret: string | null): string {
  if (!secret) return prompt
  return prompt.replaceAll(secret, `${secret.slice(0, 8)}${'•'.repeat(8)}`)
}
