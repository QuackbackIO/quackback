// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}))

const { McpSetupGuide } = await import('../mcp-setup-guide')

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
})
