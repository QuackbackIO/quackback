/**
 * Every MCP tool declares the permissions its caller must hold, and the
 * guard in registerTool checks them against the caller's resolved set before
 * the handler runs. This suite enumerates every tool registerTools registers
 * and fails when one has no declaration, so a new tool cannot ship gated on
 * scope and team role alone.
 */
import { describe, expect, it, vi } from 'vitest'
import { ALL_PERMISSIONS } from '@/lib/shared/permissions'

const captured = vi.hoisted(() => [] as Array<{ name: string; permissions?: unknown }>)
vi.mock('@/lib/server/mcp/tools/helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/mcp/tools/helpers')>()),
  registerTool: (_server: unknown, _auth: unknown, def: { name: string; permissions?: unknown }) =>
    void captured.push(def),
}))

import { registerTools } from '../index'
import type { McpAuthContext } from '../../types'

/** Tools any caller the scope admits may run; their domain policy gates the effect. */
const OPEN_TO_EVERY_CALLER = [
  'add_comment',
  'delete_comment',
  'react_to_comment',
  'update_comment',
  'vote_post',
  'widget_install_status',
]

function registeredTools() {
  captured.length = 0
  const direct: string[] = []
  const server = { tool: (name: string) => void direct.push(name) }
  registerTools(
    server as never,
    {
      principalId: 'principal_test',
      name: 'Test',
      role: 'admin',
      authMethod: 'oauth',
      scopes: [],
    } as unknown as McpAuthContext
  )
  return { tools: [...captured], direct }
}

describe('MCP tool permission declarations', () => {
  it('registers every tool through registerTool, so the guard covers all of them', () => {
    const { tools, direct } = registeredTools()
    expect(direct).toEqual([])
    expect(tools.length).toBeGreaterThan(40)
  })

  it('declares permissions on every tool', () => {
    const undeclared = registeredTools()
      .tools.filter(
        ({ permissions }) =>
          permissions !== 'none' &&
          typeof permissions !== 'function' &&
          !(Array.isArray(permissions) && permissions.length > 0)
      )
      .map(({ name }) => name)
    expect(undeclared).toEqual([])
  })

  it('declares only known permission keys', () => {
    const known = new Set<unknown>(ALL_PERMISSIONS)
    const unknown = registeredTools()
      .tools.filter(({ permissions }) => Array.isArray(permissions))
      .flatMap(({ name, permissions }) =>
        (permissions as unknown[]).filter((p) => !known.has(p)).map((p) => `${name}: ${p}`)
      )
    expect(unknown).toEqual([])
  })

  it('leaves only the reviewed tools open to every caller', () => {
    const open = registeredTools()
      .tools.filter(({ permissions }) => permissions === 'none')
      .map(({ name }) => name)
      .sort()
    expect(open).toEqual(OPEN_TO_EVERY_CALLER)
  })
})
