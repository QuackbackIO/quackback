import { beforeEach, describe, it, expect, vi } from 'vitest'
import { generateId } from '@quackback/ids'
import { ValidationError } from '@/lib/shared/errors'
import { DEFAULT_SLA_POLICY_SETTINGS } from '@/lib/shared/sla/default-policy'
import { resolveDefaultSlaPolicy, updateDefaultSlaPolicySettings } from '../settings.sla-default'

const { getSlaPolicy, writeMetadataKey } = vi.hoisted(() => ({
  getSlaPolicy: vi.fn(),
  writeMetadataKey: vi.fn(),
}))

vi.mock('@/lib/server/domains/sla/sla-policy.service', () => ({ getSlaPolicy }))
vi.mock('../settings.helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../settings.helpers')>()
  return { ...actual, writeMetadataKey }
})

describe('resolveDefaultSlaPolicy', () => {
  it('defaults to no policy', () => {
    expect(resolveDefaultSlaPolicy(null)).toEqual(DEFAULT_SLA_POLICY_SETTINGS)
    expect(resolveDefaultSlaPolicy('{}')).toEqual(DEFAULT_SLA_POLICY_SETTINGS)
  })

  it('returns the stored metadata setting', () => {
    const meta = JSON.stringify({ defaultSlaPolicy: { policyId: 'sla_policy_1' } })
    expect(resolveDefaultSlaPolicy(meta)).toEqual({ policyId: 'sla_policy_1' })
  })

  it('preserves sibling metadata keys', () => {
    const meta = JSON.stringify({
      officeHours: { enabled: true },
      defaultSlaPolicy: { policyId: 'sla_policy_1' },
    })
    expect(resolveDefaultSlaPolicy(meta).policyId).toBe('sla_policy_1')
  })

  it('falls back to defaults on unparseable metadata', () => {
    expect(resolveDefaultSlaPolicy('not json')).toEqual(DEFAULT_SLA_POLICY_SETTINGS)
  })

  it('ignores an invalid stored shape', () => {
    const meta = JSON.stringify({ defaultSlaPolicy: { policyId: '' } })
    expect(resolveDefaultSlaPolicy(meta)).toEqual(DEFAULT_SLA_POLICY_SETTINGS)
  })
})

describe('updateDefaultSlaPolicySettings', () => {
  beforeEach(() => {
    getSlaPolicy.mockReset()
    writeMetadataKey.mockReset()
    writeMetadataKey.mockResolvedValue(undefined)
  })

  it('writes null without looking up a policy', async () => {
    await expect(updateDefaultSlaPolicySettings({ policyId: null })).resolves.toEqual({
      policyId: null,
    })
    expect(getSlaPolicy).not.toHaveBeenCalled()
    expect(writeMetadataKey).toHaveBeenCalledWith('defaultSlaPolicy', { policyId: null })
  })

  it('writes a live policy id', async () => {
    const policyId = generateId('sla_policy')
    getSlaPolicy.mockResolvedValueOnce({ id: policyId, name: 'Standard' })
    await expect(updateDefaultSlaPolicySettings({ policyId })).resolves.toEqual({ policyId })
    expect(getSlaPolicy).toHaveBeenCalledWith(policyId)
    expect(writeMetadataKey).toHaveBeenCalledWith('defaultSlaPolicy', { policyId })
  })

  it('rejects a missing or archived policy id', async () => {
    const policyId = generateId('sla_policy')
    getSlaPolicy.mockResolvedValueOnce(null)
    await expect(updateDefaultSlaPolicySettings({ policyId })).rejects.toBeInstanceOf(
      ValidationError
    )
    expect(writeMetadataKey).not.toHaveBeenCalled()
  })

  it('rejects an unknown policy id that is not a live TypeID', async () => {
    await expect(
      updateDefaultSlaPolicySettings({ policyId: 'not-a-policy' })
    ).rejects.toBeInstanceOf(ValidationError)
    expect(getSlaPolicy).not.toHaveBeenCalled()
    expect(writeMetadataKey).not.toHaveBeenCalled()
  })
})
