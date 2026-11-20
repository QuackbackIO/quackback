/**
 * Ask's local fast path: plain requests are answered without the model, so
 * they work with AI off or the allowance used up. Anything ambiguous falls
 * through (null) to the model.
 */
import { describe, expect, it } from 'vitest'
import { answerLocally, type AskDraftContext } from '../ask'

function ctx(overrides: Partial<AskDraftContext> = {}): AskDraftContext {
  return {
    themeMode: 'light',
    buttonShape: 'pill',
    corners: 0.5,
    font: 'inter',
    colours: {
      light: { main: '#2563eb', background: '#ffffff', text: '#0a0a0a' },
      dark: { main: '#2563eb', background: '#0a0a0a', text: '#fafafa' },
    },
    tabs: [
      { id: 'feedback', type: 'feedback', enabled: true },
      { id: 'roadmap', type: 'roadmap', enabled: true },
      { id: 'changelog', type: 'changelog', enabled: true },
      { id: 'link-1', type: 'link', label: 'Docs', enabled: true },
    ],
    welcomeMessage: '',
    helpCenter: null,
    ...overrides,
  }
}

const patchOf = (request: string, context = ctx()) => {
  const answer = answerLocally(request, context)
  if (answer?.outcome !== 'patch')
    throw new Error(`expected a patch, got ${JSON.stringify(answer)}`)
  return answer.patch
}

describe('answerLocally: colours', () => {
  it('"use #1a73e8" sets the main colour', () => {
    const answer = answerLocally('use #1a73e8', ctx())
    expect(answer).toMatchObject({
      outcome: 'patch',
      handled: 'local',
      patch: { colours: { light: { main: '#1a73e8' } } },
    })
  })

  it('expands short hex and lowercases it', () => {
    expect(patchOf('Use #1A7')).toEqual({ colours: { light: { main: '#11aa77' } } })
  })

  it('sets the background or text when the request names it', () => {
    expect(patchOf('make the background #f8f6f1')).toEqual({
      colours: { light: { background: '#f8f6f1' } },
    })
    expect(patchOf('set the text colour to #111827')).toEqual({
      colours: { light: { text: '#111827' } },
    })
  })

  it('targets the dark palette on a dark-only portal or when the request says dark', () => {
    expect(patchOf('use #8ab4f8', ctx({ themeMode: 'dark' }))).toEqual({
      colours: { dark: { main: '#8ab4f8' } },
    })
    expect(patchOf('use #8ab4f8 in dark mode')).toEqual({ colours: { dark: { main: '#8ab4f8' } } })
  })

  it('sets the header colour when the request names the header', () => {
    expect(patchOf('make the header #0b1f3a', ctx({ themeMode: 'light' }))).toEqual({
      colours: { light: { header: '#0b1f3a' } },
    })
    expect(patchOf('use #0b1f3a for the header in dark mode')).toEqual({
      colours: { dark: { header: '#0b1f3a' } },
    })
  })

  it('sets the header on both sides when visitors choose and no side is named', () => {
    // Nothing carries a header colour from light to dark, as the main colour is carried.
    expect(patchOf('make the header #0b1f3a', ctx({ themeMode: 'user' }))).toEqual({
      colours: { light: { header: '#0b1f3a' }, dark: { header: '#0b1f3a' } },
    })
  })

  it('may quote the hex the person typed in its reply', () => {
    expect(answerLocally('use #1a73e8', ctx())?.reply).toContain('#1a73e8')
  })

  it('leaves two colours, or a colour and something else, to the model', () => {
    expect(answerLocally('use #1a73e8 and #ffffff', ctx())).toBeNull()
    expect(answerLocally('use #1a73e8 and make buttons square', ctx())).toBeNull()
    expect(answerLocally('make the background and text #000000', ctx())).toBeNull()
  })
})

describe('answerLocally: stays out of what it cannot place', () => {
  it.each([
    'make the border #cccccc',
    'header background #000000',
    'make the button text #ffffff',
    'let visitors pick a font',
    'enable dark mode',
    'turn on dark mode',
  ])('leaves "%s" to the model', (request) => {
    expect(answerLocally(request, ctx())).toBeNull()
  })
})

describe('answerLocally: buttons and corners', () => {
  it('"make the buttons less rounded" turns pill buttons into ones that match the corners', () => {
    expect(patchOf('make the buttons less rounded')).toEqual({ buttonShape: 'corners' })
  })

  it('steps the corners down when buttons already match them', () => {
    expect(patchOf('make the buttons less rounded', ctx({ buttonShape: 'corners' }))).toEqual({
      corners: 0.25,
    })
  })

  it('says so when buttons are already square', () => {
    const answer = answerLocally(
      'make the buttons less rounded',
      ctx({ buttonShape: 'corners', corners: 0 })
    )
    expect(answer).toMatchObject({ outcome: 'refused', handled: 'local' })
  })

  it('makes buttons more rounded, ending at pill', () => {
    expect(patchOf('make the buttons more rounded', ctx({ buttonShape: 'corners' }))).toEqual({
      corners: 1,
    })
    expect(
      patchOf('make the buttons more rounded', ctx({ buttonShape: 'corners', corners: 1 }))
    ).toEqual({ buttonShape: 'pill' })
    expect(patchOf('pill buttons', ctx({ buttonShape: 'corners' }))).toEqual({
      buttonShape: 'pill',
    })
  })

  it('steps corners from an off-stop value to the next stop', () => {
    expect(patchOf('make the corners less rounded', ctx({ corners: 0.375 }))).toEqual({
      corners: 0.25,
    })
    expect(patchOf('rounder corners', ctx({ corners: 0.375 }))).toEqual({ corners: 0.5 })
  })

  it('takes square corners', () => {
    expect(patchOf('square corners')).toEqual({ corners: 0 })
  })
})

describe('answerLocally: tabs', () => {
  it('"put Roadmap first" moves Roadmap to the front', () => {
    const answer = answerLocally('put Roadmap first', ctx())
    expect(answer).toMatchObject({
      outcome: 'patch',
      patch: { tabs: { order: ['roadmap', 'feedback', 'changelog', 'link-1'] } },
    })
    expect(answer?.reply).toBe('Roadmap is first now.')
  })

  it('finds a tab by its own label, and moves one last', () => {
    expect(patchOf('move the Docs tab to the end', ctx())).toEqual({
      tabs: { order: ['feedback', 'roadmap', 'changelog', 'link-1'] },
    })
    expect(patchOf('move docs first')).toEqual({
      tabs: { order: ['link-1', 'feedback', 'roadmap', 'changelog'] },
    })
  })

  it('renames a tab, keeping the casing typed', () => {
    expect(patchOf('rename Feedback to Ideas & Requests')).toEqual({
      tabs: { changes: [{ id: 'feedback', label: 'Ideas & Requests' }] },
    })
    expect(patchOf('Rename the roadmap tab to "Plans"')).toEqual({
      tabs: { changes: [{ id: 'roadmap', label: 'Plans' }] },
    })
  })

  it('hides and shows tabs, but never Feedback', () => {
    expect(patchOf('hide the changelog')).toEqual({
      tabs: { changes: [{ id: 'changelog', enabled: false }] },
    })
    expect(patchOf('show changelog')).toEqual({
      tabs: { changes: [{ id: 'changelog', enabled: true }] },
    })
    expect(answerLocally('hide feedback', ctx())).toMatchObject({ outcome: 'refused' })
  })

  it('leaves a name it does not know to the model', () => {
    expect(answerLocally('put Pricing first', ctx())).toBeNull()
    expect(answerLocally('hide the welcome message', ctx())).toBeNull()
  })
})

describe('answerLocally: theme mode, undo, fonts and websites', () => {
  it('"add a dark mode too" lets visitors choose', () => {
    const answer = answerLocally('add a dark mode too', ctx())
    expect(answer).toMatchObject({ outcome: 'patch', patch: { themeMode: 'user' } })
    expect(answer?.reply).toBe('Visitors can now choose light or dark.')
    expect(patchOf('Let visitors choose light or dark')).toEqual({ themeMode: 'user' })
    expect(patchOf('dark mode only')).toEqual({ themeMode: 'dark' })
  })

  it('"undo" asks the editor to step back, with no patch', () => {
    for (const request of ['undo', 'Undo that.', 'undo the last change']) {
      expect(answerLocally(request, ctx())).toEqual({
        outcome: 'undo',
        handled: 'local',
        reply: 'Undone.',
      })
    }
  })

  it('switches to a listed font by name', () => {
    expect(patchOf('use Lora')).toEqual({ font: 'lora' })
    expect(patchOf('change the font to Plus Jakarta Sans')).toEqual({ font: 'jakarta' })
  })

  it('runs Import for a website', () => {
    expect(answerLocally('match stripe.com', ctx())).toMatchObject({
      outcome: 'import',
      host: 'stripe.com',
    })
    expect(answerLocally('https://www.linear.app/', ctx())).toMatchObject({
      outcome: 'import',
      host: 'linear.app',
    })
  })

  it('leaves open requests to the model', () => {
    for (const request of [
      'make it feel warmer',
      'something more playful',
      'use our brand blue',
      'make it dark',
    ]) {
      expect(answerLocally(request, ctx()), request).toBeNull()
    }
  })
})
