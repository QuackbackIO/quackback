import { eq, and } from 'drizzle-orm'
import { db } from '../tenant-context'
import { integrations } from '../schema/integrations'
import type { NewIntegration, Integration, IntegrationType, IntegrationStatus } from '../types'

export async function createIntegration(data: NewIntegration): Promise<Integration> {
  const [integration] = await db.insert(integrations).values(data).returning()
  return integration
}

export async function getIntegrationById(id: string): Promise<Integration | undefined> {
  return db.query.integrations.findFirst({
    where: eq(integrations.id, id),
  })
}

export async function getIntegrationsByOrganization(
  organizationId: string
): Promise<Integration[]> {
  return db.query.integrations.findMany({
    where: eq(integrations.organizationId, organizationId),
    orderBy: (integrations, { asc }) => [asc(integrations.type)],
  })
}

export async function getIntegrationsByBoard(boardId: string): Promise<Integration[]> {
  return db.query.integrations.findMany({
    where: eq(integrations.boardId, boardId),
  })
}

export async function getIntegrationByType(
  organizationId: string,
  type: IntegrationType,
  boardId?: string
): Promise<Integration | undefined> {
  const conditions = [
    eq(integrations.organizationId, organizationId),
    eq(integrations.type, type),
  ]

  if (boardId) {
    conditions.push(eq(integrations.boardId, boardId))
  }

  return db.query.integrations.findFirst({
    where: and(...conditions),
  })
}

export async function getActiveIntegrations(
  organizationId: string,
  type?: IntegrationType
): Promise<Integration[]> {
  const conditions = [
    eq(integrations.organizationId, organizationId),
    eq(integrations.status, 'active'),
  ]

  if (type) {
    conditions.push(eq(integrations.type, type))
  }

  return db.query.integrations.findMany({
    where: and(...conditions),
  })
}

export async function updateIntegration(
  id: string,
  data: Partial<NewIntegration>
): Promise<Integration | undefined> {
  const [updated] = await db
    .update(integrations)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(integrations.id, id))
    .returning()
  return updated
}

export async function updateIntegrationStatus(
  id: string,
  status: IntegrationStatus
): Promise<Integration | undefined> {
  return updateIntegration(id, { status })
}

export async function updateIntegrationSyncTime(id: string): Promise<Integration | undefined> {
  const [updated] = await db
    .update(integrations)
    .set({ lastSyncAt: new Date(), updatedAt: new Date() })
    .where(eq(integrations.id, id))
    .returning()
  return updated
}

export async function deleteIntegration(id: string): Promise<void> {
  await db.delete(integrations).where(eq(integrations.id, id))
}
