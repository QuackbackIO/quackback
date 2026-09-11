export interface WidgetInstallPromptInput {
  instanceUrl: string
  /** Pairing code minted on copy. Never embed the raw wgt_ HMAC. */
  pairingCode?: string | null
}

export const WIDGET_SKILL_REPO = 'https://github.com/QuackbackIO/skills'
export const WIDGET_SKILL_RAW =
  'https://raw.githubusercontent.com/QuackbackIO/skills/main/skills/quackback/install-widget/SKILL.md'
export const WIDGET_IDENTIFY_RAW =
  'https://raw.githubusercontent.com/QuackbackIO/skills/main/skills/quackback/install-widget/references/identify-users.md'

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/** Short prompt an agent pastes: install the public skill, then use these credentials. */
export function buildWidgetInstallPrompt(input: WidgetInstallPromptInput): string {
  const instanceUrl = trimTrailingSlash(input.instanceUrl)
  const redeemUrl = `${instanceUrl}/api/widget/install-context`
  const code = input.pairingCode?.trim() || ''
  const codeLine = code
    ? `- Pairing code: ${code}`
    : '- Pairing code: missing. Ask the user to copy the install prompt again from Admin → Settings → Widget → Install. Do not invent a code or secret.'

  return `# Install the Quackback widget

Redeem the pairing code over HTTP — do not ask the user for the HMAC signing secret. Never invent a secret. Never print the signing secret after redeem.

The launcher must appear for anonymous visitors after init. If this app already has signed-in users, also identify them with a backend-signed ssoToken. If it does not, leave the signing secret in server-only env and stop after init. Do not invent auth or a placeholder user id.

## Workspace
- Instance URL: ${instanceUrl}
- SDK script: ${instanceUrl}/api/widget/sdk.js
- Redeem URL: POST ${redeemUrl}
${codeLine}

## What to do
1. Fetch and follow the \`install-widget\` skill:
   - ${WIDGET_SKILL_RAW}
   - ${WIDGET_IDENTIFY_RAW}
2. POST JSON \`{ "code": "<pairing code>" }\` to the redeem URL. Write \`signingSecret\` to a **server-only** host env var (any name). Do not commit it, log it, or put it in public env. Redeeming turns on Show on your website.
3. Add the snippet or npm package and call init so anonymous visitors see the launcher.
4. If this app has login / a session / a current user: identify signed-in users with a backend-signed ssoToken. If it does not, stop. Leave the secret in env for later.
5. Open a page with the widget so Admin → Settings → Widget → Install can flip to connected. If the launcher stays hidden, ask the user to turn on Show on your website.
6. Do not invent APIs.

Repo: ${WIDGET_SKILL_REPO}

## Identify (only if the host already has signed-in users)
Call identify as soon as you know who the user is: when the app first loads if they are already signed in, and immediately after login or signup. Once per session — not on every navigation. Mint a fresh HS256 JWT at that moment with the host-app signing secret and call \`Quackback("identify", { ssoToken })\`. \`sub\` is a unique stable host user id, not email. Call \`Quackback("logout")\` on logout. Never pass raw id/email from the client.
`
}

export interface WidgetInstallSnippetInput {
  instanceUrl: string
}

function widgetLoader(instanceUrl: string): string {
  const sdk = `${trimTrailingSlash(instanceUrl)}/api/widget/sdk.js`
  return `(function(w,d){if(w.Quackback)return;w.Quackback=function(){
    (w.Quackback.q=w.Quackback.q||[]).push(arguments)};
    var s=d.createElement("script");s.async=true;
    s.src="${sdk}";
    d.head.appendChild(s)})(window,document);`
}

/** Script-tag snippet for hand install. Always documents identify. */
export function buildWidgetInstallSnippet(input: WidgetInstallSnippetInput): string {
  const loader = widgetLoader(input.instanceUrl)
  return `<script>
  // Quackback widget. Init first so anonymous visitors still get the launcher.
  ${loader}
  Quackback("init");

  // Identify signed-in users once per session so threads attach to a person.
  // Call when you first know who they are — app load if already signed in,
  // and right after login/signup. Not on every navigation.
  //
  // Server: sign a ~5m HS256 JWT with the signing secret from
  // Admin → Settings → Widget → Install.
  //   sub   — stable unique user id (never email)
  //   email — required
  //   name  — optional
  // Hand { ssoToken } to the page however you already expose session data.
  // Never put the secret in the browser. Never send raw id or email.
  //
  // Quackback("identify", { ssoToken });
  // Quackback("logout");
</script>`
}

/** Mask the live secret in the on-screen preview so screenshots do not leak it. */
export function maskWidgetSecretInPrompt(prompt: string, secret: string | null): string {
  if (!secret) return prompt
  return prompt.replaceAll(secret, `${secret.slice(0, 8)}${'•'.repeat(8)}`)
}
