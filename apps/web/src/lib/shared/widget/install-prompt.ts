export interface WidgetInstallPromptInput {
  instanceUrl: string
  widgetSecret: string | null
}

export const WIDGET_SECRET_ENV = 'QUACKBACK_WIDGET_SECRET'
export const WIDGET_SECRET_PLACEHOLDER = 'wgt_YOUR_WIDGET_SECRET'
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
1. Fetch and follow the \`install-widget\` skill:
   - ${WIDGET_SKILL_RAW}
   - ${WIDGET_IDENTIFY_RAW}
2. Follow every step in order. Do not skip identify.
3. Use the credentials above. Do not invent APIs.

Repo: ${WIDGET_SKILL_REPO}

## Identify (required for signed-in users)
The widget appears after init for anonymous visitors. Call identify as soon as you know who the user is: when the app first loads if they are already signed in, and immediately after login or signup. Once per session — not on every navigation. Mint a fresh HS256 JWT at that moment and call \`Quackback("identify", { ssoToken })\`. \`sub\` is a unique stable host user id, not email. Call \`Quackback("logout")\` on logout. Never pass raw id/email from the client.
`
}

export interface WidgetInstallSnippetInput {
  instanceUrl: string
  /** Recommended. When true, the snippet identifies signed-in users. Default true. */
  identify?: boolean
}

function widgetLoader(instanceUrl: string): string {
  const sdk = `${trimTrailingSlash(instanceUrl)}/api/widget/sdk.js`
  return `(function(w,d){if(w.Quackback)return;w.Quackback=function(){
    (w.Quackback.q=w.Quackback.q||[]).push(arguments)};
    var s=d.createElement("script");s.async=true;
    s.src="${sdk}";
    d.head.appendChild(s)})(window,document);`
}

/** Script-tag snippet for hand install. Identify-on is the recommended default. */
export function buildWidgetInstallSnippet(input: WidgetInstallSnippetInput): string {
  const loader = widgetLoader(input.instanceUrl)
  if (input.identify === false) {
    return `<script>
  // Quackback: anonymous visitors see the launcher after init.
  ${loader}
  Quackback("init");
</script>`
  }

  return `<script>
  // Quackback widget. Init first so anonymous visitors still get the launcher.
  ${loader}
  Quackback("init");

  // Recommended: identify signed-in users once per session so threads attach to a person.
  // Your server signs a ~5m HS256 JWT with QUACKBACK_WIDGET_SECRET and returns { ssoToken }.
  // Claims: sub = String(user.id) — a stable unique id, never email — plus email, optional name.
  // Call this on first load if already signed in, and right after login/signup. Not on every navigation.
  // Return 401 when nobody is signed in; the widget stays anonymous.
  //
  // Server (jose):
  //   await new SignJWT({ sub: String(user.id), email: user.email, name: user.name })
  //     .setProtectedHeader({ alg: "HS256" }).setExpirationTime("5m")
  //     .sign(new TextEncoder().encode(process.env.QUACKBACK_WIDGET_SECRET))
  //
  // Replace /api/quackback/sso with your route. Never put the secret in the browser.
  fetch("/api/quackback/sso", { credentials: "same-origin" })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      if (data && data.ssoToken) Quackback("identify", { ssoToken: data.ssoToken });
    })
    .catch(function () {});

  // On logout: Quackback("logout");
</script>`
}

/** Mask the live secret in the on-screen preview so screenshots do not leak it. */
export function maskWidgetSecretInPrompt(prompt: string, secret: string | null): string {
  if (!secret) return prompt
  return prompt.replaceAll(secret, `${secret.slice(0, 8)}${'•'.repeat(8)}`)
}
