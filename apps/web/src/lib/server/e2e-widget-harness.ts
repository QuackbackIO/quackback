import { isProduction } from '@/lib/server/config'
import { createWidgetIdentityToken } from '@/lib/server/widget/identity-token'
import { ensureWidgetSecret } from '@/lib/server/domains/settings/settings.widget'

export const E2E_WIDGET_CUSTOMER_EMAIL = 'e2e.customer@example.com'
export const E2E_WIDGET_CUSTOMER_EXTERNAL_ID = 'e2e-customer'
export const E2E_WIDGET_CUSTOMER_NAME = 'E2E Customer'
export const E2E_WIDGET_TEAMMATE_EMAIL = 'demo@example.com'
export const E2E_WIDGET_ARTICLE_SLUG = 'e2e-widget-article'
export const E2E_WIDGET_TICKET_TITLE = 'E2E Widget Ticket'
export const E2E_WIDGET_CSAT_SUBJECT = 'E2E CSAT thread'

export type E2eWidgetPersona = 'anon' | 'customer' | 'teammate'

export function isE2eWidgetHarnessEnabled(): boolean {
  if (process.env.E2E_HARNESS === '1') return true
  return !isProduction()
}

export function parseE2eWidgetPersona(raw: string | null): E2eWidgetPersona {
  if (raw === 'customer' || raw === 'teammate' || raw === 'anon') return raw
  return 'anon'
}

export async function mintE2eWidgetHtml(
  persona: E2eWidgetPersona,
  origin: string
): Promise<string> {
  let identity: { ssoToken: string } | undefined
  if (persona !== 'anon') {
    const secret = await ensureWidgetSecret()
    const claims =
      persona === 'teammate'
        ? { id: 'e2e-teammate', email: E2E_WIDGET_TEAMMATE_EMAIL, name: 'Host App Teammate' }
        : {
            id: E2E_WIDGET_CUSTOMER_EXTERNAL_ID,
            email: E2E_WIDGET_CUSTOMER_EMAIL,
            name: E2E_WIDGET_CUSTOMER_NAME,
          }
    identity = { ssoToken: createWidgetIdentityToken(claims, secret, 60 * 60) }
  }

  const init = {
    instanceUrl: origin,
    ...(identity ? { identity } : {}),
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Widget e2e harness</title>
  <meta name="robots" content="noindex" />
</head>
<body>
  <h1>Widget e2e harness</h1>
  <p data-testid="e2e-persona">${persona}</p>
  <script src="/api/widget/sdk.js"></script>
  <script>
    (function () {
      var Quackback = window.Quackback
      if (typeof Quackback !== 'function') return
      Quackback('on', 'identify', function (ev) {
        document.documentElement.dataset.identified = ev && ev.success ? '1' : '0'
        if (ev && ev.user && ev.user.name) {
          document.documentElement.dataset.userName = ev.user.name
        }
        document.documentElement.dataset.anonymous = ev && ev.anonymous ? '1' : '0'
      })
      Quackback('init', ${JSON.stringify(init)})
      Quackback('open')
    })()
  </script>
</body>
</html>`
}
