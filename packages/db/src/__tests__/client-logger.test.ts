/**
 * Both database factories hand their logger to Drizzle, which is what lets
 * the app count the statements each request sends.
 */
import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import { createDb, createDbFromSql } from '../client'

// Never connects: the logger fires before the statement is sent, and the
// refused connection is irrelevant to what the test observes.
const NOWHERE = 'postgres://nobody@127.0.0.1:1/none'

describe('database factories', () => {
  it('pass the logger through to every statement', async () => {
    const seen: string[] = []
    const logger = { logQuery: (query: string) => void seen.push(query) }
    const client = postgres(NOWHERE, { connect_timeout: 1 })
    const fromUrl = createDb(NOWHERE, { logger })
    const fromSql = createDbFromSql(client, { logger })

    await fromUrl.execute(sql`select 1`).catch(() => {})
    await fromSql.execute(sql`select 2`).catch(() => {})

    const urlClient = (fromUrl as unknown as { $client: postgres.Sql }).$client
    await Promise.all([client.end({ timeout: 0 }), urlClient.end({ timeout: 0 })])
    expect(seen).toEqual(['select 1', 'select 2'])
  })
})
