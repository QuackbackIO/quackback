import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
// oxlint-disable-next-line no-restricted-imports -- this isolated fixture owns and closes its connection
import { createDbFromSql, type Database } from '@quackback/db/client'
import {
  createWorkspaceScope,
  runWithWorkspaceScope,
} from '@/lib/server/workspaces/workspace-context'
import {
  makeWorkspaceDescriptor,
  makeWorkspaceSecrets,
} from '@/lib/server/__tests__/workspace-scope'

/** Real migrated tables and foreign keys, isolated from every other suite's rows. */
export async function createAskMcpFixture() {
  const url =
    process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test'
  if (!new URL(url).pathname.startsWith('/quackback_test'))
    throw new Error('Ask evaluations require a quackback_test database')
  const schema = `ask_golden_${randomUUID().replaceAll('-', '')}`
  const raw = postgres(url, { max: 1, prepare: false })
  const [version] = await raw`select workspace_thread_key from conversation_messages limit 0`
  void version
  const tables = await raw<
    { tablename: string }[]
  >`select tablename from pg_tables where schemaname = 'public' order by tablename`
  const keys = await raw<{ tablename: string; name: string; definition: string }[]>`
    select c.relname as tablename, k.conname as name, pg_get_constraintdef(k.oid) as definition
    from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
    where k.contype = 'f' and n.nspname = 'public' order by c.relname, k.conname`
  await raw.unsafe(`create schema "${schema}"`)
  try {
    for (const { tablename } of tables) {
      if (!/^[a-z_][a-z0-9_]*$/.test(tablename)) throw new Error('Unexpected table identifier')
      await raw.unsafe(
        `create table "${schema}"."${tablename}" (like public."${tablename}" including all)`
      )
    }
    await raw.unsafe(`set search_path to "${schema}", public`)
    for (const key of keys) {
      const definition = key.definition.replaceAll('public.', `"${schema}".`)
      await raw.unsafe(
        `alter table "${schema}"."${key.tablename}" add constraint "${key.name}" ${definition}`
      )
    }
  } catch (error) {
    await raw.unsafe(`drop schema "${schema}" cascade`)
    await raw.end()
    throw error
  }
  const connection = createDbFromSql(raw)
  const rollback = new Error('ask-fixture rollback')
  let result: unknown
  return {
    /** Every request runs in its own real transaction and workspace context. */
    async run<T>(callback: (db: Database) => Promise<T>): Promise<T> {
      try {
        await connection.transaction(async (transaction) => {
          const workspaceKey = schema.replaceAll('_', '-')
          const scope = createWorkspaceScope({
            workspace: makeWorkspaceDescriptor(workspaceKey),
            secrets: makeWorkspaceSecrets(workspaceKey),
            db: transaction as unknown as Database,
            sql: raw,
            origin: 'test',
          })
          result = await runWithWorkspaceScope(scope, () =>
            callback(transaction as unknown as Database)
          )
          throw rollback
        })
      } catch (error) {
        if (error !== rollback) throw error
      }
      return result as T
    },
    async close() {
      await raw.unsafe(`drop schema "${schema}" cascade`)
      await raw.end()
    },
  }
}
