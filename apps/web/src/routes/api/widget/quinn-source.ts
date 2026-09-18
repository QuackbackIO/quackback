import { createFileRoute } from '@tanstack/react-router'
import { getAssistantSettings } from '@/lib/server/domains/settings/settings.assistant'
import { getCustomerCitationSource } from '@/lib/server/domains/assistant/public-source'
import { enforcePerIpLimit } from '@/lib/server/widget/public-endpoint'

export async function handleQuinnSource({ request }: { request: Request }): Promise<Response> {
  const limited = await enforcePerIpLimit(request, {
    keyPrefix: 'quinn-source',
    limit: 60,
    windowSeconds: 60,
    message: 'Too many requests',
  })
  if (limited) return limited
  const url = new URL(request.url)
  const { config } = await getAssistantSettings()
  const source = await getCustomerCitationSource(
    url.searchParams.get('type') ?? '',
    url.searchParams.get('id') ?? '',
    config.agents.agent.knowledge
  )
  return new Response(
    source
      ? `${source.title}\n\n${source.content}`
      : 'This source is no longer available. Return to your conversation for continued support.',
    {
      status: source ? 200 : 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    }
  )
}
export const Route = createFileRoute('/api/widget/quinn-source')({
  server: { handlers: { GET: handleQuinnSource } },
})
