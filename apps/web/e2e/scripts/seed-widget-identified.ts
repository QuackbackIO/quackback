/**
 * Idempotent fixtures for identified widget e2e: a customer user, a published
 * help article, a requester ticket, and a closed CSAT conversation.
 *
 * Usage: bun seed-widget-identified.ts
 */
import { generateId, toUuid } from '@quackback/ids'
import { openDb } from './_lib'

const CUSTOMER_EMAIL = 'e2e.customer@example.com'
const CUSTOMER_EXTERNAL_ID = 'e2e-customer'
const CUSTOMER_NAME = 'E2E Customer'
const ARTICLE_SLUG = 'e2e-widget-article'
const ARTICLE_TITLE = 'E2E Widget Article'
const CATEGORY_SLUG = 'e2e-help'
const TICKET_TITLE = 'E2E Widget Ticket'
const CSAT_SUBJECT = 'E2E CSAT thread'

const sql = openDb()

async function one<T extends Record<string, unknown>>(rows: T[], label: string): Promise<T> {
  if (rows.length === 0) throw new Error(label)
  return rows[0]
}

try {
  let customer = await sql<{ id: string }[]>`
    SELECT id FROM "user" WHERE email = ${CUSTOMER_EMAIL} LIMIT 1`
  let customerUserId: string
  if (customer.length === 0) {
    customerUserId = toUuid(generateId('user'))
    await sql`
      INSERT INTO "user" (id, name, email, email_verified, external_id, is_anonymous, created_at, updated_at)
      VALUES (${customerUserId}, ${CUSTOMER_NAME}, ${CUSTOMER_EMAIL}, true, ${CUSTOMER_EXTERNAL_ID}, false, NOW(), NOW())`
  } else {
    customerUserId = customer[0].id
    await sql`UPDATE "user" SET external_id = ${CUSTOMER_EXTERNAL_ID} WHERE id = ${customerUserId}`
  }

  let principalRows = await sql<{ id: string }[]>`
    SELECT id FROM principal WHERE user_id = ${customerUserId} LIMIT 1`
  let customerPrincipalId: string
  if (principalRows.length === 0) {
    customerPrincipalId = toUuid(generateId('principal'))
    await sql`
      INSERT INTO principal (id, user_id, role, type, display_name, created_at)
      VALUES (${customerPrincipalId}, ${customerUserId}, 'user', 'user', ${CUSTOMER_NAME}, NOW())`
  } else {
    customerPrincipalId = principalRows[0].id
  }

  const author = await one(
    await sql<{ id: string }[]>`
      SELECT p.id FROM principal p
      JOIN "user" u ON u.id = p.user_id
      WHERE u.email = ${'demo@example.com'}
      LIMIT 1`,
    'demo@example.com principal missing (run db:seed first)'
  )
  const authorPrincipalId = author.id

  let category = await sql<{ id: string }[]>`
    SELECT id FROM kb_categories WHERE slug = ${CATEGORY_SLUG} LIMIT 1`
  let categoryId: string
  if (category.length === 0) {
    categoryId = toUuid(generateId('kb_category'))
    await sql`
      INSERT INTO kb_categories (id, slug, name, description, is_public, position, created_at, updated_at)
      VALUES (${categoryId}, ${CATEGORY_SLUG}, ${'E2E Help'}, ${'Harness fixtures'}, true, 0, NOW(), NOW())`
  } else {
    categoryId = category[0].id
  }

  let article = await sql<{ id: string; slug: string }[]>`
    SELECT id, slug FROM kb_articles WHERE slug = ${ARTICLE_SLUG} LIMIT 1`
  if (article.length === 0) {
    const articleId = toUuid(generateId('article'))
    await sql`
      INSERT INTO kb_articles
        (id, category_id, slug, title, content, principal_id, published_at, created_at, updated_at)
      VALUES
        (${articleId}, ${categoryId}, ${ARTICLE_SLUG}, ${ARTICLE_TITLE},
         ${'How to use the widget e2e harness.'}, ${authorPrincipalId}, NOW(), NOW(), NOW())`
    article = [{ id: articleId, slug: ARTICLE_SLUG }]
  }

  let csat = await sql<{ id: string }[]>`
    SELECT id FROM conversations
    WHERE visitor_principal_id = ${customerPrincipalId} AND subject = ${CSAT_SUBJECT}
    LIMIT 1`
  let csatConversationId: string
  if (csat.length === 0) {
    csatConversationId = toUuid(generateId('conversation'))
    await sql`
      INSERT INTO conversations
        (id, visitor_principal_id, status, channel, priority, subject,
         last_message_preview, last_message_at, created_at)
      VALUES
        (${csatConversationId}, ${customerPrincipalId}, 'open', 'messenger', 'none', ${CSAT_SUBJECT},
         ${'How did we do?'}, NOW(), NOW())`
    const visitorMsg = toUuid(generateId('conversation_msg'))
    await sql`
      INSERT INTO conversation_messages
        (id, conversation_id, principal_id, sender_type, content, is_internal, created_at)
      VALUES
        (${visitorMsg}, ${csatConversationId}, ${customerPrincipalId}, 'visitor', ${'Please rate this.'}, false,
         NOW() - interval '2 minutes')`
    const csatMsg = toUuid(generateId('conversation_msg'))
    const block = {
      v: 1,
      runId: 'e2e-run',
      nodeId: 'e2e-csat',
      waiting: true,
      kind: 'csat',
      allowTypingInterrupt: false,
      commentPrompt: 'Thanks! Anything we could improve?',
    }
    await sql`
      INSERT INTO conversation_messages
        (id, conversation_id, principal_id, sender_type, content, is_internal, metadata, created_at)
      VALUES
        (${csatMsg}, ${csatConversationId}, ${authorPrincipalId}, 'agent', ${'How did we do?'}, false,
         ${sql.json({ block })}, NOW() - interval '1 minute')`
  } else {
    csatConversationId = csat[0].id
  }

  let statuses = await sql<{ id: string }[]>`
    SELECT id FROM ticket_statuses WHERE deleted_at IS NULL
    ORDER BY is_default DESC, position ASC LIMIT 1`
  if (statuses.length === 0) {
    const statusId = toUuid(generateId('ticket_status'))
    await sql`
      INSERT INTO ticket_statuses (id, name, slug, color, category, position, is_default, public_stage)
      VALUES (${statusId}, ${'Open'}, ${'open'}, ${'#6b7280'}, ${'open'}, 0, true, ${'received'})`
    statuses = [{ id: statusId }]
  }
  const statusId = statuses[0].id

  let tickets = await sql<{ id: string }[]>`
    SELECT id FROM tickets
    WHERE requester_principal_id = ${customerPrincipalId} AND title = ${TICKET_TITLE} AND deleted_at IS NULL
    LIMIT 1`
  let ticketId: string
  if (tickets.length === 0) {
    ticketId = toUuid(generateId('ticket'))
    await sql`
      INSERT INTO tickets
        (id, type, title, status_id, priority, requester_principal_id, created_at, updated_at)
      VALUES
        (${ticketId}, ${'customer'}, ${TICKET_TITLE}, ${statusId}, ${'none'}, ${customerPrincipalId}, NOW(), NOW())`
  } else {
    ticketId = tickets[0].id
  }

  const linked = await sql<{ ticket_id: string }[]>`
    SELECT ticket_id FROM ticket_conversations WHERE ticket_id = ${ticketId} LIMIT 1`
  if (linked.length === 0) {
    const ticketConversationId = toUuid(generateId('conversation'))
    await sql`
      INSERT INTO conversations
        (id, visitor_principal_id, status, channel, priority, subject,
         last_message_preview, last_message_at, created_at)
      VALUES
        (${ticketConversationId}, ${customerPrincipalId}, 'open', 'messenger', 'none', ${TICKET_TITLE},
         ${TICKET_TITLE}, NOW(), NOW())`
    await sql`
      INSERT INTO ticket_conversations (ticket_id, conversation_id, ticket_type, created_at)
      VALUES (${ticketId}, ${ticketConversationId}, ${'customer'}, NOW())`
  }

  console.log(
    JSON.stringify({
      customerEmail: CUSTOMER_EMAIL,
      articleSlug: article[0].slug,
      articleTitle: ARTICLE_TITLE,
      ticketTitle: TICKET_TITLE,
      csatSubject: CSAT_SUBJECT,
    })
  )
  await sql.end()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  await sql.end()
  process.exit(1)
}
