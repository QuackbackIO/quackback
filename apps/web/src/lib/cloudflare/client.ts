import type {
  CFCreateHostnameResponse,
  CFGetHostnameResponse,
  CFDeleteHostnameResponse,
} from './types'

export class CloudflareClient {
  private apiToken: string
  private zoneId: string
  private baseUrl = 'https://api.cloudflare.com/client/v4'

  constructor(config: { apiToken: string; zoneId: string }) {
    if (!config.apiToken) throw new Error('CLOUD_CLOUDFLARE_API_TOKEN is required')
    if (!config.zoneId) throw new Error('CLOUD_CLOUDFLARE_ZONE_ID is required')
    this.apiToken = config.apiToken
    this.zoneId = config.zoneId
  }

  private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    const data = (await response.json()) as T
    return data
  }

  async createHostname(
    hostname: string,
    options?: { metadata?: Record<string, string> }
  ): Promise<CFCreateHostnameResponse> {
    return this.fetch(`/zones/${this.zoneId}/custom_hostnames`, {
      method: 'POST',
      body: JSON.stringify({
        hostname,
        ssl: {
          method: 'http',
          type: 'dv',
          bundle_method: 'ubiquitous',
        },
        custom_metadata: options?.metadata,
      }),
    })
  }

  async getHostname(hostnameId: string): Promise<CFGetHostnameResponse> {
    return this.fetch(`/zones/${this.zoneId}/custom_hostnames/${hostnameId}`)
  }

  async deleteHostname(hostnameId: string): Promise<CFDeleteHostnameResponse> {
    return this.fetch(`/zones/${this.zoneId}/custom_hostnames/${hostnameId}`, {
      method: 'DELETE',
    })
  }

  async refreshHostname(hostnameId: string): Promise<CFGetHostnameResponse> {
    // PATCH triggers re-validation
    return this.fetch(`/zones/${this.zoneId}/custom_hostnames/${hostnameId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ssl: {
          method: 'http',
          type: 'dv',
        },
      }),
    })
  }
}

let clientInstance: CloudflareClient | null = null

export function getCloudflareClient(): CloudflareClient {
  if (!clientInstance) {
    clientInstance = new CloudflareClient({
      apiToken: process.env.CLOUD_CLOUDFLARE_API_TOKEN!,
      zoneId: process.env.CLOUD_CLOUDFLARE_ZONE_ID!,
    })
  }
  return clientInstance
}

export function resetCloudflareClient(): void {
  clientInstance = null
}
