/**
 * CLI: seed one support conversation with two visitor messages, for e2e tests.
 *
 * By default the visitor is a fresh anonymous principal (type 'anonymous',
 * role 'user'), matching what the widget messenger creates. Pass an email as
 * the second argument to attach the conversation to that user's principal
 * instead (the portal /support surface only lists conversations owned by the
 * signed-in principal); the principal is created if the user exists but has
 * no principal row yet.
 *
 * The conversation row mirrors the app's create path: channel is set
 * explicitly ('messenger'), status 'open', priority 'none', and the
 * denormalized last-message preview/timestamp are populated.
 *
 * Prints a JSON blob: { conversationId, visitorPrincipalId, subject, messages }
 * where conversationId is the TypeID string used in /admin/inbox?c=... URLs.
 *
 * Usage: bun seed-conversation.ts "<subject>" [visitor-email]
 */
import { generateId, toUuid } from '@quackback/ids'
import { openDb } from './_lib'

const subject = process.argv[2]
const visitorEmail = process.argv[3]

if (!subject) {
  console.error('Usage: bun seed-conversation.ts "<subject>" [visitor-email]')
  process.exit(1)
}

const sql = openDb()

/** Resolve (or create) the principal for an existing user email. */
async function principalForEmail(email: string): Promise<string> {
  const users = await sql`SELECT id FROM "user" WHERE email = ${email} LIMIT 1`
  if (users.length === 0) {
    throw new Error(`User not found: ${email} (sign the user in once first)`)
  }
  const userId = users[0].id as string
  const existing = await sql`SELECT id FROM principal WHERE user_id = ${userId} LIMIT 1`
  if (existing.length > 0) return existing[0].id as string
  const uuid = toUuid(generateId('principal'))
  await sql`
    INSERT INTO principal (id, user_id, role, type, created_at)
    VALUES (${uuid}, ${userId}, 'user', 'user', NOW())`
  return uuid
}

/** Create a fresh anonymous visitor principal (widget-messenger shape). */
async function createAnonymousVisitor(): Promise<string> {
  const uuid = toUuid(generateId('principal'))
  await sql`
    INSERT INTO principal (id, user_id, role, type, display_name, created_at)
    VALUES (${uuid}, NULL, 'user', 'anonymous', 'E2E Visitor', NOW())`
  return uuid
}

try {
  const visitorUuid = visitorEmail
    ? await principalForEmail(visitorEmail)
    : await createAnonymousVisitor()

  const messages = [`${subject} - visitor message one`, `${subject} - visitor message two`]

  const conversationTypeId = generateId('conversation')
  const conversationUuid = toUuid(conversationTypeId)
  await sql`
    INSERT INTO conversations
      (id, visitor_principal_id, status, channel, priority, subject,
       last_message_preview, last_message_at, created_at)
    VALUES
      (${conversationUuid}, ${visitorUuid}, 'open', 'messenger', 'none', ${subject},
       ${messages[1]}, NOW(), NOW())`

  // Two visitor messages, a minute apart, so thread ordering is deterministic.
  for (let i = 0; i < messages.length; i++) {
    const msgUuid = toUuid(generateId('conversation_msg'))
    await sql`
      INSERT INTO conversation_messages
        (id, conversation_id, principal_id, sender_type, content, is_internal, created_at)
      VALUES
        (${msgUuid}, ${conversationUuid}, ${visitorUuid}, 'visitor', ${messages[i]}, false,
         NOW() - make_interval(mins => ${messages.length - i}))`
  }

  console.log(
    JSON.stringify({
      conversationId: conversationTypeId,
      visitorPrincipalId: visitorUuid,
      subject,
      messages,
    })
  )
  await sql.end()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  await sql.end()
  process.exit(1)
}
