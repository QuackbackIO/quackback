import { PERMISSIONS, type PermissionKey } from './permissions'
import { isProductEnabled, type FeatureFlags } from './types/settings'

/** Suggestions name only work the teammate can read. */
export function workspaceChatStarters(
  permissions: ReadonlySet<PermissionKey>,
  flags: Partial<FeatureFlags> | undefined
): { id: string; defaultMessage: string }[] {
  const prompts: { id: string; defaultMessage: string }[] = []
  if (isProductEnabled(flags, 'feedback') && permissions.has(PERMISSIONS.POST_VIEW_PRIVATE)) {
    prompts.push({
      id: 'ask.starter.weeklyFeedback',
      defaultMessage: 'Summarize this week’s feedback',
    })
    prompts.push({
      id: 'ask.starter.topRequests',
      defaultMessage: 'What are the top requests this month?',
    })
    if (isProductEnabled(flags, 'changelog') && permissions.has(PERMISSIONS.CHANGELOG_MANAGE))
      prompts.push({
        id: 'ask.starter.releaseNotes',
        defaultMessage: 'Draft release notes for shipped ideas',
      })
  }
  if (flags?.supportInbox && permissions.has(PERMISSIONS.CONVERSATION_VIEW))
    prompts.push({
      id: 'ask.starter.waitingReplies',
      defaultMessage: 'Which conversations need a reply?',
    })
  if (isProductEnabled(flags, 'helpCenter') && permissions.has(PERMISSIONS.HELP_CENTER_MANAGE))
    prompts.push({
      id: 'ask.starter.draftArticles',
      defaultMessage: 'Find help center articles still in draft',
    })
  return prompts.slice(0, 3)
}
