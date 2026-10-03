import { beforeEach, expect, it, vi } from 'vitest'

const seams = vi.hoisted(() => ({ disabled: undefined as boolean | undefined, usable: true }))
vi.mock('@/lib/server/config', () => ({
  config: {
    get disableAutomaticBranding() {
      return seams.disabled
    },
  },
}))
vi.mock('@/lib/server/storage/s3', () => ({ isS3Usable: () => seams.usable }))

import { automaticBrandingAvailable } from '../automatic-website-branding.availability'

beforeEach(() => {
  seams.disabled = undefined
  seams.usable = true
})

it('runs by default when storage can hold the logo', () => {
  expect(automaticBrandingAvailable()).toBe(true)
  seams.disabled = false
  expect(automaticBrandingAvailable()).toBe(true)
})

it('stops when the operator switches the lookup off', () => {
  seams.disabled = true
  expect(automaticBrandingAvailable()).toBe(false)
})

it('stops when workspace storage is unusable', () => {
  seams.usable = false
  expect(automaticBrandingAvailable()).toBe(false)
})
