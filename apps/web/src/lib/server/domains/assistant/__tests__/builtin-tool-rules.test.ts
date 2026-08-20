/**
 * The built-in tool dial's overlay: saved per-tool rules rewrite the
 * catalogue BEFORE assembly, riding the same approvalPolicy seam the remote
 * connector dial uses. The claims that matter:
 *
 *  - `deny` removes the spec entirely — the model never sees the tool.
 *  - `ask`/`allow` stamp approvalPolicy so mode resolution proposes/runs.
 *  - an ABSENT key changes nothing: role policy keeps deciding, byte-for-byte
 *    the pre-dial behavior (the no-rules fast path returns the same specs).
 *  - read/control tools are untouchable whatever the map says.
 */
import { describe, expect, it } from 'vitest'
import {
  applyBuiltInToolRules,
  resolveToolSpecs,
  type AssistantToolSpec,
} from '../assistant.toolspec'
import { resolveEffectiveToolMode } from '../assistant.tools'
import type { AssistantToolContext } from '../assistant.toolspec'

const writeSpec = resolveToolSpecs().find((spec) => spec.risk === 'write')
const readSpec = resolveToolSpecs().find((spec) => spec.risk === 'read')

function ctxWith(policy: 'propose' | 'execute'): AssistantToolContext {
  return { writeToolPolicy: policy === 'propose' ? 'propose' : undefined } as AssistantToolContext
}

describe('applyBuiltInToolRules', () => {
  it('returns the catalogue untouched when no rules are saved', () => {
    const specs = resolveToolSpecs()
    expect(applyBuiltInToolRules(specs, {})).toEqual(specs)
    expect(applyBuiltInToolRules(specs, undefined)).toEqual(specs)
  })

  it('deny removes the tool before the model can see it', () => {
    const specs = resolveToolSpecs()
    const out = applyBuiltInToolRules(specs, { [writeSpec!.name]: 'deny' })
    expect(out.some((spec) => spec.name === writeSpec!.name)).toBe(false)
    expect(out.length).toBe(specs.length - 1)
  })

  it('ask stamps the approval policy the connector dial rides', () => {
    const out = applyBuiltInToolRules(resolveToolSpecs(), { [writeSpec!.name]: 'ask' })
    const stamped = out.find((spec) => spec.name === writeSpec!.name)!
    expect(stamped.approvalPolicy).toBe('approval')
    // And mode resolution proposes even on an autonomous turn.
    expect(resolveEffectiveToolMode(stamped, ctxWith('execute'))).toBe('propose')
  })

  it('allow runs autonomously even where role policy would propose', () => {
    const out = applyBuiltInToolRules(resolveToolSpecs(), { [writeSpec!.name]: 'allow' })
    const stamped = out.find((spec) => spec.name === writeSpec!.name)!
    expect(stamped.approvalPolicy).toBe('always')
    expect(resolveEffectiveToolMode(stamped, ctxWith('propose'))).toBe('autonomous')
  })

  it('an unruled write tool keeps deciding by role policy', () => {
    const other = resolveToolSpecs().filter(
      (spec) => spec.risk === 'write' && spec.name !== writeSpec!.name
    )[0]!
    const out = applyBuiltInToolRules(resolveToolSpecs(), { [writeSpec!.name]: 'deny' })
    const untouched = out.find((spec) => spec.name === other.name)!
    expect(untouched.approvalPolicy).toBeUndefined()
    expect(resolveEffectiveToolMode(untouched, ctxWith('propose'))).toBe('propose')
  })

  it('read tools ignore the map entirely', () => {
    const out = applyBuiltInToolRules(resolveToolSpecs(), { [readSpec!.name]: 'deny' })
    expect(out.some((spec: AssistantToolSpec) => spec.name === readSpec!.name)).toBe(true)
  })
})
