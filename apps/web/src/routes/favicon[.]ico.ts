import { createFileRoute } from '@tanstack/react-router'

/**
 * Browsers ask for /favicon.ico on any page that declares no icon of its own
 * (admin, onboarding). There is no such file, and without this route the
 * request fell through to the page router: before setup is finished the
 * onboarding guard redirected it into the setup page, so every page view also
 * rendered the setup page for the icon request. Point it at the app's icon.
 */
export const Route = createFileRoute('/favicon.ico')({
  server: {
    handlers: {
      GET: () =>
        new Response(null, {
          status: 302,
          headers: {
            Location: '/logo.png',
            'Cache-Control': 'public, max-age=86400',
            Vary: 'Host',
          },
        }),
    },
  },
})
