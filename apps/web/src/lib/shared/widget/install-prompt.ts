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

/** Mask the live secret in the on-screen preview so screenshots do not leak it. */
export function maskWidgetSecretInPrompt(prompt: string, secret: string | null): string {
  if (!secret) return prompt
  return prompt.replaceAll(secret, `${secret.slice(0, 8)}${'•'.repeat(8)}`)
}
