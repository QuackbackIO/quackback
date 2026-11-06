/**
 * The "via" line under an audit row's actor: how a change that did not come
 * from someone using the app arrived, and for whom.
 */
import { describe, it, expect } from 'vitest'
import { createIntl } from 'react-intl'
import { attributionLine, attributionTooltip } from '../audit-log-page'

const intl = createIntl({ locale: 'en', messages: {}, onError: () => {} })

const base = {
  channel: null,
  clientName: null,
  onBehalfOfName: null,
} as const

describe('attributionLine', () => {
  it('names the channel, the client and the person it acted for', () => {
    expect(
      attributionLine(
        { channel: 'mcp', clientName: 'Claude Desktop', onBehalfOfName: 'James Morton' },
        intl
      )
    ).toBe('via MCP · Claude Desktop for James Morton')
    expect(
      attributionLine({ channel: 'api', clientName: 'Zapier', onBehalfOfName: null }, intl)
    ).toBe('via API · Zapier')
  })

  it('reads plainly without a client or a person', () => {
    expect(attributionLine({ ...base, channel: 'system' }, intl)).toBe('via system')
    expect(attributionLine({ ...base, channel: 'workflow', clientName: 'Auto-close' }, intl)).toBe(
      'via workflow · Auto-close'
    )
    expect(
      attributionLine(
        { channel: 'assistant', clientName: 'Quackback AI', onBehalfOfName: 'Jane Doe' },
        intl
      )
    ).toBe('via assistant · Quackback AI for Jane Doe')
  })

  it('shows the product name for an assistant row stored under the former default name', () => {
    expect(
      attributionLine(
        { channel: 'assistant', clientName: 'Quinn', onBehalfOfName: 'Jane Doe' },
        intl
      )
    ).toBe('via assistant · Quackback AI for Jane Doe')
  })

  it('keeps a client name that happens to match the former default outside the assistant channel', () => {
    expect(
      attributionLine({ channel: 'mcp', clientName: 'Quinn', onBehalfOfName: null }, intl)
    ).toBe('via MCP · Quinn')
  })

  it('stays quiet for changes made in the app and for rows with no attribution', () => {
    expect(attributionLine({ ...base, channel: 'ui' }, intl)).toBeNull()
    expect(attributionLine(base, intl)).toBeNull()
    expect(attributionLine({ ...base, channel: 'carrier_pigeon' as never }, intl)).toBeNull()
  })

  it('uses the translation when there is one', () => {
    const de = createIntl({
      locale: 'de',
      messages: {
        'admin.auditLog.via.api': 'über API',
        'admin.auditLog.via.onBehalfOf': 'für {name}',
      },
      onError: () => {},
    })
    expect(
      attributionLine({ channel: 'api', clientName: 'Zapier', onBehalfOfName: 'Jana' }, de)
    ).toBe('über API · Zapier für Jana')
  })
})

describe('attributionTooltip', () => {
  it('adds the client id, so two clients with look-alike names can be told apart', () => {
    expect(
      attributionTooltip(
        {
          channel: 'mcp',
          clientName: 'Claude Desktop',
          onBehalfOfName: 'James Morton',
          credentialId: 'client_desktop',
        },
        intl
      )
    ).toBe('via MCP · Claude Desktop for James Morton (client_desktop)')
  })

  it('is the line alone when no credential made the change', () => {
    expect(
      attributionTooltip(
        { channel: 'workflow', clientName: 'Auto-close', onBehalfOfName: null, credentialId: null },
        intl
      )
    ).toBe('via workflow · Auto-close')
    expect(attributionTooltip({ ...base, credentialId: null }, intl)).toBeNull()
  })
})
