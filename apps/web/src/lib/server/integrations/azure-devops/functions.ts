/**
 * Azure DevOps server functions.
 * PAT-based connection (no OAuth redirect).
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { listProjects, listWorkItemTypes } from './api'
import type { AzureDevOpsProject, AzureDevOpsWorkItemType } from './api'

const connectSchema = z.object({
  organizationUrl: z.string().url('Must be a valid URL'),
  pat: z.string().min(1, 'Personal Access Token is required'),
})

/**
 * Parse organization name from the URL.
 * Supports: https://dev.azure.com/{org} or https://{org}.visualstudio.com
 */
function parseOrganizationName(organizationUrl: string): string {
  const url = new URL(organizationUrl)
  if (url.hostname === 'dev.azure.com') {
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments.length === 0) throw new Error('Organization name not found in URL')
    return segments[0]
  }
  if (url.hostname.endsWith('.visualstudio.com')) {
    return url.hostname.replace('.visualstudio.com', '')
  }
  throw new Error(
    'Invalid Azure DevOps URL. Use https://dev.azure.com/{org} or https://{org}.visualstudio.com'
  )
}

export const connectAzureDevOpsFn = createServerFn({ method: 'POST' })
  .inputValidator(connectSchema)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { saveIntegration } = await import('../save')

    const auth = await requireAuth({ roles: ['admin'] })
    const organizationName = parseOrganizationName(data.organizationUrl)

    // Validate by listing projects
    await listProjects(data.pat, organizationName)

    await saveIntegration('azure_devops', {
      principalId: auth.principal.id,
      accessToken: data.pat,
      config: {
        organizationUrl: data.organizationUrl,
        organizationName,
      },
    })

    return { success: true, organizationName }
  })

export const fetchAzureDevOpsProjectsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AzureDevOpsProject[]> => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { decryptSecrets } = await import('../encryption')

    await requireAuth({ roles: ['admin'] })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'azure_devops'),
    })

    if (!integration?.secrets || integration.status !== 'active') {
      throw new Error('Azure DevOps not connected')
    }

    const secrets = decryptSecrets<{ accessToken: string }>(integration.secrets as string)
    const config = integration.config as { organizationName?: string }
    if (!config?.organizationName) {
      throw new Error('Organization name not found in integration config')
    }

    return listProjects(secrets.accessToken, config.organizationName)
  }
)

const fetchWorkItemTypesSchema = z.object({
  project: z.string().min(1),
})

export const fetchAzureDevOpsWorkItemTypesFn = createServerFn({ method: 'POST' })
  .inputValidator(fetchWorkItemTypesSchema)
  .handler(async ({ data }): Promise<AzureDevOpsWorkItemType[]> => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { decryptSecrets } = await import('../encryption')

    await requireAuth({ roles: ['admin'] })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'azure_devops'),
    })

    if (!integration?.secrets || integration.status !== 'active') {
      throw new Error('Azure DevOps not connected')
    }

    const secrets = decryptSecrets<{ accessToken: string }>(integration.secrets as string)
    const config = integration.config as { organizationName?: string }
    if (!config?.organizationName) {
      throw new Error('Organization name not found in integration config')
    }

    return listWorkItemTypes(secrets.accessToken, config.organizationName, data.project)
  })
