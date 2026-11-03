/**
 * What a person reads when a sending-domain action fails.
 *
 * Every branch is a different sentence, so each case asserts the exact text:
 * a mapper that fell through to the fallback for everything would still return
 * a string, and only the exact text tells the branches apart.
 */
import { describe, expect, it } from 'vitest'
import { SesIdentityConfigError, SesIdentityError } from '@quackback/email/ses-identity'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { ChannelAddressInUseError, SendingDomainInUseError } from '../channel-account.service'
import { SendingDomainRefusedError } from '../sending-identity'
import { SendingIdentityRefusedError } from '../outbound-identity'
import { domainActionMessage } from '../domain-action-message'

const NOT_SET_UP =
  "Custom sending domains aren't set up correctly on this server. Nothing was added."
const UNREACHABLE = "Couldn't reach the mail provider. Try again in a minute."

describe('domainActionMessage', () => {
  it('passes our own refusals through, since they name the fix', () => {
    const refusal = new SendingDomainRefusedError('acme.com is not a valid domain name.')
    expect(domainActionMessage(refusal, 'address')).toBe('acme.com is not a valid domain name.')
    expect(domainActionMessage(new SendingDomainInUseError(), 'remove')).toBe(
      'Remove the sending addresses that use this domain first.'
    )
    const identity = new SendingIdentityRefusedError('help@acme.com')
    expect(domainActionMessage(identity, 'address')).toBe(identity.message)
    expect(domainActionMessage(new ChannelAddressInUseError('help@acme.com'), 'address')).toBe(
      "help@acme.com is already in use by this workspace's inbound route."
    )
  })

  it('passes a plan limit through', () => {
    const limit = new TierLimitError({
      limit: 'sending_domains',
      message: 'Your plan allows 3 sending domains.',
      current: 3,
      max: 3,
    })
    expect(domainActionMessage(limit, 'address')).toBe('Your plan allows 3 sending domains.')
  })

  it('says the server is not set up when the identity credential is missing', () => {
    const err = new SesIdentityConfigError('EMAIL_SES_IDENTITY_ACCESS_KEY_ID is required')
    expect(domainActionMessage(err, 'address')).toBe(NOT_SET_UP)
  })

  it('says the server is not set up when the provider denies the action', () => {
    const err = new SesIdentityError('SES refused', 400, 'AccessDeniedException', false)
    expect(domainActionMessage(err, 'address')).toBe(NOT_SET_UP)
  })

  it('names the check, not an add, when a check meets a broken setup', () => {
    const err = new SesIdentityError('SES refused', 400, 'AccessDeniedException', false)
    expect(domainActionMessage(err, 'verify')).toBe(
      "Custom sending domains aren't set up correctly on this server, so the records weren't checked."
    )
  })

  it('asks for a retry when the provider failure is transient', () => {
    const err = new SesIdentityError('SES throttled', 429, 'TooManyRequestsException', true)
    expect(domainActionMessage(err, 'address')).toBe(UNREACHABLE)
    expect(domainActionMessage(err, 'verify')).toBe(UNREACHABLE)
  })

  it('falls back per action for a permanent provider failure, without server-log wording', () => {
    const err = new SesIdentityError('SES bad request', 400, 'BadRequestException', false)
    expect(domainActionMessage(err, 'address')).toBe(
      "Couldn't add the address. Try again, and if it keeps failing, contact your workspace's operator."
    )
  })

  it('falls back per action for anything unrecognised', () => {
    const err = new Error('socket hang up at 10.0.0.1')
    expect(domainActionMessage(err, 'verify')).toBe(
      "Couldn't check the records. Try again, and if it keeps failing, contact your workspace's operator."
    )
    expect(domainActionMessage(err, 'remove')).toBe(
      "Couldn't remove the domain. Try again, and if it keeps failing, contact your workspace's operator."
    )
    expect(domainActionMessage(err, 'test')).toBe(
      "Couldn't send the test email. Try again, and if it keeps failing, contact your workspace's operator."
    )
    for (const action of ['address', 'verify', 'remove', 'test'] as const) {
      expect(domainActionMessage(err, action)).not.toMatch(/log/i)
      expect(domainActionMessage(err, action)).not.toContain('10.0.0.1')
    }
  })
})
