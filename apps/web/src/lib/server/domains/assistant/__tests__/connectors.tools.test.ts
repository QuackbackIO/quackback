import { describe, expect, it } from 'vitest'
import {
  connectorToolName,
  formatConnectorToolDescription,
  uniqueConnectorToolName,
} from '../connectors.names'

describe('connectorToolName', () => {
  it('prefixes the slug and sanitizes the remote name', () => {
    expect(connectorToolName({ slug: 'tracker' }, 'Create Issue')).toBe('mcp_tracker_create_issue')
  })
})

describe('uniqueConnectorToolName', () => {
  it('suffixes collisions so two remotes cannot share a model-facing name', () => {
    const used = new Set<string>()
    expect(uniqueConnectorToolName('mcp_tracker_get_user', used)).toBe('mcp_tracker_get_user')
    expect(uniqueConnectorToolName('mcp_tracker_get_user', used)).toBe('mcp_tracker_get_user_2')
    expect(uniqueConnectorToolName('mcp_tracker_get_user', used)).toBe('mcp_tracker_get_user_3')
  })
})

describe('formatConnectorToolDescription', () => {
  it('appends the remote JSON Schema so the model sees argument names', () => {
    const schema = JSON.stringify({
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
    })
    expect(formatConnectorToolDescription('Create an issue.', schema)).toContain(
      'Argument JSON Schema:'
    )
    expect(formatConnectorToolDescription('Create an issue.', schema)).toContain('"title"')
  })

  it('returns the fallback when the stored schema is not JSON', () => {
    expect(formatConnectorToolDescription('Create an issue.', 'not-json')).toBe('Create an issue.')
  })
})
