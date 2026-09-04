// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const save = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}))

vi.mock('@/lib/server/functions/settings', () => ({
  updateDeveloperConfigFn: (arg: unknown) => save(arg),
}))

vi.mock('@/components/admin/upgrade', () => ({
  UpgradeModal: ({ open }: { open: boolean }) =>
    open ? <p>The MCP server is a Pro feature. Upgrade to Pro to enable it.</p> : null,
}))

const { McpServerSettings } = await import('../mcp-server-settings')

describe('McpServerSettings enable lock', () => {
  it('opens the upgrade modal and does not save when enable is locked', () => {
    render(
      <McpServerSettings
        entitled={false}
        initialEnabled={false}
        initialDynamicRegistrationEnabled
      />
    )
    fireEvent.click(screen.getByLabelText('Enable MCP Server'))
    expect(screen.getByText(/The MCP server is a Pro feature/)).toBeTruthy()
    expect(save).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Enable MCP Server') as HTMLButtonElement).dataset.state).toBe(
      'unchecked'
    )
  })

  it('saves when the plan includes MCP', async () => {
    render(<McpServerSettings entitled initialEnabled={false} initialDynamicRegistrationEnabled />)
    fireEvent.click(screen.getByLabelText('Enable MCP Server'))
    await waitFor(() => {
      expect(save).toHaveBeenCalledWith({ data: { mcpEnabled: true } })
    })
    expect(screen.queryByText(/The MCP server is a Pro feature/)).toBeNull()
  })

  it('still allows turning MCP off when locked', async () => {
    render(<McpServerSettings entitled={false} initialEnabled initialDynamicRegistrationEnabled />)
    fireEvent.click(screen.getByLabelText('Enable MCP Server'))
    await waitFor(() => {
      expect(save).toHaveBeenCalledWith({ data: { mcpEnabled: false } })
    })
    expect(screen.queryByText(/The MCP server is a Pro feature/)).toBeNull()
  })
})
