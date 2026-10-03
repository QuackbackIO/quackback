import { expect, it } from 'vitest'
import { WORKSPACE_WEB_PROMPT, WORKSPACE_ROLE_PROMPT } from '../workspace-prompt'
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
