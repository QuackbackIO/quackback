export const WIDGET_SKILL_REPO = 'https://github.com/QuackbackIO/skills'
export const WIDGET_SKILL_RAW =
  'https://raw.githubusercontent.com/QuackbackIO/skills/main/skills/quackback/install-widget/SKILL.md'

export function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/** Short prompt an agent pastes: install the public skill, then use these credentials. */
export function buildWidgetInstallPrompt(instanceUrl: string, pairingCode: string): string {
  const base = trimTrailingSlash(instanceUrl)
  const redeemUrl = `${base}/api/widget/install-context`

  return `# Install the Quackback widget

Redeem the pairing code over HTTP; do not ask the user for the HMAC signing secret. Never invent a secret. Never print the signing secret after redeem.

The launcher must appear for anonymous visitors after init. If this app already has signed-in users, also identify them with a backend-signed ssoToken. If it does not, leave the signing secret in server-only env and stop after init. Do not invent auth or a placeholder user id.

## Workspace
- Instance URL: ${base}
- SDK script: ${base}/api/widget/sdk.js
- Redeem URL: POST ${redeemUrl}
- Pairing code: ${pairingCode.trim()}

## What to do
1. Fetch and follow the \`install-widget\` skill:
   - ${WIDGET_SKILL_RAW}
2. POST JSON \`{ "code": "<pairing code>" }\` to the redeem URL. Write \`signingSecret\` to a **server-only** host env var (any name). Do not commit it, log it, or put it in public env. Redeeming turns on Show on your website.
3. Add the snippet or npm package and call init so anonymous visitors see the launcher.
4. If this app has login / a session / a current user: identify signed-in users with a backend-signed ssoToken, once per session. If it does not, stop. Leave the secret in env for later.
5. Open a page with the widget so Admin → Settings → Widget → Install can flip to connected. If the launcher stays hidden, ask the user to turn on Show on your website.
6. Do not invent APIs.

Repo: ${WIDGET_SKILL_REPO}
`
}

function widgetLoader(instanceUrl: string): string {
  const sdk = `${trimTrailingSlash(instanceUrl)}/api/widget/sdk.js`
  return `(function(w,d){if(w.Quackback)return;w.Quackback=function(){
    (w.Quackback.q=w.Quackback.q||[]).push(arguments)};
    var s=d.createElement("script");s.async=true;
    s.src="${sdk}";
    d.head.appendChild(s)})(window,document);`
}

/**
 * The shortest working install: load and start Messenger, nothing else. No
 * comments, so it survives being pasted or emailed as a single line; how to
 * identify signed-in users lives on the Install settings page.
 */
export function buildWidgetLoaderSnippet(instanceUrl: string): string {
  return `<script>
  ${widgetLoader(instanceUrl)}
  Quackback("init");
</script>`
}

const TEST_SITE_LABEL = /^(staging|stage|stg|dev|preview|test|qa|uat|sandbox)$/
const TEST_SITE_SUFFIX = /(^|\.)(localhost|local|test|internal)$/

/**
 * A host that is someone's own machine or a pre-release copy of their site:
 * Messenger seen there proves the snippet works, not that customers see it.
 */
export function isTestSiteHost(host: string): boolean {
  const name = host
    .toLowerCase()
    .replace(/:\d+$/, '')
    .replace(/^\[|\]$/g, '')
  if (name === '::1' || TEST_SITE_SUFFIX.test(name)) return true
  if (/^(127|10)\.\d+\.\d+\.\d+$/.test(name) || /^192\.168\.\d+\.\d+$/.test(name)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(name)) return true
  return name.split('.').some((label) => label.split('-').some((part) => TEST_SITE_LABEL.test(part)))
}

/** Script-tag snippet for hand install. Always documents identify. */
export function buildWidgetInstallSnippet(instanceUrl: string): string {
  const loader = widgetLoader(instanceUrl)
  return `<script>
  // Quackback widget. Init first so anonymous visitors still get the launcher.
  ${loader}
  Quackback("init");

  // Identify signed-in users once per session so threads attach to a person.
  // Call when you first know who they are: app load if already signed in,
  // and right after login/signup. Not on every navigation.
  //
  // Server: sign a ~5m HS256 JWT with the signing secret from
  // Admin → Settings → Widget → Install.
  //   sub:   stable unique user id (never email)
  //   email: required
  //   name:  optional
  // Hand { ssoToken } to the page however you already expose session data.
  // Never put the secret in the browser. Never send raw id or email.
  //
  // Quackback("identify", { ssoToken });
  // Quackback("logout");
</script>`
}
