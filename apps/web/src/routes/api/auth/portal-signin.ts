import { createFileRoute } from '@tanstack/react-router'
import { requestEmailSignin } from '@/lib/server/auth/email-signin'

interface PortalSigninBody {
  email?: unknown
  callbackURL?: unknown
}

export const Route = createFileRoute('/api/auth/portal-signin')({
  server: {
    handlers: {
      /**
       * POST /api/auth/portal-signin
       * Triggers a passwordless sign-in email containing both a magic
       * link and a 6-digit OTP. The frontend then shows the OTP input
       * as primary; users can also click the link in the email.
       */
      POST: async ({ request }) => {
        let body: PortalSigninBody
        try {
          body = (await request.json()) as PortalSigninBody
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        if (typeof body.email !== 'string' || !body.email.includes('@')) {
          return Response.json({ error: 'Valid email required' }, { status: 400 })
        }
        const callbackURL = typeof body.callbackURL === 'string' ? body.callbackURL : '/'

        try {
          await requestEmailSignin({ email: body.email, callbackURL })
          return Response.json({ ok: true })
        } catch (err) {
          console.error('[auth] portal-signin failed:', err)
          return Response.json(
            { error: err instanceof Error ? err.message : 'Failed to send sign-in email' },
            { status: 500 }
          )
        }
      },
    },
  },
})
