/**
 * The queries behind the reads beside an open conversation in the agent inbox
 * that have no factory of their own elsewhere. Each is its cache entry (see
 * conversation-panel-cache.ts, which the thread request seeds) plus its
 * fetcher, which it uses when it asks on its own: for a ticket, or once its
 * entry goes stale.
 */
import { queryOptions } from '@tanstack/react-query'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import {
  listConversationsForUserFn,
  getConversationAssistantActivityFn,
} from '@/lib/server/functions/conversation'
import { getPortalUserFn } from '@/lib/server/functions/admin'
import { getCompanyForPrincipalFn } from '@/lib/server/functions/companies'
import { getPersonBlockStatusFn } from '@/lib/server/functions/blocking'
import { getMyLanguagePreferenceFn } from '@/lib/server/functions/teammate-preferences'
import { conversationPanelEntries as entries } from '@/lib/client/queries/conversation-panel-cache'

export const conversationPanelQueries = {
  /** The contact card's portal profile (null for a visitor who is not a portal user). */
  contact: (principalId: PrincipalId) =>
    queryOptions({
      ...entries.contact(principalId),
      queryFn: () => getPortalUserFn({ data: { principalId } }),
    }),

  /** The contact's conversations ("Previous conversations"). */
  history: (principalId: PrincipalId) =>
    queryOptions({
      ...entries.history(principalId),
      queryFn: () => listConversationsForUserFn({ data: { principalId } }),
    }),

  /** Quinn's activity on the conversation (null when Quinn never engaged). */
  assistantActivity: (conversationId: ConversationId) =>
    queryOptions({
      ...entries.assistantActivity(conversationId),
      queryFn: () => getConversationAssistantActivityFn({ data: { conversationId } }),
    }),

  /** The contact's company (null when they have none yet). */
  company: (principalId: string) =>
    queryOptions({
      ...entries.company(principalId),
      queryFn: () => getCompanyForPrincipalFn({ data: { principalId } }),
    }),

  /** Whether a person is blocked; shared by every badge and block control. */
  blockStatus: (principalId: PrincipalId) =>
    queryOptions({
      ...entries.blockStatus(principalId),
      queryFn: () => getPersonBlockStatusFn({ data: { principalId } }),
    }),

  /** The signed-in teammate's translation language (null: follow their locale). */
  languagePreference: () =>
    queryOptions({
      ...entries.languagePreference(),
      queryFn: () => getMyLanguagePreferenceFn().then((r) => r.language),
    }),
}
