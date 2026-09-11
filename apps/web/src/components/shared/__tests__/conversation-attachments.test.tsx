// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ConversationAttachmentList } from '../conversation-attachments'

describe('ConversationAttachmentList', () => {
  it('renders image attachments with a contain-fitted thumb, not object-cover', () => {
    const { container } = render(
      <ConversationAttachmentList
        attachments={[
          {
            url: 'https://cdn.example.com/wide.png',
            name: 'wide.png',
            contentType: 'image/png',
            size: 100,
          },
        ]}
      />
    )
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.className).toContain('object-contain')
    expect(img?.className).not.toContain('object-cover')
  })

  it('renders a safe raster data-URI that lift would attach', () => {
    const src = 'data:image/png;base64,aaaa'
    const { container } = render(
      <ConversationAttachmentList
        attachments={[{ url: src, name: 'shot.png', contentType: 'image/png', size: 0 }]}
      />
    )
    expect(container.querySelector('img')?.getAttribute('src')).toBe(src)
  })

  it('drops javascript: and svg data-URI image srcs', () => {
    const { container } = render(
      <ConversationAttachmentList
        attachments={[
          {
            url: 'javascript:alert(1)',
            name: 'x',
            contentType: 'image/png',
            size: 0,
          },
          {
            url: 'data:image/svg+xml;base64,PHN2Zz4=',
            name: 'x.svg',
            contentType: 'image/svg+xml',
            size: 0,
          },
        ]}
      />
    )
    expect(container.querySelector('img')).toBeNull()
  })
})
