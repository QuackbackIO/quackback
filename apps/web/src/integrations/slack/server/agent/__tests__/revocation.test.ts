import { expect, it } from 'vitest'
import { revokesSlackInstallation } from '../revocation'
it('disconnects on uninstall or installed bot revocation only', () => {
  expect(revokesSlackInstallation({ type: 'app_uninstalled' }, 'Ubot')).toBe(true)
  expect(
    revokesSlackInstallation({ type: 'tokens_revoked', tokens: { bot: ['Ubot'] } }, 'Ubot')
  ).toBe(true)
  for (const bot of [undefined, [], ['Uother'], 'Ubot']) {
    expect(revokesSlackInstallation({ type: 'tokens_revoked', tokens: { bot } }, 'Ubot')).toBe(
      false
    )
  }
  expect(revokesSlackInstallation({ type: 'tokens_revoked' }, 'Ubot')).toBe(false)
  expect(
    revokesSlackInstallation({ type: 'tokens_revoked', tokens: { bot: ['Ubot'] } }, undefined)
  ).toBe(false)
})
