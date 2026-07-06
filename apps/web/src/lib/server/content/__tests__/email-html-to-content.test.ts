/**
 * Inbound email HTML -> contentJson conversion. Exercises the full pipeline
 * (quote-trim -> line-boundary pre-pass -> sanitize -> turndown ->
 * markdownToTiptapJson -> sanitizeTiptapContent) end to end: trailing quoted
 * history is dropped while a sender's own mid-reply quote survives, line
 * structure survives sanitization, benign formatting maps onto the right nodes,
 * and hostile markup is neutralized.
 */
import { describe, it, expect } from 'vitest'
import { emailHtmlToContent } from '../email-html-to-content'
import type { TiptapContent } from '@/lib/server/db'

/** Depth-first collect every node of a given type. */
function nodesOfType(node: TiptapContent | null | undefined, type: string): TiptapContent[] {
  if (!node) return []
  const out: TiptapContent[] = []
  const walk = (n: TiptapContent) => {
    if (n.type === type) out.push(n)
    for (const c of n.content ?? []) walk(c)
  }
  walk(node)
  return out
}

/** All text-node strings, concatenated. */
function allText(node: TiptapContent | null | undefined): string {
  return nodesOfType(node, 'text')
    .map((n) => n.text ?? '')
    .join(' ')
}

/** Does any text node carry a mark of the given type? */
function hasMark(node: TiptapContent | null | undefined, mark: string): boolean {
  return nodesOfType(node, 'text').some((n) =>
    (n.marks ?? []).some((m: { type: string }) => m.type === mark)
  )
}

describe('emailHtmlToContent', () => {
  it('returns nulls for empty/blank html', () => {
    expect(emailHtmlToContent('')).toEqual({ text: '', contentJson: null })
    expect(emailHtmlToContent('   \n\t ')).toEqual({ text: '', contentJson: null })
  })

  describe('gmail-style reply', () => {
    const gmail =
      '<div dir="ltr">Thanks for the <b>update</b>!<div><br></div>' +
      '<div>Here is my list:</div>' +
      '<ul><li>one</li><li>two</li></ul>' +
      '<div>See <a href="https://example.com/x">this link</a>.</div>' +
      '<div class="gmail_quote gmail_quote_container">' +
      '<div dir="ltr" class="gmail_attr">On Mon, Jan 1, 2026 at 1:00 PM John &lt;' +
      '<a href="mailto:john@example.com">john@example.com</a>&gt; wrote:<br></div>' +
      '<blockquote class="gmail_quote" style="border-left:1px solid #ccc;padding-left:1ex">' +
      '<div dir="ltr"><div>Original message body</div><div>- John</div></div></blockquote>' +
      '</div></div>'

    it('drops the quoted history', () => {
      const { text, contentJson } = emailHtmlToContent(gmail)
      const json = JSON.stringify(contentJson)
      expect(json).not.toContain('Original message body')
      expect(json).not.toContain('wrote:')
      expect(text).not.toContain('Original message body')
    })

    it('preserves the sender line structure and content', () => {
      const { text } = emailHtmlToContent(gmail)
      expect(text).toContain('Thanks for the update!')
      expect(text).toContain('Here is my list:')
      expect(text).toContain('See this link')
    })

    it('keeps bold, the list, and the link in contentJson', () => {
      const { contentJson } = emailHtmlToContent(gmail)
      expect(hasMark(contentJson, 'bold')).toBe(true)
      const lists = nodesOfType(contentJson, 'bulletList')
      expect(lists).toHaveLength(1)
      expect(nodesOfType(contentJson, 'listItem')).toHaveLength(2)
      const links = nodesOfType(contentJson, 'text').filter((n) =>
        (n.marks ?? []).some((m: { type: string; attrs?: { href?: string } }) => m.type === 'link')
      )
      expect(links.length).toBeGreaterThan(0)
      const href = (links[0].marks ?? []).find(
        (m: { type: string; attrs?: { href?: string } }) => m.type === 'link'
      )?.attrs?.href
      expect(href).toBe('https://example.com/x')
    })
  })

  describe('outlook-style reply', () => {
    const outlook =
      '<div>Sounds good, shipping today.</div>' +
      '<div style="border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0in 0in 0in">' +
      '<p class="MsoNormal"><b>From:</b> Support &lt;support@x.com&gt;<br>' +
      '<b>Sent:</b> Monday<br><b>To:</b> Me<br></p></div>' +
      '<div><p>Quoted original text here.</p></div>'

    it('drops the border-top divider and everything after it', () => {
      const { text, contentJson } = emailHtmlToContent(outlook)
      expect(text).toContain('Sounds good, shipping today.')
      expect(text).not.toContain('Quoted original text')
      expect(JSON.stringify(contentJson)).not.toContain('From:')
    })

    it('does NOT treat a bare border-top divider (signature/content) as history', () => {
      // A styled divider with no adjacent Outlook From:/Sent: header block is a
      // signature or content separator, not a quote boundary — real content
      // after it must survive.
      const withDivider =
        '<div>Here is the answer you asked for.</div>' +
        '<div style="border-top:1px solid #ccc;padding-top:8px">' +
        '<p>Extra detail the customer wrote below their divider.</p></div>'
      const { text } = emailHtmlToContent(withDivider)
      expect(text).toContain('Here is the answer you asked for.')
      expect(text).toContain('Extra detail the customer wrote below their divider.')
    })
  })

  describe('outlook divRplyFwdMsg reply header', () => {
    const owa =
      '<div>Replying inline above.</div>' +
      '<div id="divRplyFwdMsg"><hr>' +
      '<b>From:</b> a@b.com<br><b>Sent:</b> Tue</div>' +
      '<div>old quoted content</div>'

    it('drops the reply/forward header block', () => {
      const { text } = emailHtmlToContent(owa)
      expect(text).toContain('Replying inline above.')
      expect(text).not.toContain('old quoted content')
      expect(text).not.toContain('From:')
    })
  })

  describe('apple-mail-style reply (attribution + type=cite blockquote)', () => {
    const apple =
      '<div>My answer is yes.</div>' +
      '<div>On Jan 1, 2026, at 3:00 PM, Jane Doe &lt;jane@x.com&gt; wrote:</div>' +
      '<blockquote type="cite"><div>please advise</div></blockquote>'

    it('drops the attribution line and the quote that follows it', () => {
      const { text } = emailHtmlToContent(apple)
      expect(text).toContain('My answer is yes.')
      expect(text).not.toContain('please advise')
      expect(text).not.toContain('wrote:')
    })
  })

  describe('sender-authored mid-reply blockquote', () => {
    const midQuote =
      '<div>As you said:</div>' +
      '<blockquote>the sky is blue</blockquote>' +
      '<div>I disagree, it is grey today.</div>'

    it('survives — a bare blockquote is not treated as trailing history', () => {
      const { text, contentJson } = emailHtmlToContent(midQuote)
      expect(nodesOfType(contentJson, 'blockquote')).toHaveLength(1)
      expect(text).toContain('the sky is blue')
      // Content AFTER the quote is kept too (not truncated at the blockquote).
      expect(text).toContain('I disagree, it is grey today.')
    })
  })

  describe('headings + code', () => {
    const doc =
      '<h2>Release notes</h2><p>We shipped:</p>' +
      '<pre><code>const x = 1;\nconst y = 2;</code></pre><p>Done.</p>'

    it('maps h2 to a heading node and pre/code to a code block', () => {
      const { contentJson } = emailHtmlToContent(doc)
      const headings = nodesOfType(contentJson, 'heading')
      expect(headings).toHaveLength(1)
      expect(headings[0].attrs?.level).toBe(2)
      const codeBlocks = nodesOfType(contentJson, 'codeBlock')
      expect(codeBlocks).toHaveLength(1)
      expect(allText(codeBlocks[0])).toContain('const x = 1;')
    })
  })

  describe('hostile html', () => {
    const hostile =
      '<p onclick="alert(1)">Click <a href="javascript:alert(2)">here</a> now</p>' +
      '<script>alert(3)</script>' +
      '<img src="cid:logo.png" alt="logo">'

    it('neutralizes scripts, event handlers, and javascript: links', () => {
      const { text, contentJson } = emailHtmlToContent(hostile)
      const json = JSON.stringify(contentJson)
      expect(json).not.toContain('alert')
      expect(json).not.toContain('javascript')
      expect(json).not.toContain('onclick')
      expect(json).not.toContain('<script')
      // The visible words survive as plain text; the malicious link has no href mark.
      expect(text).toContain('Click here now')
      expect(hasMark(contentJson, 'link')).toBe(false)
    })
  })

  describe('image handling (P4.4 handoff)', () => {
    it('keeps an external https image node with its src intact', () => {
      const { contentJson } = emailHtmlToContent(
        '<img src="https://cdn.example.com/pic.png" alt="pic" width="300" height="200">'
      )
      const imgs = nodesOfType(contentJson, 'image')
      expect(imgs).toHaveLength(1)
      expect(imgs[0].attrs?.src).toBe('https://cdn.example.com/pic.png')
    })

    it('preserves a cid image NODE but clears its unfetchable src (rewrite belongs to the attachment task)', () => {
      const { contentJson } = emailHtmlToContent('<p>see logo</p><img src="cid:logo.png" alt="logo">')
      const imgs = nodesOfType(contentJson, 'image')
      expect(imgs).toHaveLength(1)
      // cid: is not an http(s)/data scheme, so the tiptap sanitize clears it to ''.
      expect(imgs[0].attrs?.src).toBe('')
    })
  })

  describe('conservative when no marker is present', () => {
    it('keeps the whole body when there is no recognized quote marker', () => {
      const { text } = emailHtmlToContent(
        '<div>First paragraph of a fresh email.</div><div>Second paragraph, still mine.</div>'
      )
      expect(text).toContain('First paragraph of a fresh email.')
      expect(text).toContain('Second paragraph, still mine.')
    })
  })
})
