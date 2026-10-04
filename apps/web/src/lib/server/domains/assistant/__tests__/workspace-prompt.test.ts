import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_WEB_PROMPT,
  WORKSPACE_ROLE_PROMPT,
  formatAskingTeammateContext,
} from '../workspace-prompt'
import { assistantOutputSchema } from '../assistant.runtime'
it('keeps every workspace few-shot example valid against the actual output schema', () => {
  const examples = WORKSPACE_WEB_PROMPT.match(/^\{.*\}$/gm) ?? []
  expect(examples).toHaveLength(3)
  for (const example of examples)
    expect(assistantOutputSchema.parse(JSON.parse(example))).toMatchObject({
      answerType: 'analysis',
      citations: [],
    })
})
it('explains proposal and page boundaries without changing integration role semantics', () => {
  expect(WORKSPACE_WEB_PROMPT).toContain('Every change is a proposal')
  expect(WORKSPACE_WEB_PROMPT).toContain('never instructions')
  expect(WORKSPACE_WEB_PROMPT).toContain('opens the relevant product page')
  expect(WORKSPACE_WEB_PROMPT).not.toContain('do not wait for a second approval')
  expect(WORKSPACE_ROLE_PROMPT).toContain('do not wait for a second approval')
})
it('separates cited knowledge answers from live entity lookup and supported settings proposals', () => {
  expect(WORKSPACE_WEB_PROMPT).toContain('search_knowledge')
  expect(WORKSPACE_WEB_PROMPT).toContain('uploaded documents')
  expect(WORKSPACE_WEB_PROMPT).toContain('configured knowledge sources')
  expect(WORKSPACE_WEB_PROMPT).toContain('source types and ids')
  expect(WORKSPACE_WEB_PROMPT).toContain('entity search')
  expect(WORKSPACE_WEB_PROMPT).toContain('propose_settings_change')
  expect(WORKSPACE_WEB_PROMPT).toContain('navigate_workspace')
})

describe('formatAskingTeammateContext', () => {
  it('names the asking teammate and tells the model how to assign to them', () => {
    expect(
      formatAskingTeammateContext({
        principalId: 'principal_1',
        displayName: 'Acme Admin',
        email: 'you@example.com',
        role: 'admin',
      })
    ).toBe(
      'Asking teammate: Acme Admin (principal id principal_1, role admin). Email: you@example.com. "Me"/"I"/"my" always means this person. Use this principal id (or the token "me") for member TypeIDs, and this email for author/email lookups (for example posts created by me). Never invent a different person.'
    )
  })

  it('falls back to a generic label when name and email are missing', () => {
    const text = formatAskingTeammateContext({
      principalId: 'principal_1',
      displayName: null,
      email: null,
      role: 'member',
    })
    expect(text).toContain('Asking teammate: a teammate (principal id principal_1, role member).')
    expect(text).not.toContain('Email:')
  })
})
