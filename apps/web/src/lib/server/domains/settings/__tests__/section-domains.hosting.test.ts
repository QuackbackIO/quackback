// @vitest-environment node
/**
 * Where section domains take the workspace to be hosted. A pooled process is
 * Cloud's fleet, so a workspace there is Cloud even before the control plane's
 * projections land: read as self-hosted it would take any hostname and verify
 * it with a probe from inside the fleet, where another workspace's hostname
 * answers.
 */
import { describe, expect, it } from 'vitest'
import { hostingOf, routableSectionDomains } from '../section-domains.hosting'

const POOLED = { QUACKBACK_TENANCY: 'pooled' }
const SINGLE = {}
const VERIFIED = '2026-11-01T00:00:00.000Z'

describe('hostingOf', () => {
  it('is Cloud on a pooled process with neither projection, and has no identity', () => {
    expect(hostingOf({ cloud: null, cloudIdentity: null }, POOLED)).toEqual({
      cloud: true,
      projection: null,
    })
    expect(hostingOf(null, POOLED).cloud).toBe(true)
  })

  it('is self-hosted on a single-workspace process with neither', () => {
    expect(hostingOf({ cloud: null, cloudIdentity: null }, SINGLE).cloud).toBe(false)
  })

  it('is Cloud on a single-workspace process the control plane has enabled', () => {
    expect(hostingOf({ cloud: { enabled: true }, cloudIdentity: null }, SINGLE).cloud).toBe(true)
  })
})

describe('a pooled workspace whose projection has not landed', () => {
  it('routes no section hostname, even one stored as verified', () => {
    const hosting = hostingOf({ cloud: null, cloudIdentity: null }, POOLED)
    const routable = routableSectionDomains(
      { help: { hostname: 'help.other.com', verifiedAt: VERIFIED } },
      hosting
    )
    expect(routable.help?.verifiedAt).toBeNull()
  })
})
