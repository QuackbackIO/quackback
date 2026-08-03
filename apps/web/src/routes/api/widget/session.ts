import { createFileRoute } from '@tanstack/react-router'
import { getWidgetSession } from '@/lib/server/functions/widget-auth'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'widget-session' })

export const Route = createFileRoute('/api/widget/session')({
  server: {
    handlers: {
      GET: async () => {
        try {
          // `roll: true` extends an active anonymous session's TTL on this
          // validation hit (the widget calls it once per mount), so a returning
          // visitor's session — and thus their conversation — survives past the
          // original 7-day window. Validation-only endpoint; hot paths stay raw.
          const session = await getWidgetSession({ roll: true })
          if (!session) {
            return Response.json(
              { error: { code: 'AUTH_REQUIRED', message: 'Valid widget session required' } },
              { status: 401, headers: noStoreHeaders() }
            )
          }

          const isAnonymous = session.principal.type === 'anonymous'

          return Response.json(
            {
              data: {
                user: isAnonymous
                  ? null
                  : {
                      id: session.user.id,
                      name: session.user.name,
                      email: session.user.email,
                      avatarUrl: session.user.image,
                    },
                // True iff this widget user is linked to a CRM contact via a
                // verified identify. Drives the widget UI's decision to show
                // "My tickets" — anonymous / unverified sessions can still
                // file a ticket via inline email but cannot list past ones.
                contactLinked: !isAnonymous && session.contactId !== null,
              },
            },
            { headers: noStoreHeaders() }
          )
        } catch (error) {
          log.error({ err: error }, 'widget session load failed')
          return Response.json(
            { error: { code: 'SERVER_ERROR', message: 'Failed to load widget session' } },
            { status: 500, headers: noStoreHeaders() }
          )
        }
      },
    },
  },
})

function noStoreHeaders(): HeadersInit {
  return {
    'Cache-Control': 'no-store',
  }
}
