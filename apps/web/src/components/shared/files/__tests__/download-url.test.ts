import { describe, it, expect } from 'vitest'
import { downloadUrl } from '../download-url'

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
})
