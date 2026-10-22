import { describe, it, expect } from 'vitest'
import { render } from '@react-email/components'
import { emailBodyHtml } from '../templates/email-body-html'
import { ChangelogPublishedEmail } from '../templates/changelog-published'

// What the content serializer emits for an image with no stored dimensions.
const SERIALIZED_IMG =
  '<img src="https://example.com/api/storage/changelog-images/shot.jpeg?email=1" alt="A wide screenshot" loading="lazy" decoding="async" class="max-w-full h-auto rounded-lg"  />'

describe('emailBodyHtml', () => {
  it('caps images at the email width with inline styles instead of classes', () => {
    const out = emailBodyHtml(`<p>${SERIALIZED_IMG}</p>`)
    expect(out).toBe(
      '<p><img src="https://example.com/api/storage/changelog-images/shot.jpeg?email=1" alt="A wide screenshot" style="display:block;max-width:100%;height:auto;border:0;border-radius:8px;" /></p>'
    )
  })

  it('keeps a resized image at its chosen width, but never wider than the email', () => {
    const out = emailBodyHtml(
      '<img src="https://example.com/a.png" alt="" loading="lazy" decoding="async" class="max-w-full h-auto rounded-lg" style="width:320px;" />'
    )
    expect(out).toContain('style="display:block;width:100%;max-width:320px;height:auto;')
    expect(out).not.toContain('class=')
  })

  it('drops the aspect-ratio hint but keeps the width and height attributes', () => {
    const out = emailBodyHtml(
      '<img src="https://example.com/a.png" alt="x" width="1920" height="1080" loading="lazy" decoding="async" class="max-w-full h-auto rounded-lg" style="aspect-ratio: 1920 / 1080;" />'
    )
    expect(out).toContain('width="1920" height="1080"')
    expect(out).toContain('max-width:100%;height:auto;')
    expect(out).not.toContain('aspect-ratio')
  })

  it('wraps code blocks and fits tables to the email width', () => {
    const out = emailBodyHtml(
      '<pre class="not-prose rounded-lg bg-muted p-4 overflow-x-auto"><code class="language-ts">x</code></pre><table class="w-full"><tr><td class="border p-2">a</td></tr></table>'
    )
    expect(out).toContain(
      '<pre style="white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;"><code class="language-ts">x</code></pre>'
    )
    expect(out).toContain('<table style="width:100%;max-width:100%;border-collapse:collapse;">')
  })

  it('leaves everything else untouched', () => {
    const html =
      '<h2 id="a">Title</h2><p>Text with <a href="https://example.com" class="text-primary underline">a link</a>.</p>'
    expect(emailBodyHtml(html)).toBe(html)
  })
})

describe('ChangelogPublishedEmail images', () => {
  it('renders body images with inline sizing that email clients honour', async () => {
    const html = await render(
      ChangelogPublishedEmail({
        changelogTitle: 'Release',
        changelogUrl: 'https://example.com/changelog/1',
        contentPreview: '',
        bodyHtml: `<p>${SERIALIZED_IMG}</p>`,
        organizationName: 'Acme',
        unsubscribeUrl: 'https://example.com/unsubscribe?token=t',
      })
    )
    expect(html).toContain(
      'style="display:block;max-width:100%;height:auto;border:0;border-radius:8px;"'
    )
    expect(html).not.toContain('max-w-full')
  })
})
