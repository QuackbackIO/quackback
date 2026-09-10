export interface WidgetInstallPromptInput {
  instanceUrl: string
  widgetSecret: string | null
  /** When true, the prompt includes identify steps and the signing secret. */
  identify?: boolean
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
  const identify = input.identify === true
  const secret = identify ? input.widgetSecret : null

  if (!identify) {
    return `# Install the Quackback widget

Launcher only. Anonymous visitors should see the widget after init.

Do not ask the user for QUACKBACK_WIDGET_SECRET. Do not invent a signing secret. Do not implement identify. Quackback Cloud and self-host do not define a widget secret env var.

## Workspace
- Instance URL: ${instanceUrl}
- SDK script: ${instanceUrl}/api/widget/sdk.js

## What to do
1. Add the snippet or npm package and call init. Use the URL above.
2. Remind the user to turn on Show on your website in Admin → Settings → Widget.
3. Stop. If they later want identify, they will copy the signing secret from Admin → Settings → Widget → Install.

Optional skill (launcher steps only): ${WIDGET_SKILL_RAW}

Repo: ${WIDGET_SKILL_REPO}
`
  }

  const secretLine = secret
    ? `- Widget signing secret (host app server only): ${secret}`
    : '- Widget signing secret: ask the user to copy it from Admin → Settings → Widget → Install. Do not invent one.'

  return `# Install the Quackback widget

${
  secret
    ? 'A signing secret is included below. Store it in the host app server-side secret store — not in Quackback Cloud or self-host env. Never ship it to the browser, commit it, or log it.'
    : 'The user wants identify. Copy the signing secret from Admin → Settings → Widget → Install. Do not invent one.'
}

## Workspace
- Instance URL: ${instanceUrl}
- SDK script: ${instanceUrl}/api/widget/sdk.js
${secretLine}

## What to do
1. Fetch and follow the \`install-widget\` skill:
   - ${WIDGET_SKILL_RAW}
   - ${WIDGET_IDENTIFY_RAW}
2. Install the launcher, then identify signed-in users with a backend-signed ssoToken.
3. Use the credentials above. Do not invent APIs.

Repo: ${WIDGET_SKILL_REPO}

## Identify (signed-in users)
The widget appears after init for anonymous visitors. Call identify as soon as you know who the user is: when the app first loads if they are already signed in, and immediately after login or signup. Once per session — not on every navigation. Mint a fresh HS256 JWT at that moment with the signing secret from Admin → Settings → Widget → Install and call \`Quackback("identify", { ssoToken })\`. \`sub\` is a unique stable host user id, not email. Call \`Quackback("logout")\` on logout. Never pass raw id/email from the client.
`
}

export interface WidgetInstallSnippetInput {
  instanceUrl: string
  /** When true, the snippet documents identify. Default false. */
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

/** Script-tag snippet for hand install. Launcher-only is the default. */
export function buildWidgetInstallSnippet(input: WidgetInstallSnippetInput): string {
  const loader = widgetLoader(input.instanceUrl)
  if (input.identify !== true) {
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
