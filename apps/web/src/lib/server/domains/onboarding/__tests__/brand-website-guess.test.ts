import { describe, expect, it } from 'vitest'
import { brandWebsiteGuess, brandWebsiteOf } from '../brand-website-guess'

describe("the brand step's website guess", () => {
  it('offers the company website behind a work email', () => {
    expect(brandWebsiteGuess('you@acme.example')).toBe('acme.example')
    expect(brandWebsiteGuess('You@ACME.co.uk')).toBe('acme.co.uk')
  })

  it('has none for a personal, relay or malformed address', () => {
    for (const email of [
      'you@gmail.com',
      'x@abc.privaterelay.appleid.com',
      '1234+you@users.noreply.github.com',
      'you@mozmail.com',
      'you',
      '',
    ])
      expect(brandWebsiteGuess(email), email).toBeNull()
  })

  it('has none for an academic address: a student is not branding the university', () => {
    for (const domain of [
      'stanford.edu',
      'cs.stanford.edu',
      'ox.ac.uk',
      'cs.ox.ac.uk',
      'u-tokyo.ac.jp',
      'unimelb.edu.au',
      'student.unimelb.edu.au',
      'auckland.ac.nz',
      'iitb.ac.in',
      'uct.ac.za',
    ])
      expect(brandWebsiteGuess(`you@${domain}`), domain).toBeNull()
    // A company that only has "edu" or "ac" in its name is still a company.
    expect(brandWebsiteGuess('you@edu-tools.example')).toBe('edu-tools.example')
    expect(brandWebsiteGuess('you@ac.example')).toBe('ac.example')
    expect(brandWebsiteGuess('you@education.co.uk')).toBe('education.co.uk')
  })

  it('uses the registrable domain, never a mail subdomain', () => {
    expect(brandWebsiteGuess('you@mail.acme.com')).toBe('acme.com')
    expect(brandWebsiteGuess('you@eu.acme.co.uk')).toBe('acme.co.uk')
    expect(brandWebsiteGuess('you@a.b.acme.com.au')).toBe('acme.com.au')
  })

  it('reads a recorded lookup domain by the same rules', () => {
    expect(brandWebsiteOf('mail.acme.example')).toBe('acme.example')
    expect(brandWebsiteOf('cs.ox.ac.uk')).toBeNull()
    expect(brandWebsiteOf('gmail.com')).toBeNull()
  })
})
