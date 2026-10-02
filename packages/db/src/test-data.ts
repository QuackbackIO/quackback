import { sql, type SQL, type SQLWrapper } from 'drizzle-orm'

/** Generated and test content stays outside product metrics and delivery. */
export function isTestRecord(attributes: unknown): boolean {
  if (!attributes || typeof attributes !== 'object') return false
  const value = attributes as Record<string, unknown>
  return (
    value.test === true ||
    value.test === 'true' ||
    value.onboardingGenerated === true ||
    value.onboardingGenerated === 'true'
  )
}

/** Use with an attributes column, including qualified columns in rollup queries. */
export function notTestRecord(attributes: SQLWrapper): SQL {
  return sql`coalesce(${attributes}->>'test', 'false') <> 'true' and coalesce(${attributes}->>'onboardingGenerated', 'false') <> 'true'`
}

/** A correlated probe also handles nullable attribution and table aliases. */
export function notTestPrincipal(principalId: SQLWrapper): SQL {
  return sql`not exists (select 1 from principal test_identity where test_identity.id = ${principalId} and test_identity.test_owner_principal_id is not null)`
}

/** Related metrics use the conversation's protected marker and stored identity. */
export function notTestConversation(conversationId: SQLWrapper): SQL {
  return sql`not exists (select 1 from conversations test_conversation where test_conversation.id = ${conversationId} and (not (${notTestRecord(sql`test_conversation.custom_attributes`)}) or not (${notTestPrincipal(sql`test_conversation.visitor_principal_id`)})))`
}
