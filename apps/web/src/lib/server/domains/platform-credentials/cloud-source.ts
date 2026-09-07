import {
  CLOUD_INTEGRATION_FIELDS,
  integrationEnvironmentKey,
} from '@/lib/shared/integration-credentials'
import type { CredentialSource } from './credential-source'
/** Reads process environment. Cloud sets INTEGRATION_* on the Railway service. */
export class CloudCredentialSource implements CredentialSource {
  constructor(private readonly environment: Record<string, string | undefined> = process.env) {}
  async get(type: string): Promise<Record<string, string> | null> {
    if (!Object.hasOwn(CLOUD_INTEGRATION_FIELDS, type)) return null
    const result: Record<string, string> = {}
    for (const field of CLOUD_INTEGRATION_FIELDS[type]) {
      const value = this.environment[integrationEnvironmentKey(type, field)]?.trim()
      if (!value) return null
      result[field] = value
    }
    return result
  }
  async has(type: string): Promise<boolean> {
    return (await this.get(type)) !== null
  }
  async listConfigured(): Promise<string[]> {
    const configured: string[] = []
    for (const type of Object.keys(CLOUD_INTEGRATION_FIELDS))
      if (await this.has(type)) configured.push(type)
    return configured
  }
}
