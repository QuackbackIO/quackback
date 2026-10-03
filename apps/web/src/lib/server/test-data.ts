import {
  db,
  principal,
  conversations,
  posts,
  eq,
  type Database,
  type Transaction,
} from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { isTeamMember } from '@/lib/shared/roles'
import { WorkspaceKeyedCache } from '@/lib/server/workspaces/workspace-keyed'
// From the package itself, so suites that stub `@/lib/server/db` keep the real predicates.
export {
  isTestPrincipalSql,
  notTestPrincipal,
  notTestConversation,
  notTestTicket,
} from '@quackback/db'

/*
 * A principal's test owner is written once, when the server creates the test
 * customer, and never changes, so each answer can be kept for the life of the
 * process: a principal that exists is either a test customer for good or never
 * one. Partitioned by workspace, so a pooled process never answers one
 * workspace's principal from another's. A missing principal is not remembered, because it may not be inserted yet.
 */
const testOwners = new WorkspaceKeyedCache<PrincipalId | null>(10_000)

function remember(id: string, owner: PrincipalId | null): void {
  testOwners.set(id, owner)
}

/** Record a principal row the caller already loaded, so later checks skip the read. */
export function rememberTestOwner(row: { id: string; testOwnerPrincipalId?: string | null }): void {
  if (row.testOwnerPrincipalId === undefined) return
  remember(row.id, (row.testOwnerPrincipalId ?? null) as PrincipalId | null)
}

/** What the process already knows about a principal: its owner, null, or undefined when unknown. */
export function knownTestOwner(principalId: string): PrincipalId | null | undefined {
  return testOwners.get(principalId)
}

/** The teammate who owns this test customer, or null for every other principal. */
export async function testOwnerOf(
  principalId: string | null | undefined,
  executor: Database | Transaction = db
): Promise<PrincipalId | null> {
  if (!principalId) return null
  const known = testOwners.get(principalId)
  if (known !== undefined) return known
  const row = await executor.query.principal.findFirst({
    where: eq(principal.id, principalId as PrincipalId),
    columns: { testOwnerPrincipalId: true },
  })
  if (!row) return null
  const owner = (row.testOwnerPrincipalId ?? null) as PrincipalId | null
  remember(principalId, owner)
  return owner
}

export async function isTestCustomer(
  principalId: string | null | undefined,
  executor: Database | Transaction = db
): Promise<boolean> {
  return (await testOwnerOf(principalId, executor)) !== null
}

/**
 * The owner of this test customer while they are still a teammate. A test
 * customer whose owner left the team is inert: nothing routes to it or opens
 * for it. Every other principal answers null without a read once it is known.
 */
export async function activeTestOwnerOf(
  principalId: string | null | undefined,
  executor: Database | Transaction = db
): Promise<PrincipalId | null> {
  const owner = await testOwnerOf(principalId, executor)
  if (!owner) return null
  const row = await executor.query.principal.findFirst({
    where: eq(principal.id, owner),
    columns: { userId: true, type: true, role: true },
  })
  return row?.userId && row.type === 'user' && isTeamMember(row.role) ? owner : null
}

/** A conversation is test when its visitor is a test customer. */
export async function isTestConversation(
  conversationId: string,
  executor: Database | Transaction = db
): Promise<boolean> {
  const row = await executor.query.conversations.findFirst({
    where: eq(conversations.id, conversationId as never),
    columns: { visitorPrincipalId: true },
  })
  return !!row && (await isTestCustomer(row.visitorPrincipalId, executor))
}

/** A post is test when a test customer authored it. */
export async function isTestPost(
  postId: string,
  executor: Database | Transaction = db
): Promise<boolean> {
  const row = await executor.query.posts.findFirst({
    where: eq(posts.id, postId as never),
    columns: { principalId: true },
  })
  return !!row && (await isTestCustomer(row.principalId, executor))
}
