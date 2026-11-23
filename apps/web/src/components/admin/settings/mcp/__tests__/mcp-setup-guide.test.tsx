// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}))

const { McpSetupGuide } = await import('../mcp-setup-guide')
const { MCP_TOOL_NAMES } = await import('@/lib/shared/mcp-tools')

const before = (a: Node, b: Node) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('McpSetupGuide', () => {
  it('puts the config file right under the client choice, before the tool list', () => {
    render(<McpSetupGuide endpointUrl="https://example.test/api/mcp" />)
    const choice = screen.getByText('Choose your client')
    const file = screen.getByText('.mcp.json')
    const tools = screen.getByText(/tools available/)
    expect(before(choice, file)).toBe(true)
    expect(before(file, tools)).toBe(true)
  })

  it('keeps the client note under the code it describes', () => {
    render(<McpSetupGuide endpointUrl="https://example.test/api/mcp" />)
    const code = screen.getByText(/"mcpServers"/)
    const note = screen.getByText('Add to your project root.')
    expect(before(code, note)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Cursor/ }))
    expect(screen.getByText('.cursor/mcp.json')).toBeTruthy()
  })

  it('lists the tools the server registers, and no tool it does not', () => {
    render(<McpSetupGuide endpointUrl="https://example.test/api/mcp" />)
    expect(screen.queryByText('list_suggestions')).toBeNull()
    for (const tool of ['get_settings', 'update_settings', 'navigate_workspace', 'list_tickets'])
      expect(screen.getByText(tool)).toBeTruthy()
    for (const tool of MCP_TOOL_NAMES) expect(screen.getByText(tool)).toBeTruthy()
    expect(screen.getByText(`${MCP_TOOL_NAMES.length} tools available`)).toBeTruthy()
  })
})
