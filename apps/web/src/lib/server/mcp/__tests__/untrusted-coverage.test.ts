/**
 * Every registered MCP tool must declare which of its result fields hold text
 * from outside the team (or declare none) in UNTRUSTED_TOOL_FIELDS. A new tool
 * without a declaration fails here, so its results cannot ship unmarked.
 */
import { describe, expect, it } from 'vitest'
import { registerTools } from '@/lib/server/mcp/tools'
import { UNTRUSTED_TOOL_FIELDS, type UntrustedRule } from '../untrusted'

const TEST_AUTH = {
  principalId: 'principal_test',
  name: 'Test',
  role: 'admin',
  authMethod: 'api-key',
  scopes: [],
} as never

function registeredToolNames(): string[] {
  const names: string[] = []
  registerTools(
    {
      registerTool: (name: string) => {
        names.push(name)
      },
    } as never,
    TEST_AUTH
  )
  return names
}

/** `a`, `a.b`, `a[].b`, `a[].b[].c`: keys joined by dots, `[]` after an array key. */
const PATH = /^[A-Za-z][A-Za-z0-9]*(\[\])?(\.[A-Za-z][A-Za-z0-9]*(\[\])?)*$/
/** Plain key paths (no wildcard) for per-item rules. */
const KEY_PATH = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$/

function malformedPaths(rules: readonly UntrustedRule[]): string[] {
  const bad: string[] = []
  for (const rule of rules) {
    if (typeof rule === 'string') {
      if (!PATH.test(rule)) bad.push(rule)
    } else if ('each' in rule) {
      for (const path of [rule.each, ...rule.fields, ...(rule.nested ? [rule.nested] : [])]) {
        if (!KEY_PATH.test(path)) bad.push(path)
      }
    } else if ('at' in rule) {
      // `at` is '' for the result itself.
      for (const path of [...(rule.at ? [rule.at] : []), ...rule.fields]) {
        if (!KEY_PATH.test(path)) bad.push(path)
      }
    } else {
      bad.push(...malformedPaths(rule.rules))
    }
  }
  return bad
}

describe('untrusted-field registry', () => {
  it('declares every registered tool', () => {
    const declared = new Set(Object.keys(UNTRUSTED_TOOL_FIELDS))
    const undeclared = registeredToolNames().filter((name) => !declared.has(name))
    expect(
      undeclared,
      'Add each tool to UNTRUSTED_TOOL_FIELDS in mcp/untrusted.ts: list its outside-authored result paths, or [] when it returns none'
    ).toEqual([])
  })

  it('declares no tool that is not registered', () => {
    const registered = new Set(registeredToolNames())
    expect(Object.keys(UNTRUSTED_TOOL_FIELDS).filter((name) => !registered.has(name))).toEqual([])
  })

  it('uses only well-formed paths', () => {
    for (const [tool, rules] of Object.entries(UNTRUSTED_TOOL_FIELDS)) {
      expect(malformedPaths(rules), tool).toEqual([])
    }
  })
})
