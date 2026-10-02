// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { AgentMessageBubble, VisitorMessageBubble } from '../message-bubble'
import {
  AssistantAnswer,
  AssistantSourcesTrace,
} from '@/components/shared/conversation/assistant-turn'
import type {
  AgentConversationMessageDTO,
  ConversationMessageCitation,
} from '@/lib/shared/conversation/types'
import type { TiptapContent } from '@/lib/shared/db-types'

afterEach(cleanup)

const citation: ConversationMessageCitation = {
  type: 'article',
  id: 'article_1',
  title: 'AI features',
  url: 'https://quackback.io/hc/en/articles/64-ai-features',
}

function message(
  content: string,
  isAssistant: boolean,
  contentJson: TiptapContent | null
): AgentConversationMessageDTO {
  return {
    id: 'conversation_msg_1' as never,
    conversationId: 'conversation_1' as never,
    ticketId: null,
    senderType: 'agent',
    content,
    contentJson,
    createdAt: '2026-10-02T10:59:00.000Z',
    author: { principalId: 'principal_1' as never, displayName: 'Quinn', avatarUrl: null },
    attachments: [],
    citations: [citation],
    isAssistant,
    isInternal: false,
    viaEmail: false,
    systemEvent: null,
    reactions: [],
    flaggedAt: null,
    postSuggestion: null,
    translatedFrom: null,
  }
}

for (const surface of ['admin', 'widget'] as const) {
  function bubble(content: string, isAssistant = true, contentJson: TiptapContent | null = null) {
    return render(
      <IntlProvider locale="en" messages={{}}>
        {surface === 'admin' ? (
          <AgentMessageBubble message={message(content, isAssistant, contentJson)} />
        ) : (
          <VisitorMessageBubble
            content={content}
            isAssistant={isAssistant}
            citations={[citation]}
            contentJson={contentJson}
          />
        )}
      </IntlProvider>
    )
  }

  describe(`${surface} message rendering`, () => {
    it('renders the screenshot link as a clickable label', () => {
      const { container } = bubble(
        'For **Quackback Cloud**, AI is included. [Use AI-powered features](https://quackback.io/hc/en/articles/64-ai-features)'
      )
      expect(screen.getByRole('link', { name: 'Use AI-powered features' })).toHaveAttribute(
        'href',
        citation.url
      )
      expect(container.querySelector('strong')).toHaveTextContent('Quackback Cloud')
      expect(container.textContent).not.toContain('](https://')
    })

    it('renders headings, nested emphasis, strike, quotes and a list without a blank separator', () => {
      const { container } = bubble(
        '## Setup\nUse **bold and *italic*** or ~~old~~.\n- First\n  - Nested\n\n> A quote'
      )
      expect(screen.getByRole('heading', { level: 2, name: 'Setup' })).toBeInTheDocument()
      expect(container.querySelector('strong em')).toHaveTextContent('italic')
      expect(container.querySelector('del')).toHaveTextContent('old')
      expect(container.querySelector('ul ul li')).toHaveTextContent('Nested')
      expect(container.querySelector('blockquote')).toHaveTextContent('A quote')
    })

    it('preserves the starting number of a resumed Markdown list', () => {
      const { container } = bubble('3. Third\n4. Fourth')
      expect(container.querySelector('ol')).toHaveAttribute('start', '3')
    })

    it('keeps citations and formatting literal inside inline and fenced code', () => {
      const { container } = bubble(
        'Use `**literal** [1]`.\n\n```js\nconst value = "[1]";\n```\n\nRead **the guide [1]**.'
      )
      expect(container.querySelector('p code')).toHaveTextContent('**literal** [1]')
      expect(container.querySelector('pre code')).toHaveTextContent('const value = "[1]";')
      expect(screen.getAllByRole('link', { name: 'Source 1: AI features' })).toHaveLength(1)
    })

    it('renders GFM tables and disabled task checkboxes', () => {
      const { container } = bubble(
        '| Plan | AI |\n| --- | --- |\n| Paid | Included |\n\n- [x] Finished\n- [ ] Pending'
      )
      expect(screen.getByRole('table')).toHaveTextContent('Included')
      expect(screen.getAllByRole('checkbox')).toHaveLength(2)
      expect(screen.getAllByRole('checkbox')[0]).toBeChecked()
      expect(screen.getAllByRole('checkbox')[1]).not.toBeChecked()
      expect(container.querySelectorAll('input:disabled')).toHaveLength(2)
    })

    it('renders Markdown-only human replies and autolinks', () => {
      bubble('Read [our guide](https://example.com/guide) or https://example.com/docs.', false)
      expect(screen.getByRole('link', { name: 'our guide' })).toHaveAttribute(
        'href',
        'https://example.com/guide'
      )
      expect(screen.getByRole('link', { name: 'https://example.com/docs' })).toBeInTheDocument()
    })

    it('keeps relative and fragment links on the serving origin', () => {
      bubble('[Help](/hc/en) [Section](#setup) [Sibling](../guide)')
      expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute('href', '/hc/en')
      expect(screen.getByRole('link', { name: 'Section' })).toHaveAttribute('href', '#setup')
      expect(screen.getByRole('link', { name: 'Sibling' })).toHaveAttribute('href', '../guide')
    })

    it('does not create executable HTML or links from Markdown', () => {
      const { container } = bubble(
        '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert%281%29) ![bad](data:image/svg+xml;base64,PHN2Zz4=)'
      )
      expect(container.querySelector('script, img, [onerror]')).toBeNull()
      expect(screen.queryByRole('link', { name: 'unsafe' })).not.toBeInTheDocument()
      expect(container.textContent).toContain('unsafe')
      expect(container.textContent).toContain('<script>alert(1)</script>')
    })

    it('preserves canonical rich text instead of parsing its plain projection', () => {
      const { container } = bubble('Wrong projection', false, {
        type: 'doc',
        content: [
          {
            type: 'orderedList',
            attrs: { start: 7 },
            content: [
              {
                type: 'listItem',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Canonical' }] }],
              },
            ],
          },
        ],
      })
      expect(container.querySelector('ol')).toHaveAttribute('start', '7')
      expect(container.textContent).toContain('Canonical')
      expect(container.textContent).not.toContain('Wrong projection')
    })
  })
}

describe('citation rendering safety', () => {
  it('formats Markdown-only internal notes in the admin thread', () => {
    render(
      <AgentMessageBubble
        message={{
          ...message('Read **this** [guide](https://example.com/guide)', false, null),
          isInternal: true,
        }}
      />
    )
    expect(screen.getByRole('link', { name: 'guide' })).toHaveAttribute(
      'href',
      'https://example.com/guide'
    )
    expect(screen.getByText('this').tagName).toBe('STRONG')
  })
  it('keeps numeric Markdown link labels as links, without nesting citation anchors', () => {
    const { container } = render(
      <AssistantAnswer
        text="[1](https://example.com) and [guide [1]](https://example.com/guide)"
        citations={[citation]}
      />
    )
    expect(screen.getByRole('link', { name: '1' })).toHaveAttribute('href', 'https://example.com/')
    expect(screen.getByRole('link', { name: 'guide [1]' })).toBeInTheDocument()
    expect(container.querySelector('a a')).toBeNull()
  })

  it('preserves unresolved numeric brackets in a completed answer', () => {
    const { container } = render(<AssistantAnswer text="array[9] and [1]" citations={[]} />)
    expect(container).toHaveTextContent('array[9] and [1]')
  })

  it('keeps array indices literal even when the citation number exists', () => {
    const { container } = render(
      <AssistantAnswer text="array[1] and read [1]." citations={[citation]} />
    )
    expect(container.textContent).toContain('array[1]')
    expect(screen.getAllByRole('link', { name: 'Source 1: AI features' })).toHaveLength(1)
  })

  it('suppresses unresolved citation markers only while streaming', () => {
    const { container } = render(<AssistantAnswer text="Read this [1]." citations={[]} caret />)
    expect(container.textContent).toBe('Read this .')
  })

  it('refuses unsafe citation URLs in inline dots and the expanded source trace', () => {
    const unsafe = { ...citation, url: 'javascript:alert(1)' }
    const { container } = render(
      <IntlProvider locale="en" messages={{}}>
        <AssistantAnswer text="Read [1]." citations={[unsafe]} />
        <AssistantSourcesTrace citations={[unsafe]} />
      </IntlProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: /Searched the knowledge base/ }))
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('AI features')
  })
})
