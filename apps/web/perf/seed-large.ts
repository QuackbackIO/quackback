/**
 * The large workspace profile (`PERF_SCALE=large`): support data at the size a
 * busy install reaches, written with `INSERT ... SELECT generate_series` so it
 * takes minutes rather than hours.
 *
 * It adds to the demo workspace the bench seed builds, so the demo admin can sign
 * in and see it. `setseed` pins `random()`, so every run gives the same counts
 * per status, channel, team and priority. Ids are random, so plans compare by
 * shape and row counts, not by id.
 *
 * Run it on demand and paste the plans it lets you read into the PR: a PR that
 * changes a hot read (the inbox list and counts for a team-scoped teammate,
 * ticket reports, company visibility, the SLA and first-response sweeps) runs
 * `EXPLAIN (ANALYZE, BUFFERS)` on it by hand. Nothing in CI depends on it.
 */
import type postgres from 'postgres'
import type { PerfProfile } from './config'

/** Run one statement and report how long it took. */
async function step(
  sql: postgres.Sql,
  label: string,
  statement: string,
  log: (line: string) => void
): Promise<void> {
  const started = performance.now()
  const result = await sql.unsafe(statement)
  const ms = Math.round(performance.now() - started)
  log(`   ${label}: ${result.count ?? 0} rows in ${ms} ms`)
}

/**
 * Fill the large profile into the database `sql` points at. The demo seed must
 * have run first: tickets take their statuses from it.
 */
export async function seedLargeWorkspace(
  sql: postgres.Sql,
  profile: PerfProfile,
  log: (line: string) => void = (line) => process.stdout.write(`${line}\n`)
): Promise<void> {
  const p = profile
  await sql.unsafe('SELECT setseed(0.5)')

  await step(
    sql,
    'teams',
    `INSERT INTO teams (id, name, created_at, updated_at)
     SELECT gen_random_uuid(), 'Perf team ' || g, now(), now()
     FROM generate_series(1, ${p.teams}) g`,
    log
  )

  await step(
    sql,
    'teammate users',
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     SELECT gen_random_uuid(), 'Perf Agent ' || g, 'perf-agent-' || g || '@example.com', true, now(), now()
     FROM generate_series(1, ${p.teammates}) g`,
    log
  )
  await step(
    sql,
    'teammates',
    `INSERT INTO principal (id, user_id, role, type, display_name, created_at)
     SELECT gen_random_uuid(), u.id, 'member', 'user', u.name, now()
     FROM "user" u WHERE u.email LIKE 'perf-agent-%@example.com'`,
    log
  )
  await step(
    sql,
    'team members',
    `INSERT INTO team_members (id, team_id, principal_id, created_at)
     SELECT gen_random_uuid(), t.id, a.id, now()
     FROM (SELECT p.id, row_number() OVER (ORDER BY u.email) AS n
           FROM principal p JOIN "user" u ON u.id = p.user_id
           WHERE u.email LIKE 'perf-agent-%@example.com') a
     JOIN (SELECT id, row_number() OVER (ORDER BY name) AS n
           FROM teams WHERE name LIKE 'Perf team %') t
       ON t.n = 1 + (a.n % ${p.teams})`,
    log
  )

  await step(
    sql,
    'companies',
    `INSERT INTO companies (id, name, domain, plan, mrr_cents, source, created_at, updated_at)
     SELECT gen_random_uuid(), 'Perf Company ' || g, 'perf' || g || '.example.com',
            (ARRAY['free', 'pro', 'enterprise'])[1 + floor(random() * 3)::int],
            floor(random() * 500000)::int, 'api', now(), now()
     FROM generate_series(1, ${p.companies}) g`,
    log
  )

  await step(
    sql,
    'customer users',
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     SELECT gen_random_uuid(), 'Perf Customer ' || g, 'perf-customer-' || g || '@example.com', true,
            now() - make_interval(days => floor(random() * 365)::int), now()
     FROM generate_series(1, ${p.customers}) g`,
    log
  )
  await step(
    sql,
    'customers',
    `INSERT INTO principal (id, user_id, role, type, display_name, company_id, created_at)
     SELECT gen_random_uuid(), u.id, 'user', 'user', u.name,
            CASE WHEN random() < 0.7 THEN c.id END, u.created_at
     FROM (SELECT id, name, created_at, row_number() OVER (ORDER BY email) AS n
           FROM "user" WHERE email LIKE 'perf-customer-%@example.com') u
     LEFT JOIN (SELECT id, row_number() OVER (ORDER BY name) AS n
                FROM companies WHERE name LIKE 'Perf Company %') c
       ON c.n = 1 + (u.n % ${p.companies})`,
    log
  )

  // Conversations: a customer each, about two thirds assigned to a teammate
  // and most to a team, spread over a year.
  await step(
    sql,
    'conversations',
    `WITH customers AS (
       SELECT p.id, row_number() OVER (ORDER BY p.id) AS n
       FROM principal p JOIN "user" u ON u.id = p.user_id
       WHERE u.email LIKE 'perf-customer-%@example.com'
     ), agents AS (
       SELECT p.id, tm.team_id, row_number() OVER (ORDER BY p.id) AS n
       FROM principal p JOIN "user" u ON u.id = p.user_id
       JOIN team_members tm ON tm.principal_id = p.id
       WHERE u.email LIKE 'perf-agent-%@example.com'
     ), rows AS (
       SELECT g, random() AS r_status, random() AS r_assign, random() AS r_channel,
              random() AS r_priority, now() - make_interval(secs => floor(random() * 365 * 86400)::int) AS at
       FROM generate_series(1, ${p.conversations}) g
     )
     INSERT INTO conversations (id, visitor_principal_id, assigned_agent_principal_id, assigned_team_id,
                                status, channel, priority, source, subject, created_at, last_message_at)
     SELECT gen_random_uuid(), c.id,
            CASE WHEN r.r_assign < 0.65 THEN a.id END,
            CASE WHEN r.r_assign < 0.85 THEN a.team_id END,
            CASE WHEN r.r_status < 0.25 THEN 'open' WHEN r.r_status < 0.30 THEN 'snoozed' ELSE 'closed' END,
            CASE WHEN r.r_channel < 0.8 THEN 'messenger' ELSE 'email' END,
            CASE WHEN r.r_priority < 0.7 THEN 'none' WHEN r.r_priority < 0.85 THEN 'low'
                 WHEN r.r_priority < 0.95 THEN 'medium' WHEN r.r_priority < 0.99 THEN 'high' ELSE 'urgent' END,
            CASE WHEN r.r_channel < 0.8 THEN 'widget' ELSE 'email' END,
            'Perf conversation ' || r.g, r.at, r.at + interval '2 hours'
     FROM rows r
     JOIN customers c ON c.n = 1 + (r.g % ${p.customers})
     JOIN agents a ON a.n = 1 + (r.g % ${p.teammates})`,
    log
  )
  await step(
    sql,
    'snooze times',
    `UPDATE conversations SET snoozed_until = now() + make_interval(hours => 1 + floor(random() * 72)::int)
     WHERE status = 'snoozed' AND subject LIKE 'Perf conversation %'`,
    log
  )

  // Messages: between the low and high bound per conversation (derived from
  // its number, so the total is the same on every run), alternating customer
  // and teammate, with a few internal notes.
  await step(
    sql,
    'messages',
    `INSERT INTO conversation_messages (id, conversation_id, principal_id, sender_type, content, is_internal, created_at)
     SELECT gen_random_uuid(), c.id,
            CASE WHEN m % 2 = 1 THEN c.visitor_principal_id ELSE c.assigned_agent_principal_id END,
            CASE WHEN m % 2 = 1 THEN 'visitor' ELSE 'agent' END,
            'Perf message ' || m || ' in a conversation about billing, sign-in and exports.',
            (m % 2 = 0 AND m % 7 = 0),
            c.created_at + make_interval(mins => m * 7)
     FROM conversations c
     CROSS JOIN LATERAL generate_series(
       1, ${p.messagesPerConversation.min} + ((split_part(c.subject, ' ', 3)::int * 7919) % ${
         p.messagesPerConversation.max - p.messagesPerConversation.min + 1
       })
     ) m
     WHERE c.subject LIKE 'Perf conversation %'`,
    log
  )

  // Tickets: customer tickets riding on a conversation, owned like it.
  await step(
    sql,
    'tickets',
    `WITH statuses AS (
       SELECT id, row_number() OVER (ORDER BY position, id) AS n, count(*) OVER () AS total
       FROM ticket_statuses WHERE deleted_at IS NULL
     ), picked AS (
       SELECT c.*, row_number() OVER (ORDER BY c.id) AS n
       FROM conversations c WHERE c.subject LIKE 'Perf conversation %'
       ORDER BY c.id LIMIT ${p.tickets}
     )
     INSERT INTO tickets (id, type, title, status_id, priority, requester_principal_id,
                          assignee_principal_id, assignee_team_id, company_id, created_at, updated_at)
     SELECT gen_random_uuid(), 'customer', 'Perf ticket ' || p.n, s.id, p.priority,
            p.visitor_principal_id, p.assigned_agent_principal_id, p.assigned_team_id, v.company_id,
            p.created_at, p.last_message_at
     FROM picked p
     JOIN principal v ON v.id = p.visitor_principal_id
     JOIN statuses s ON s.n = 1 + (p.n % s.total)`,
    log
  )
  await step(
    sql,
    'ticket links',
    `INSERT INTO ticket_conversations (ticket_id, conversation_id, ticket_type, created_at)
     SELECT t.id, c.id, 'customer', t.created_at
     FROM (SELECT id, created_at, row_number() OVER (ORDER BY id) AS n
           FROM tickets WHERE title LIKE 'Perf ticket %') t
     JOIN (SELECT id, row_number() OVER (ORDER BY id) AS n
           FROM conversations WHERE subject LIKE 'Perf conversation %'
           ORDER BY id LIMIT ${p.tickets}) c ON c.n = t.n`,
    log
  )

  // Workflows, kept as drafts so a bench server does not run them.
  await step(
    sql,
    'workflows',
    `INSERT INTO workflows (id, name, class, status, sort_order, trigger_type, created_at, updated_at)
     SELECT gen_random_uuid(), 'Perf workflow ' || g,
            CASE WHEN g % 2 = 0 THEN 'customer_facing' ELSE 'background' END,
            'draft', g,
            (ARRAY['conversation.created', 'conversation.assigned', 'message.created'])[1 + g % 3],
            now(), now()
     FROM generate_series(1, ${p.workflows}) g`,
    log
  )

  await step(sql, 'analyze', 'ANALYZE', log)
}
