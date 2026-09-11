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
})
