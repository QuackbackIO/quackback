import { createFileRoute } from '@tanstack/react-router'
import {
  isE2eWidgetHarnessEnabled,
  mintE2eWidgetHtml,
  parseE2eWidgetPersona,
} from '@/lib/server/e2e-widget-harness'

export const Route = createFileRoute('/e2e/widget')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isE2eWidgetHarnessEnabled()) {
          return new Response('Not found', { status: 404 })
        }
        const url = new URL(request.url)
        const html = await mintE2eWidgetHtml(
          parseE2eWidgetPersona(url.searchParams.get('persona')),
          url.origin
        )
        return new Response(html, {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'x-robots-tag': 'noindex',
            'cache-control': 'no-store',
          },
        })
      },
    },
  },
})
