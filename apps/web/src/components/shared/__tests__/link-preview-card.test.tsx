// @vitest-environment happy-dom
/**
 * A link preview fetches through the surface's own endpoint: the widget's
 * Bearer session is refused by the site endpoint, so a widget card that called
 * it would never render.
 */
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  portalVisitorRpc,
  VisitorSurfaceRpcProvider,
  type VisitorSurfaceRpc,
} from '@/lib/client/visitor-surface-rpc'
import { widgetVisitorRpc } from '@/lib/client/widget-visitor-rpc'
import { unfurlLinkFn } from '@/lib/server/functions/link-preview'
import { widgetUnfurlLinkFn } from '@/lib/server/functions/widget/conversation'
import { LinkPreviewCard } from '../link-preview-card'

afterEach(cleanup)

function renderCard(rpc: VisitorSurfaceRpc, getAuthHeaders?: () => Record<string, string>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <VisitorSurfaceRpcProvider value={rpc}>{children}</VisitorSurfaceRpcProvider>
    </QueryClientProvider>
  )
  return render(
    <LinkPreviewCard url="https://news.example/post" getAuthHeaders={getAuthHeaders} />,
    {
      wrapper,
    }
  )
}

describe('LinkPreviewCard', () => {
  it("fetches through the surface's unfurl endpoint with its auth headers", async () => {
    const unfurlLink = vi.fn().mockResolvedValue({
      url: 'https://news.example/post',
      title: 'A post worth reading',
    })
    const rpc = { ...portalVisitorRpc, unfurlLink } as unknown as VisitorSurfaceRpc

    renderCard(rpc, () => ({ authorization: 'Bearer widget-token' }))

    expect(await screen.findByText('A post worth reading')).toBeInTheDocument()
    expect(unfurlLink).toHaveBeenCalledWith({
      data: { url: 'https://news.example/post' },
      headers: { authorization: 'Bearer widget-token' },
    })
  })

  it('wires each surface to its own endpoint', () => {
    expect(portalVisitorRpc.unfurlLink).toBe(unfurlLinkFn)
    expect(widgetVisitorRpc.unfurlLink).toBe(widgetUnfurlLinkFn)
  })
})
