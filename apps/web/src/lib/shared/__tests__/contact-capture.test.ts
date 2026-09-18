import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONTACT_CAPTURE,
  parseContactCapture,
  resolveContactCapturePrompt,
  looksLikeContactEmail,
} from '../contact-capture'

describe('parseContactCapture', () => {
  it('defaults to off', () => {
    expect(parseContactCapture(undefined)).toEqual(DEFAULT_CONTACT_CAPTURE)
    expect(parseContactCapture({ mode: 'required', askName: true })).toEqual({
      mode: 'required',
      askName: true,
    })
  })
})

describe('looksLikeContactEmail', () => {
  it('accepts a plausible address and rejects junk', () => {
    expect(looksLikeContactEmail('Ada@Example.com')).toBe(true)
    expect(looksLikeContactEmail('not-an-email')).toBe(false)
    expect(looksLikeContactEmail('')).toBe(false)
  })
})

describe('resolveContactCapturePrompt', () => {
  const base = {
    settings: { mode: 'required' as const, askName: true },
    isAnonymous: true,
    visitorHasEmail: false,
    officeHoursOpen: true,
  }

  it('hides when off, identified, or email already on file', () => {
    expect(
      resolveContactCapturePrompt({ ...base, settings: { mode: 'off', askName: true } }).show
    ).toBe(false)
    expect(resolveContactCapturePrompt({ ...base, isAnonymous: false }).show).toBe(false)
    expect(resolveContactCapturePrompt({ ...base, visitorHasEmail: true }).show).toBe(false)
  })

  it('optional is skippable; required is not', () => {
    expect(
      resolveContactCapturePrompt({ ...base, settings: { mode: 'optional', askName: false } })
    ).toEqual({ show: true, required: false, askName: false })
    expect(resolveContactCapturePrompt(base)).toEqual({
      show: true,
      required: true,
      askName: true,
    })
  })

  it('outside office hours is required only when closed', () => {
    const settings = { mode: 'outside_office_hours' as const, askName: false }
    expect(resolveContactCapturePrompt({ ...base, settings, officeHoursOpen: true })).toEqual({
      show: false,
      required: false,
      askName: false,
    })
    expect(resolveContactCapturePrompt({ ...base, settings, officeHoursOpen: false })).toEqual({
      show: true,
      required: true,
      askName: false,
    })
  })
})
