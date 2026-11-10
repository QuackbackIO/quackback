/**
 * The brand match's words about colour: names by hue, lightness and how
 * colourful a colour is (a dark muted purple is aubergine or plum, not pink
 * or purple), a second colour that is a shade of the first said as such, and
 * a dark site said to be dark.
 */
import { describe, expect, it } from 'vitest'
import type { ColourRoles } from '../../extract/roles'
import { brandReply, colourName, followUps } from '../brand-reply'

function roles(over: Partial<ColourRoles>): ColourRoles {
  return {
    identity: { value: '#0058a3', why: '', by: 'rule' },
    action: { value: { role: 'accent', hex: '#0058a3' }, why: '', by: 'rule' },
    buttons: 'accent',
    links: { value: { role: 'accent', hex: '#0058a3' }, why: '', by: 'rule' },
    highlight: { value: null, why: '', by: 'rule' },
    tint: { value: 'neutral', why: '', by: 'rule' },
    extras: [],
    logoColours: [],
    monochrome: false,
    signature: false,
    coverage: 0.02,
    intensity: 'medium',
    hero: { look: 'plain', role: null },
    ask: null,
    open: [],
    text: '#111111',
    page: '#ffffff',
    scheme: 'light',
    ...over,
  }
}

const reply = (r: ColourRoles) =>
  brandReply({
    shots: 1,
    roles: r,
    heading: null,
    band: 'none',
    failed: [],
    logo: 'placed',
    faceClose: true,
  })

describe('colour names', () => {
  it('names a dark, muted purple as aubergine or plum, and a vivid one as purple', () => {
    expect(colourName('#4d1b5f')).toBe('aubergine')
    expect(colourName('#5e2856')).toBe('plum')
    expect(colourName('#720294')).toBe('purple')
  })

  it('keeps the names people already read', () => {
    expect(colourName('#0058a3')).toBe('blue')
    expect(colourName('#111111')).toBe('black')
    expect(colourName('#ffffff')).toBe('white')
    expect(colourName('#ffdb00')).toBe('yellow')
    expect(colourName('#533afd')).toBe('indigo')
    expect(colourName('#9fe870')).toBe('lime')
    expect(colourName('#143402')).toBe('forest green')
    expect(colourName('#fb4f41')).toBe('red')
    expect(colourName('#091622')).toBe('navy')
  })

  it('tells light and muted colours apart', () => {
    expect(colourName('#c8b6f0')).toBe('lavender')
    expect(colourName('#f4a7c0')).toBe('pink')
    expect(colourName('#64748b')).toBe('slate')
  })
})

describe('the reply about colour', () => {
  it('never names one colour twice: a second colour of the same name is a shade of it', () => {
    const r = roles({
      identity: { value: '#4d1b5f', why: '', by: 'rule' },
      highlight: { value: '#2e0f39', why: '', by: 'rule' },
    })
    const said = reply(r).reply
    expect(said).toContain('aubergine as the brand colour')
    expect(said).toContain('a deeper aubergine as the second colour')
    expect(said).not.toMatch(/#/)
    const chips = followUps(r, 'none')
    expect(chips).toContain('Use more aubergine')
    expect(chips).toContain('Use more deeper aubergine')
  })

  it('names two different colours by their own names', () => {
    const said = reply(
      roles({
        identity: { value: '#720294', why: '', by: 'rule' },
        highlight: { value: '#4d1b5f', why: '', by: 'rule' },
      })
    ).reply
    expect(said).toContain('purple as the brand colour')
    expect(said).toContain('aubergine as the second colour')
  })

  it('says a dark site is matched with a dark portal', () => {
    const said = reply(
      roles({
        monochrome: true,
        scheme: 'dark',
        page: '#08090a',
        text: '#f7f8f8',
        identity: { value: '#e5e5e6', why: '', by: 'rule' },
      })
    ).reply
    expect(said).toMatch(/dark/)
  })

  it('names the app’s colour in the question about it', () => {
    const r = roles({
      monochrome: true,
      identity: { value: '#000000', why: '', by: 'rule' },
      ask: { kind: 'conflict', app: '#5e2856', message: '' },
    })
    expect(reply(r).asks).toEqual([
      'Your site is black and white, but your app uses plum. Use plum for links and the current menu item?',
    ])
    expect(followUps(r, 'none')).toContain('Use plum for links')
  })

  it('offers the site’s light buttons as white on a dark site', () => {
    const chips = followUps(
      roles({
        scheme: 'dark',
        page: '#121212',
        text: '#ffffff',
        identity: { value: '#1ed760', why: '', by: 'rule' },
        buttons: 'ink',
      }),
      'none'
    )
    expect(chips).toContain('White buttons')
    expect(chips).not.toContain('Black buttons')
  })
})

describe('what the reply says was left as is', () => {
  it('does not say the other pages’ titles were left, now that they follow Home’s hero', () => {
    const notes = reply(roles({})).notes
    const left = notes.find((note) => note.startsWith('Your screenshots do not show'))
    expect(left).toBeDefined()
    expect(left).not.toMatch(/titles/)
  })
})

describe('a headline font we do not have', () => {
  const notes = brandReply({
    shots: 1,
    roles: null,
    heading: null,
    band: 'none',
    failed: [],
    logo: 'placed',
    faceClose: false,
  }).notes

  it('says where fonts are uploaded: Theme, under the Brand kit’s fonts', () => {
    const note = notes.find((n) => n.includes('closest match'))
    expect(note).toContain('Theme > Brand kit > Fonts')
    expect(note).not.toMatch(/\bin Brand\.$/)
  })
})
