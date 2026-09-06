import { getWorkspaceControlPlane } from '@/lib/server/control-plane/client'
import { CLOUD_INTEGRATION_FIELDS } from '@/lib/shared/integration-credentials'
import type { CredentialSource } from './credential-source'
export class ControlPlaneCredentialSource implements CredentialSource {
  constructor(private readonly request = getWorkspaceControlPlane) {}
  async get(type: string): Promise<Record<string, string> | null> {
    if (!Object.hasOwn(CLOUD_INTEGRATION_FIELDS, type)) return null
    const { credentials } = await this.request<{ credentials: Record<string, string> | null }>(
      `/api/v1/internal/integration-credentials?provider=${encodeURIComponent(type)}`
    )
    if (credentials === null) return null
    const fields = CLOUD_INTEGRATION_FIELDS[type]
    if (
      !credentials ||
      fields.some((key) => typeof credentials[key] !== 'string' || !credentials[key].trim())
    )
      throw new Error('Invalid Cloud integration credentials')
    return Object.fromEntries(fields.map((key) => [key, credentials[key]]))
  }
  async has(type: string): Promise<boolean> {
    return (await this.listConfigured()).includes(type)
  }
  async listConfigured(): Promise<string[]> {
    const { providers } = await this.request<{ providers: string[] }>(
      '/api/v1/internal/integration-credentials'
    )
    if (!Array.isArray(providers)) throw new Error('Invalid Cloud integration credential catalogue')
    return providers.filter((type) => Object.hasOwn(CLOUD_INTEGRATION_FIELDS, type))
  }
}
