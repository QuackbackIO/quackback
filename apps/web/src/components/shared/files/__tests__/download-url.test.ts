import { describe, it, expect } from 'vitest'
import { downloadUrl, withQueryParams } from '../download-url'

describe('withQueryParams', () => {
  it('keeps the fragment last, after a query on a bare path', () => {
    expect(withQueryParams('/x#section', { a: '1' })).toBe('/x?a=1#section')
  })
  it('keeps the fragment last, after extending an existing query', () => {
    expect(withQueryParams('/x?read=1#section', { a: '1' })).toBe('/x?read=1&a=1#section')
  })
  it('encodes param values', () => {
    expect(withQueryParams('/x', { filename: 'a&b.txt' })).toBe('/x?filename=a%26b.txt')
  })
})

describe('downloadUrl', () => {
  it('keeps the read capability and adds the download mode and name', () => {
    expect(downloadUrl('/api/storage/files/a.pdf?read=sig&exp=1', 'Q3 Plan.pdf')).toBe(
      '/api/storage/files/a.pdf?read=sig&exp=1&download=1&filename=Q3%20Plan.pdf'
    )
  })
  it('starts a query on a public URL', () => {
    expect(downloadUrl('/api/storage/logos/a.png', 'a.png')).toBe(
      '/api/storage/logos/a.png?download=1&filename=a.png'
    )
  })
  it('encodes names that would break the query', () => {
    expect(downloadUrl('/x?read=1', 'a&b=c#d.txt')).toBe(
      '/x?read=1&download=1&filename=a%26b%3Dc%23d.txt'
    )
  })
  it('keeps a URL fragment after the new params, instead of swallowing it', () => {
    expect(downloadUrl('/api/storage/files/a.pdf?read=sig#section-2', 'a.pdf')).toBe(
      '/api/storage/files/a.pdf?read=sig&download=1&filename=a.pdf#section-2'
    )
  })
})
