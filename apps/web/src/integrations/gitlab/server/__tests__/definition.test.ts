import { describe, it, expect } from 'vitest'
import { gitlabIntegration } from '@/integrations/gitlab/server'

describe('gitlabIntegration platform credentials', () => {
  it('declares an optional SSRF-checked instance URL plus Application ID and Secret', () => {
    const keys = gitlabIntegration.platformCredentials.map((f) => f.key)
    expect(keys).toEqual(['instanceUrl', 'clientId', 'clientSecret'])

    const instanceUrl = gitlabIntegration.platformCredentials.find((f) => f.key === 'instanceUrl')
    expect(instanceUrl).toMatchObject({
      required: false,
      url: true,
      sensitive: false,
    })
  })
})
