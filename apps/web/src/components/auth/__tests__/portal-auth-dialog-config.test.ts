/**
 * What the portal's sign-in dialog is told about the workspace.
 *
 * A visitor a closed portal will refuse must not be walked into a code-entry
 * screen to wait for mail that is never sent. The server answers every sign-in
 * request identically on purpose — a 4xx for the refused case would be a free
 * account-existence oracle — so the browser cannot learn the outcome from the
 * response, and the only thing that can prevent the dead end is the workspace
 * setting, known before anybody types an address.
 *
 * The setting was resolved on the server and then dropped on the floor: both
 * places the portal builds this projection omitted it, so the form's
 * closed-signup branch could not fire and the code step had nothing to say.
 *
 * ## The oracle this must not become
 *
 * `openSignup` is a fact about the WORKSPACE. Every assertion here is about a
 * value that does not depend on the address, and the form's use of it must stay
 * that way: a screen that appeared only for addresses the workspace refuses
 * would be the same oracle the uniform 200 exists to remove, moved into the
 * browser. `portal-auth-form-inline.test.tsx` holds that line at the render.
 */
import { describe, it, expect } from 'vitest'
import { buildPortalAuthDialogConfig } from '../portal-auth-dialog-config'

const REGISTERED = ['google']

describe('buildPortalAuthDialogConfig', () => {
  it('carries the portal signup answer through', () => {
    const config = buildPortalAuthDialogConfig({
      found: true,
      publicAuthConfig: { oauth: { magicLink: true } },
      publicPortalConfig: { openSignup: false },
      registeredAuthProviders: REGISTERED,
    })

    expect(config.openSignup).toBe(false)
  })

  // The control: the field tracks the workspace rather than being a constant.
  it('carries an open portal through as open', () => {
    const config = buildPortalAuthDialogConfig({
      found: true,
      publicAuthConfig: { oauth: { magicLink: true } },
      publicPortalConfig: { openSignup: true },
      registeredAuthProviders: REGISTERED,
    })

    expect(config.openSignup).toBe(true)
  })

  // The gate overlay renders before a settings row exists. Nothing is known
  // then, and `undefined` is what the form treats as "no answer given" — it
  // must not be flattened to `false`, which would tell a visitor the portal is
  // closed on an install that has not been set up.
  it('reports no answer when there is no portal config yet', () => {
    const config = buildPortalAuthDialogConfig({
      found: false,
      publicAuthConfig: null,
      publicPortalConfig: null,
      registeredAuthProviders: REGISTERED,
    })

    expect(config.openSignup).toBeUndefined()
    expect(config.found).toBe(false)
  })

  // The rest of the projection, so that "one builder for both call sites" is
  // load-bearing rather than a place a second field can go missing quietly.
  it('projects the provider fields both call sites need', () => {
    const config = buildPortalAuthDialogConfig({
      found: true,
      publicAuthConfig: { oauth: { password: false }, twoFactor: { required: true } },
      publicPortalConfig: { oidcProviders: [{ id: 'okta', name: 'Okta' }], openSignup: true },
      registeredAuthProviders: REGISTERED,
    })

    expect(config.oauth).toEqual({ password: false })
    expect(config.oidcProviders).toEqual([{ id: 'okta', name: 'Okta' }])
    expect(config.registeredAuthProviders).toEqual(REGISTERED)
    expect(config.twoFactorRequired).toBe(true)
  })
})
