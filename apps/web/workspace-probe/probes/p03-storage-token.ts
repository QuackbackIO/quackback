/**
 * P03 — alpha's storage read token against a bravo object key.
 *
 * `verifyStorageReadToken(secret, key, sig)` (`lib/server/storage/s3.ts:206`)
 * HMACs the capability with the workspace's S3 secret access key. Whether it fails
 * closed across workspaces is therefore entirely a question of whether the two
 * workspaces hold different secrets — which is exactly the argument
 * SAAS-HOSTING-STACK.md §9 uses to reject a single shared bucket with workspace
 * path prefixes.
 *
 * The probe deliberately uses the SAME key string against both workspaces. A
 * signature is bound to its key, so signing workspace A's key and presenting it for
 * workspace B's key would be refused by arithmetic rather than by isolation, and
 * would prove nothing. Holding the key constant isolates the only variable that
 * matters: the secret.
 *
 * The object does not need to exist. `handleStorageGet` verifies the capability
 * BEFORE it touches S3, so a rejected signature is a clean 403 while an accepted
 * one falls through to the object path (302 redirect, 200, or a 5xx from
 * storage). That difference is the whole measurement, and it needs no upload.
 *
 * ## Two negatives, because one of them cannot fail on its own
 *
 * Under pooled tenancy the signed message is `workspaceBind('read|<key>')`
 * (`storage/s3.ts`), which prefixes `t:<workspaceKey>|` — so alpha's capability
 * carries alpha's workspace id and bravo verifies against bravo's. Once workspace ids
 * are in play, a replay of alpha's capability to bravo is refused by ARITHMETIC
 * whatever the secret is: the messages differ, so the HMACs differ, so the
 * probe's only remaining detector was an `invariant` comparing two strings the
 * operator typed rather than two facts read from the fleet. That is a negative
 * control that cannot fail, which is the same defect this suite spends its
 * whole design budget avoiding elsewhere.
 *
 * The fix is the argument the file already makes about the object key, applied
 * to the binding. Signing alpha's KEY and presenting it for bravo's key would
 * be refused by arithmetic, so the key is held constant. The workspace binding is
 * part of the same message and needs the same treatment. So there are two
 * attempts:
 *
 *  - `storage-read-capability` — the faithful replay: alpha's capability
 *    exactly as alpha's own URLs carry it, presented to bravo. Fails on a fleet
 *    with no binding and one shared secret. Over-determined once binding is in
 *    force, and its own detail text says so.
 *  - `storage-secret-interchange` — the message bravo itself verifies (bravo's
 *    binding, bravo's key), HMAC'd with ALPHA's secret. Everything is held
 *    constant except the secret, so bravo accepting it means alpha's secret
 *    verifies on bravo — which is precisely the shared-secret condition §9
 *    relies on being false. This one can fail, and does.
 *
 * Both attempts run in both directions, and the binding each host actually
 * verifies is CALIBRATED against that host rather than assumed from the flags:
 * the probe mints under each candidate message and keeps the one its own workspace
 * accepts. A `--alpha-workspace-key` that does not match the deployment then fails
 * the positive control loudly instead of silently making every negative
 * unfailable.
 */

import { mintStorageReadSig } from '../crypto'
import { blocked, control, decide, describeResponse, dirFrom, halt } from './helpers'
import type { ControlOutcome, Probe, ProbeContext, ProbeResponse } from '../types'

/**
 * A key under a prefix that is NOT in `PUBLIC_STORAGE_PREFIXES`, so the read
 * token is actually required. A public prefix would bypass verification and the
 * probe would measure nothing.
 */
const PRIVATE_KEY = 'uploads/workspace-probe/isolation-probe-object.bin'

const REJECTED = 403

const STORAGE_LEAK_REASON =
  'a private-object read capability, or the secret that mints one, crossed the workspace boundary. ' +
  'Every private upload, export and attachment URL in one workspace is readable from the other.'

function accepted(res: ProbeResponse): boolean {
  return res.status !== REJECTED
}

/**
 * A candidate signed-message shape for one host.
 *
 * `workspaceKey` present reproduces the pooled binding (`t:<id>|read|<key>`);
 * absent reproduces the single-workspace message byte for byte. Which one a
 * deployment uses is discovered, not assumed — see `calibrate`.
 */
interface Binding {
  workspaceKey?: string
  label: string
}

function candidateBindings(workspaceKey: string | undefined): Binding[] {
  const unbound: Binding = { label: 'unbound (single-workspace message)' }
  return workspaceKey
    ? [{ workspaceKey, label: `bound to workspace ${workspaceKey}` }, unbound]
    : [unbound]
}

export const p03StorageToken: Probe = {
  id: 'P03',
  name: 'storage-read-token-cross-workspace',
  family: 'storage',
  proves:
    'A private-object read capability minted with one workspace’s storage secret is refused by the ' +
    'other workspace for the identical object key — i.e. the two workspaces do not share a storage secret, ' +
    'which is the property that makes bucket-per-workspace an isolation boundary rather than a convention.',
  requires: ['http', 'storage-secret'],

  async run(ctx: ProbeContext) {
    const { alpha, bravo, config } = ctx
    const attempted =
      `mint a storage read capability for the private key "${PRIVATE_KEY}" using alpha's S3 secret, ` +
      `then present it to bravo for the identical key — both as alpha's own URLs carry it, and ` +
      `re-signed under the message bravo itself verifies so that the SECRET is the only variable ` +
      `(and the reverse)`

    const alphaSecret = config.alphaStorageSecret
    const bravoSecret = config.bravoStorageSecret
    if (!alphaSecret || !bravoSecret) {
      return blocked({
        attempted,
        reason:
          'both workspaces’ S3/R2 secret access keys are required to mint read capabilities. ' +
          'Pass --alpha-storage-secret and --bravo-storage-secret (or ALPHA_S3_SECRET_ACCESS_KEY / ' +
          'BRAVO_S3_SECRET_ACCESS_KEY).',
      })
    }

    const controls: ControlOutcome[] = []
    const evidence: Record<string, unknown> = { key: PRIVATE_KEY }
    const path = (sig: string) => `/api/storage/${PRIVATE_KEY}?read=${sig}`

    // --- invariant: the secrets must differ ---------------------------------
    //
    // Still recorded, still a LEAK when violated — but it is no longer the only
    // thing standing between a shared secret and a PASS. The interchange
    // negative below observes the same fact from the fleet rather than from the
    // operator's flags.
    const secretsDiffer = alphaSecret !== bravoSecret
    controls.push(
      control(
        'invariant',
        'alpha and bravo hold different storage secrets',
        secretsDiffer,
        secretsDiffer
          ? 'distinct'
          : 'IDENTICAL — every read capability minted for either workspace verifies against both, by construction'
      )
    )

    // --- invariant: the bindings must differ, when there are bindings --------
    //
    // Two workspaces sharing a workspace id would sign the identical message, which
    // makes the binding no separation at all.
    if (config.alphaWorkspaceKey && config.bravoWorkspaceKey) {
      const idsDiffer = config.alphaWorkspaceKey !== config.bravoWorkspaceKey
      controls.push(
        control(
          'invariant',
          'alpha and bravo bind their read capabilities to different workspace ids',
          idsDiffer,
          idsDiffer
            ? `alpha ${config.alphaWorkspaceKey}, bravo ${config.bravoWorkspaceKey}`
            : `IDENTICAL (${config.alphaWorkspaceKey}) — both workspaces sign the same message, so the ` +
                'binding separates nothing'
        )
      )
    }

    // --- discriminator control: a bogus signature must be rejected -----------
    // Without this, a deployment with storage unconfigured (503 for everything)
    // would look like "alpha accepted, bravo refused" and pass.
    const bogus = await alpha.http.request(
      path(mintStorageReadSig('not-the-secret', PRIVATE_KEY, config.alphaWorkspaceKey))
    )
    const bogusRejected = bogus.status === REJECTED
    controls.push(
      control(
        // Not a cross-workspace attempt: it establishes that this deployment can
        // express "rejected" at all, so a 403 from the other workspace is
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
      return halt({
        attempted,
        controls,
        stopped: {
          label: 'this deployment can express a refusal at all',
          detail: describeResponse(bogus, 300),
        },
        reason:
          'a deliberately invalid read capability was not rejected with 403, so this deployment gives ' +
          'the probe no way to distinguish an accepted signature from a refused one. Most likely ' +
          'storage is not configured (503). Verdict withheld rather than assumed.',
        leakReason: STORAGE_LEAK_REASON,
        evidence,
      })
    }

    // --- calibration: which message does each host actually verify? ----------
    //
    // Read from the fleet rather than assumed from the flags. Under pooled
    // tenancy the message carries `t:<workspaceKey>|`; a single-workspace deployment
    // signs the historical message byte for byte. Getting this wrong silently
    // would make every negative below unfailable, so the host itself decides.
    const calibrate = async (
      handle: typeof alpha,
      secret: string,
      workspaceKey: string | undefined
    ): Promise<{ binding: Binding | null; last: ProbeResponse }> => {
      let last: ProbeResponse | null = null
      for (const binding of candidateBindings(workspaceKey)) {
        const res = await handle.http.request(
          path(mintStorageReadSig(secret, PRIVATE_KEY, binding.workspaceKey))
        )
        last = res
        if (accepted(res)) return { binding, last: res }
      }
      return { binding: null, last: last! }
    }

    const calibrated = {
      alpha: await calibrate(alpha, alphaSecret, config.alphaWorkspaceKey),
      bravo: await calibrate(bravo, bravoSecret, config.bravoWorkspaceKey),
    }

    // --- positive controls, one per host -------------------------------------
    for (const slot of ['alpha', 'bravo'] as const) {
      const { binding, last } = calibrated[slot]
      controls.push(
        control(
          'positive',
          `${slot}'s own capability → ${slot}`,
          binding !== null,
          binding
            ? `accepted, ${binding.label} (${describeResponse(last, 120)}) — the signature passed verification`
            : `REFUSED with 403 under every candidate message (${candidateBindings(
                slot === 'alpha' ? config.alphaWorkspaceKey : config.bravoWorkspaceKey
              )
                .map((b) => b.label)
                .join(
                  ', '
                )}). ${slot} does not accept a capability minted with the secret supplied ` +
                `for ${slot}: the --${slot}-storage-secret value, or the --${slot}-workspace-id binding, ` +
                'does not match the deployment. No verdict here would be meaningful.'
        )
      )
    }
    if (!calibrated.alpha.binding || !calibrated.bravo.binding) {
      return halt({
        attempted,
        controls,
        stopped: {
          label: 'both hosts accept a capability minted with their own supplied secret',
          detail:
            `alpha ${describeResponse(calibrated.alpha.last, 150)}; ` +
            `bravo ${describeResponse(calibrated.bravo.last, 150)}`,
        },
        reason:
          'the positive control failed: a host rejected a capability minted with the secret supplied ' +
          'for it. The supplied secret does not match the deployment. Fix the input and re-run.',
        leakReason: STORAGE_LEAK_REASON,
        evidence,
      })
    }

    const binding = { alpha: calibrated.alpha.binding, bravo: calibrated.bravo.binding }
    const bindingsDiffer = binding.alpha.workspaceKey !== binding.bravo.workspaceKey
    evidence.observedBinding = { alpha: binding.alpha.label, bravo: binding.bravo.label }
    evidence.bindingsDiffer = bindingsDiffer
    evidence.secretsDiffer = secretsDiffer

    // --- negatives, both attempts, both directions ---------------------------
    for (const [fromSlot, to] of [
      ['alpha', bravo],
      ['bravo', alpha],
    ] as const) {
      const fromSecret = fromSlot === 'alpha' ? alphaSecret : bravoSecret
      const fromBinding = binding[fromSlot]
      const toBinding = binding[to.slot]
      const direction = dirFrom(fromSlot)

      // 1. The faithful replay: the capability exactly as this workspace's own
      //    URLs carry it, presented to the other host.
      const replay = await to.http.request(
        path(mintStorageReadSig(fromSecret, PRIVATE_KEY, fromBinding.workspaceKey)),
        { expectsForeignMarkers: true }
      )
      controls.push(
        control(
          'negative',
          `${fromSlot}'s capability as issued → ${to.slot} (same key)`,
          !accepted(replay),
          accepted(replay)
            ? `ACCEPTED (${describeResponse(replay, 160)}) — ${to.slot} honoured a capability ${fromSlot} signed`
            : bindingsDiffer
              ? 'refused with 403 — but note this attempt is OVER-DETERMINED: the two hosts sign ' +
                `different messages (${fromBinding.label} vs ${toBinding.label}), so this refusal ` +
                'would hold even on a shared secret. The interchange attempt below is the one that ' +
                'isolates the secret.'
              : 'refused with 403 — and the two hosts sign the identical message, so the secret is ' +
                'the only thing that refused it',
          direction,
          'storage-read-capability'
        )
      )

      // 2. The interchange: the message the TARGET verifies, signed with the
      //    SOURCE's secret. Key and binding held constant; secret varied. This
      //    is accepted if and only if the two workspaces' secrets interchange.
      const interchange = await to.http.request(
        path(mintStorageReadSig(fromSecret, PRIVATE_KEY, toBinding.workspaceKey)),
        { expectsForeignMarkers: true }
      )
      controls.push(
        control(
          'negative',
          `${fromSlot}'s SECRET against ${to.slot}'s own message (same key, ${to.slot}'s binding)`,
          !accepted(interchange),
          accepted(interchange)
            ? `ACCEPTED (${describeResponse(interchange, 160)}) — ${fromSlot}'s storage secret verifies ` +
                `on ${to.slot}. The two workspaces share a storage secret, so anyone who can mint a read ` +
                `URL in ${fromSlot} can mint one for any object in ${to.slot}.`
            : `refused with 403 — ${fromSlot}'s secret does not verify on ${to.slot} for a message ` +
                `${to.slot} itself would accept, so the secrets are genuinely distinct`,
          direction,
          'storage-secret-interchange'
        )
      )
    }

    return decide({
      attempted,
      controls,
      leakReason: STORAGE_LEAK_REASON,
      onPass: {
        observed:
          'each host accepted only a capability minted with its own secret, and refused the other ' +
          "workspace's secret even against a message it would otherwise have verified" +
          (bindingsDiffer
            ? ` (the hosts bind different workspace ids, so the plain replay was over-determined and the ` +
              `secret-interchange attempt is what carried the verdict)`
            : ''),
        reason:
          'the read capability is bound to a per-workspace secret, so neither the capability nor the ' +
          'secret that mints it transfers between workspaces',
      },
      evidence,
    })
  },
}
