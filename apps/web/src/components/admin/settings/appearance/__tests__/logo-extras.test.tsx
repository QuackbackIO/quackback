// @vitest-environment happy-dom
/** The logo's icon, title and colours are each set and cleared by hand. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'

vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: vi.fn() }) }))
const workspace = vi.hoisted(() => ({ writes: 0 }))
vi.mock('@/lib/server/functions/uploads', () => ({
  getFaviconUploadUrlFn: vi.fn(),
  getShareImageUploadUrlFn: vi.fn(),
  getWordmarkUploadUrlFn: async () => ({
    uploadUrl: 'https://storage.example.com/put',
    key: 'header-logos/new.png',
  }),
}))
vi.mock('@/lib/client/mutations/settings', () => ({
  useUploadWorkspaceLogo: () => ({
    mutateAsync: async () => {
      workspace.writes++
    },
  }),
}))

const { LogoColours, LogoNameField, PortalLogoRow } = await import('../logo-extras')

let latest: PortalDesign
function Harness({
  children,
}: {
  children: (props: {
    design: PortalDesign
    update: (c: (d: PortalDesign) => void) => void
  }) => React.ReactNode
}) {
  const [design, setDesign] = useState(() => {
    const start = defaultDesign()
    start.brand.logoColours = ['#0f766e', '#7a1f35']
    return start
  })
  latest = design
  const update = (change: (draft: PortalDesign) => void) =>
    setDesign((current) => {
      const draft = structuredClone(current)
      change(draft)
      return draft
    })
  return <>{children({ design, update })}</>
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  workspace.writes = 0
})

describe('logo extras', () => {
  it('sets the title, and gives the workspace’s name back when emptied', () => {
    render(<Harness>{(props) => <LogoNameField {...props} />}</Harness>)
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Acme' } })
    expect(latest.brand.logo.name).toBe('Acme')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: ' ' } })
    expect(latest.brand.logo.name).toBeUndefined()
  })

  it('shows the logo’s colours and clears them', () => {
    render(<Harness>{(props) => <LogoColours {...props} logoUrl={null} />}</Harness>)
    expect(screen.getByRole('img', { name: /^Logo colours: / })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(latest.brand.logoColours).toBeUndefined()
  })

  it('drafts a new icon for the portal, leaving the workspace’s logo as it is', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 200 }))
    render(
      <Harness>
        {(props) => <PortalLogoRow {...props} logoUrl="https://example.com/workspace.png" />}
      </Harness>
    )
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull()
    const input = screen.getByLabelText('Icon')
    fireEvent.change(input, {
      target: { files: [new File(['png'], 'new.png', { type: 'image/png' })] },
    })
    await waitFor(() =>
      expect(latest.brand.logo.mark.light).toEqual({ key: 'header-logos/new.png' })
    )
    expect(workspace.writes).toBe(0)
    // Removing it shows the workspace's logo again.
    fireEvent.click(screen.getByRole('button', { name: 'Remove icon' }))
    expect(latest.brand.logo.mark.light).toBeNull()
  })
})
