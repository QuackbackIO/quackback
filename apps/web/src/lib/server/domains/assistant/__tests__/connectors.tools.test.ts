import { describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { AssistantConnectorRow } from '@/lib/server/db'
import {
  connectorCallArgs,
  connectorToolInputSchema,
  connectorToolName,
  formatConnectorToolDescription,
  uniqueConnectorToolName,
} from '../connectors.names'

vi.mock('../connectors.service', () => ({
  invokeConnectorTool: vi.fn(async () => ({ ok: true, data: {} })),
}))

import { assembleConnectorSpecs, buildConnectorToolSpec } from '../connectors.tools'

describe('connectorToolName', () => {
  it('prefixes the slug, sanitizes the remote name, and hashes the original', () => {
    const name = connectorToolName({ slug: 'tracker' }, 'Create Issue')
    expect(name.startsWith('mcp_tracker_create_issue_')).toBe(true)
    expect(name).toBe(connectorToolName({ slug: 'tracker' }, 'Create Issue'))
    expect(name).not.toBe(connectorToolName({ slug: 'tracker' }, 'create_issue'))
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

describe('connectorToolInputSchema', () => {
  it('exposes named required and optional fields from MCP JSON Schema', () => {
    const schema = connectorToolInputSchema(
      JSON.stringify({
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Issue title' },
          estimate: { type: 'number' },
        },
        required: ['title'],
      })
    )
    expect(schema.safeParse({ title: 'Outage' }).success).toBe(true)
    expect(schema.safeParse({ title: 'Outage', estimate: 2 }).success).toBe(true)
    expect(schema.safeParse({ estimate: 2 }).success).toBe(false)
    expect(schema.safeParse({ title: 'Outage', extra: true }).success).toBe(true)
  })

  it('falls back to a loose record when the stored schema is empty or invalid', () => {
    expect(connectorToolInputSchema('not-json').safeParse({ anything: 1 }).success).toBe(true)
    expect(
      connectorToolInputSchema(JSON.stringify({ type: 'object', properties: {} })).safeParse({
        anything: 1,
      }).success
    ).toBe(true)
  })
})

describe('connectorCallArgs', () => {
  it('passes named fields through and unwraps the legacy arguments bag', () => {
    expect(connectorCallArgs({ title: 'Outage' })).toEqual({ title: 'Outage' })
    expect(connectorCallArgs({ arguments: { title: 'Outage' } })).toEqual({ title: 'Outage' })
    expect(connectorCallArgs(null)).toEqual({})
  })
})

function fakeConnector(over: Partial<AssistantConnectorRow> = {}): AssistantConnectorRow {
  return {
    id: 'assistant_connector_1',
    name: 'Tracker',
    slug: 'tracker',
    transport: 'http',
    url: 'https://mcp.example.com/mcp',
    authTokenCiphertext: null,
    tools: [
      {
        name: 'create_issue',
        description: 'Create an issue',
        inputSchemaJson: JSON.stringify({
          type: 'object',
          properties: { title: { type: 'string' } },
          required: ['title'],
        }),
      },
      {
        name: 'delete_issue',
        description: 'Delete an issue',
        inputSchemaJson: JSON.stringify({ type: 'object', properties: {} }),
      },
    ],
    toolRules: {},
    assignments: { agent: true, copilot: true },
    enabled: true,
    lastSyncedAt: null,
    lastSyncError: null,
    createdById: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...over,
  } as AssistantConnectorRow
}

describe('buildConnectorToolSpec', () => {
  it('declares conversation.reply and a named input schema', () => {
    const spec = buildConnectorToolSpec(fakeConnector(), {
      name: 'create_issue',
      description: 'Create an issue',
      inputSchemaJson: JSON.stringify({
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
      }),
    })
    expect(spec.permissions).toEqual([PERMISSIONS.CONVERSATION_REPLY])
    expect(spec.definition.inputSchema.safeParse({ title: 'Outage' }).success).toBe(true)
    expect(spec.definition.inputSchema.safeParse({}).success).toBe(false)
  })
})

describe('assembleConnectorSpecs', () => {
  it('omits denied tools and unassigned / disabled connectors', () => {
    const { specs, toolRulesPatch } = assembleConnectorSpecs(
      [
        fakeConnector({
          toolRules: { create_issue: 'allow', delete_issue: 'deny' },
        }),
        fakeConnector({
          id: 'assistant_connector_2',
          slug: 'other',
          assignments: { agent: false, copilot: true },
        }),
        fakeConnector({
          id: 'assistant_connector_3',
          slug: 'off',
          enabled: false,
        }),
      ],
      'agent'
    )
    const createIssueName = connectorToolName({ slug: 'tracker' }, 'create_issue')
    expect(specs.map((spec) => spec.name)).toEqual([createIssueName])
    expect(toolRulesPatch).toEqual({ [createIssueName]: 'allow' })
  })
})
