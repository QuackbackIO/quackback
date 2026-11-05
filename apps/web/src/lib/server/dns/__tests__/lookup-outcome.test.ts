/**
 * A failed lookup is either an answer (nothing is published at the name) or
 * no answer at all (the nameserver could not be asked). Only the first may
 * take away something a domain already proved.
 */
import { describe, expect, it } from 'vitest'
import { isNoAnswer } from '../lookup-outcome'

const failure = (code: string) => Object.assign(new Error(code), { code })

describe('isNoAnswer', () => {
  it('reads an empty name or a name that does not exist as an answer', () => {
    for (const code of ['ENODATA', 'ENOTFOUND', 'NOTFOUND', 'ENONAME']) {
      expect(isNoAnswer(failure(code))).toBe(true)
    }
  })

  it('reads a nameserver that did not answer as no answer at all', () => {
    for (const code of ['ETIMEOUT', 'ESERVFAIL', 'ECONNREFUSED', 'EREFUSED', 'ECANCELLED']) {
      expect(isNoAnswer(failure(code))).toBe(false)
    }
  })

  it('reads an error with no code, or no error object, as no answer at all', () => {
    expect(isNoAnswer(new Error('ENOTFOUND'))).toBe(false)
    expect(isNoAnswer(undefined)).toBe(false)
    expect(isNoAnswer('ENOTFOUND')).toBe(false)
  })
})
