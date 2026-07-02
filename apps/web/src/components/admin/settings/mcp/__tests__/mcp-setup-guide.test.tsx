// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { McpSetupGuide } from '../mcp-setup-guide'

const mocks = vi.hoisted(() => ({
  writeText: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
  }: {
    children: ReactNode
    to: string
    search?: Record<string, unknown>
    className?: string
  }) => <a href={to}>{children}</a>,
}))

vi.mock('@/components/admin/settings/widget/highlighted-code', () => ({
  HighlightedCode: ({ code, lang }: { code: string; lang: string }) => (
    <pre data-lang={lang}>{code}</pre>
  ),
}))

vi.mock('@heroicons/react/24/solid', () => ({
  ArrowTopRightOnSquareIcon: () => <span aria-hidden="true">external</span>,
  CheckIcon: () => <span aria-hidden="true">check</span>,
  ClipboardDocumentIcon: () => <span aria-hidden="true">copy</span>,
}))

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: mocks.writeText,
    },
  })
  mocks.writeText.mockResolvedValue(undefined)
})

describe('McpSetupGuide', () => {
  it('renders setup steps, available tools, and copies endpoint/config snippets', async () => {
    render(<McpSetupGuide endpointUrl="https://app.example.test/api/mcp" />)

    expect(screen.getByText('Setup Guide')).toBeInTheDocument()
    expect(screen.getByText('Connect an AI tool to your MCP server')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'API key' })).toHaveAttribute(
      'href',
      '/admin/settings/developers'
    )
    expect(screen.getByText('53 tools available')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Reference/ })).toHaveAttribute(
      'href',
      'https://www.quackback.io/docs/mcp/reference'
    )
    expect(screen.getByText('manage_ticket_share')).toBeInTheDocument()
    expect(screen.getByText('.mcp.json')).toBeInTheDocument()
    expect(screen.getByText(/"type": "http"/)).toBeInTheDocument()
    expect(screen.queryByText(/\$\{QUACKBACK_API_KEY\}/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('https://app.example.test/api/mcp').closest('button')!)
    await waitFor(() => {
      expect(mocks.writeText).toHaveBeenCalledWith('https://app.example.test/api/mcp')
    })

    fireEvent.click(screen.getByRole('button', { name: 'API Key' }))
    expect(screen.getByText(/\$\{QUACKBACK_API_KEY\}/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => {
      expect(mocks.writeText).toHaveBeenLastCalledWith(
        expect.stringContaining('Bearer ${QUACKBACK_API_KEY}')
      )
    })
    expect(screen.getByText('Copied')).toBeInTheDocument()
  })

  it('switches between client-specific configuration formats', () => {
    render(<McpSetupGuide endpointUrl="https://app.example.test/api/mcp" />)

    fireEvent.click(screen.getByRole('button', { name: 'Cursor' }))
    expect(screen.getByText('.cursor/mcp.json')).toBeInTheDocument()
    expect(screen.getByText(/\$\{env:QUACKBACK_API_KEY\}/)).toBeInTheDocument()
    expect(screen.getByText(/OAuth is not supported/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'OAuth (recommended)' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'VS Code' }))
    expect(screen.getByText('.vscode/mcp.json')).toBeInTheDocument()
    expect(screen.getByText(/"inputs"/)).toBeInTheDocument()
    expect(screen.getByText(/\$\{input:quackback-api-key\}/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Windsurf' }))
    expect(screen.getByText('~/.codeium/windsurf/mcp_config.json')).toBeInTheDocument()
    expect(screen.getAllByText(/"serverUrl"/).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Claude Desktop' }))
    expect(screen.getByText('claude_desktop_config.json')).toBeInTheDocument()
    expect(screen.getByText(/mcp-remote@latest/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'API Key' }))
    expect(screen.getByText(/qb_YOUR_API_KEY/)).toBeInTheDocument()
  })
})
