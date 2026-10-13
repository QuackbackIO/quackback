import { expect, it } from 'vitest'
import { workspaceChatStarters } from '../workspace-starters'
import { PERMISSIONS } from '../permissions'
it('offers only prompts the teammate can read', () => {
  expect(workspaceChatStarters(new Set(), { supportInbox: true, helpCenter: true })).toEqual([])
  const prompts = workspaceChatStarters(new Set([PERMISSIONS.CONVERSATION_VIEW]), { supportInbox: true })
  expect(prompts.map(prompt => prompt.id)).toEqual(['ask.starter.waitingReplies'])
})
it('does not offer support or article prompts when their modules are off', () => {
  expect(workspaceChatStarters(new Set([PERMISSIONS.CONVERSATION_VIEW, PERMISSIONS.HELP_CENTER_MANAGE]), { supportInbox: false, helpCenter: false })).toEqual([])
})
