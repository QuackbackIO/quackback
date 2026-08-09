/**
 * P03 — alpha's storage read token against a bravo object key.
 *
 * `verifyStorageReadToken(secret, key, sig)` (`lib/server/storage/s3.ts:206`)
 * HMACs the capability with the tenant's S3 secret access key. Whether it fails
 * closed across tenants is therefore entirely a question of whether the two
 * tenants hold different secrets — which is exactly the argument
 * SAAS-HOSTING-STACK.md §9 uses to reject a single shared bucket with tenant
 * path prefixes.
 *
 * The probe deliberately uses the SAME key string against both tenants. A
 * signature is bound to its key, so signing tenant A's key and presenting it for
 * tenant B's key would be refused by arithmetic rather than by isolation, and
 * would prove nothing. Holding the key constant isolates the only variable that
 * matters: the secret.
 *
 * The object does not need to exist. `handleStorageGet` verifies the capability
 * BEFORE it touches S3, so a rejected signature is a clean 403 while an accepted
 * one falls through to the object path (302 redirect, 200, or a 5xx from
 * storage). That difference is the whole measurement, and it needs no upload.
 */

import { mintStorageReadSig } from '../crypto'
import { blocked, control, decide, describeResponse, error } from './helpers'
import type { ControlOutcome, Probe, ProbeContext, ProbeResponse } from '../types'

/**
 * A key under a prefix that is NOT in `PUBLIC_STORAGE_PREFIXES`, so the read
 * token is actually required. A public prefix would bypass verification and the
 * probe would measure nothing.
 */
const PRIVATE_KEY = 'uploads/tenancy-probe/isolation-probe-object.bin'

const REJECTED = 403

function accepted(res: ProbeResponse): boolean {
  return res.status !== REJECTED
}

export const p03StorageToken: Probe = {
  id: 'P03',
  name: 'storage-read-token-cross-tenant',
  family: 'storage',
  proves:
    'A private-object read capability minted with one tenant’s storage secret is refused by the ' +
    'other tenant for the identical object key — i.e. the two tenants do not share a storage secret, ' +
    'which is the property that makes bucket-per-tenant an isolation boundary rather than a convention.',
  requires: ['http', 'storage-secret'],

  async run(ctx: ProbeContext) {
    const { alpha, bravo, config } = ctx
    const attempted =
      `mint a storage read capability for the private key "${PRIVATE_KEY}" using alpha's S3 secret, ` +
      `then present it to bravo for the identical key (and the reverse)`

    const alphaSecret = config.alphaStorageSecret
    const bravoSecret = config.bravoStorageSecret
    if (!alphaSecret || !bravoSecret) {
      return blocked({
        attempted,
        reason:
          'both tenants’ S3/R2 secret access keys are required to mint read capabilities. ' +
          'Pass --alpha-storage-secret and --bravo-storage-secret (or ALPHA_S3_SECRET_ACCESS_KEY / ' +
          'BRAVO_S3_SECRET_ACCESS_KEY).',
      })
    }

    const controls: ControlOutcome[] = []
    const path = (sig: string) => `/api/storage/${PRIVATE_KEY}?read=${sig}`

    // --- invariant: the secrets must differ ---------------------------------
    const secretsDiffer = alphaSecret !== bravoSecret
    controls.push(
      control(
        'invariant',
        'alpha and bravo hold different storage secrets',
        secretsDiffer,
        secretsDiffer
          ? 'distinct'
          : 'IDENTICAL — every read capability minted for either tenant verifies against both, by construction'
      )
    )

    // --- discriminator control: a bogus signature must be rejected -----------
    // Without this, a deployment with storage unconfigured (503 for everything)
    // would look like "alpha accepted, bravo refused" and pass.
    const bogus = await alpha.http.request(
      path(mintStorageReadSig('not-the-secret', PRIVATE_KEY, config.alphaTenantId))
    )
    const bogusRejected = bogus.status === REJECTED
    controls.push(
      control(
        // Not a cross-tenant attempt: it establishes that this deployment can
        // express "rejected" at all, so a 403 from the other tenant is
        // meaningful. A failure here means the probe is blind, not that
        // anything leaked.
        'visibility',
        'a capability signed with a wrong secret → alpha',
        bogusRejected,
        bogusRejected
          ? 'HTTP 403, so 403 is genuinely the reject branch'
          : `expected HTTP 403 but got ${describeResponse(bogus, 160)} — the probe cannot tell accept from reject on this deployment`
      )
    )
    if (!bogusRejected) {
      return error({
        attempted,
        observed: describeResponse(bogus, 300),
        reason:
          'a deliberately invalid read capability was not rejected with 403, so this deployment gives ' +
          'the probe no way to distinguish an accepted signature from a refused one. Most likely ' +
          'storage is not configured (503). Verdict withheld rather than assumed.',
        controls,
      })
    }

    // Each capability is minted the way ITS OWN tenant would mint it — with that
    // tenant's secret and, under pooled tenancy, that tenant's binding. Minting
    // alpha's capability with bravo's binding would be refused by arithmetic
    // rather than by isolation and would prove nothing.
    const alphaSig = mintStorageReadSig(alphaSecret, PRIVATE_KEY, config.alphaTenantId)
    const bravoSig = mintStorageReadSig(bravoSecret, PRIVATE_KEY, config.bravoTenantId)

    // --- positive control ---------------------------------------------------
    const ownRes = await alpha.http.request(path(alphaSig))
    const ownAccepted = accepted(ownRes)
    controls.push(
      control(
        'positive',
        "alpha's capability → alpha",
        ownAccepted,
        ownAccepted
          ? `accepted (${describeResponse(ownRes, 120)}) — the signature passed verification`
          : `REFUSED with 403: alpha does not accept a capability minted with the secret supplied for alpha. ` +
              `The --alpha-storage-secret value is wrong, so no verdict here is meaningful.`
      )
    )
    if (!ownAccepted) {
      return error({
        attempted,
        observed: describeResponse(ownRes, 300),
        reason:
          'the positive control failed: alpha rejected a capability minted with the secret supplied ' +
          'for alpha. The supplied secret does not match the deployment. Fix the input and re-run.',
        controls,
      })
    }

    // --- negatives ----------------------------------------------------------
    const crossAtoB = await bravo.http.request(path(alphaSig), { expectsForeignMarkers: true })
    controls.push(
      control(
        'negative',
        "alpha's capability → bravo (same key)",
        !accepted(crossAtoB),
        accepted(crossAtoB)
          ? `ACCEPTED (${describeResponse(crossAtoB, 160)}) — bravo honoured a capability alpha signed`
          : 'refused with 403',
        'a-to-b',
        'storage-read-capability'
      )
    )

    const crossBtoA = await alpha.http.request(path(bravoSig), { expectsForeignMarkers: true })
    controls.push(
      control(
        'negative',
        "bravo's capability → alpha (same key)",
        !accepted(crossBtoA),
        accepted(crossBtoA)
          ? `ACCEPTED (${describeResponse(crossBtoA, 160)}) — alpha honoured a capability bravo signed`
          : 'refused with 403',
        'b-to-a',
        'storage-read-capability'
      )
    )

    return decide({
      attempted,
      controls,
      leakReason:
        'a private-object read capability crossed the tenant boundary. Every private upload, export ' +
        'and attachment URL in one tenant is readable from the other.',
      onPass: {
        observed:
          'alpha accepted only its own capability for the key and refused bravo’s with 403; bravo did the same',
        reason:
          'the read capability is bound to a per-tenant secret, so it does not transfer between tenants',
      },
      evidence: { key: PRIVATE_KEY, secretsDiffer },
    })
  },
}
