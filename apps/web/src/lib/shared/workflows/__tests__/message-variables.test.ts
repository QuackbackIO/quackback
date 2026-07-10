import { describe, it, expect } from 'vitest'
import { WORKFLOW_VARIABLE_CATALOGUE } from '../message-variables'

describe('WORKFLOW_VARIABLE_CATALOGUE', () => {
  it('exposes the v1 catalogue keys', () => {
    expect(WORKFLOW_VARIABLE_CATALOGUE.map((v) => v.key)).toEqual([
      'first_name',
      'name',
      'email',
      'workspace_name',
    ])
  })

  it('has a unique key per entry', () => {
    const keys = WORKFLOW_VARIABLE_CATALOGUE.map((v) => v.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('gives every entry a non-empty display label', () => {
    for (const entry of WORKFLOW_VARIABLE_CATALOGUE) {
      expect(entry.label.length).toBeGreaterThan(0)
    }
  })
})
