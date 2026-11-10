/**
 * Words that are theirs, not anyone's: a submit button names the company's people only by a
 * word their own words use (else no one), and Home's headline invites in their voice rather
 * than being their slogan with an invitation fitted round it.
 */
import { describe, expect, it } from 'vitest'
import { lineLint, type VoiceAnswer } from '../words-evidence'
import { WORDS_EXAMPLES } from '../words-examples'
import { wordsPrompt } from '../words-family'

const SITE = {
  headline: 'Money that moves',
  subtitle: 'Send it for less.',
  button: 'Get started',
}

const VOICE: VoiceAnswer = {
  evidence: 'Plain and friendly.',
  name: 'Fernway',
  known: 'not',
  signatures: [],
  home_language: 'none',
  formality: 'neutral',
  humour: 'warm',
  exclamations: 'sometimes',
  emoji: 'never',
  vocabulary: ['send', 'spend'],
  avoid: [],
}

describe('words of theirs', () => {
  it('refuses a button sent to "the team" or to a word for their people they never use', () => {
    // The finder read none of these on their pages, and the voice read gave none as theirs.
    for (const line of [
      'Post it to the team',
      'Ship it to the team',
      'Send Kudos to the team',
      'Send to the money team',
      'Send to the Fernway team',
      'Share it with the crew',
      'Pitch it to the builders',
      'Send to the roomfinders',
      'Send to Fernway HQ',
    ])
      expect(lineLint('submit', line, SITE, VOICE), line).toMatch(
        /stock button|never call themselves/
      )
    // A sending verb with no one named, them by name, or "us" names no one they never use.
    for (const line of [
      'Post it',
      'Share it',
      'Send it over',
      'Send it our way',
      'Post it to us',
      'Build it with us',
      'Post it to Fernway',
      'Pop it in the post',
    ])
      expect(lineLint('submit', line, SITE, VOICE), line).toBeNull()
    // Their own word for their people, where their pages or their vocabulary use it.
    const roasters = { ...SITE, seen: ['Meet the roasters'] }
    expect(lineLint('submit', 'Send to the roasters', roasters, VOICE)).toBeNull()
    expect(lineLint('submit', 'Send it to the roaster', roasters, VOICE)).toBeNull()
    expect(
      lineLint('submit', 'Send to the kitchen', SITE, {
        ...VOICE,
        vocabulary: ['kitchen', 'pasta'],
      })
    ).toBeNull()
    // "The team" only where their own pages call their people so.
    expect(
      lineLint('submit', 'Post it to the team', { ...SITE, seen: ['Meet the team'] }, VOICE)
    ).toBeNull()
    // Their customers' team, in their vocabulary, is not the company's.
    expect(
      lineLint('submit', 'Post it to the team', SITE, {
        ...VOICE,
        vocabulary: ['team', 'channels'],
      })
    ).toMatch(/never call themselves/)
    // English buttons only.
    expect(
      lineLint('submit', 'Envoie aux bâtisseurs', { ...SITE, language: 'French' }, VOICE)
    ).toBeNull()
  })

  it('refuses a Home headline that is their slogan with an invitation fitted round it', () => {
    const voice = { ...VOICE, signatures: ['Ride further', 'Lights on!', 'Hello, rider!'] }
    const site = { ...SITE, headline: 'Where riders and makers build together' }
    for (const text of [
      'Ride further. What should we make next?',
      'Ride further, and tell us where next',
      'Ride further with your ideas',
      'Where riders build together, what should we fix next?',
      'Riders and makers build together. Tell us how',
    ])
      expect(lineLint('home_headline', text, site, voice), text).toMatch(/their slogan/)
    // Their words inside an invitation that asks, or a greeting or call of theirs before it.
    for (const text of [
      'What would help you ride further?',
      'What should riders and makers build together next?',
      'Lights on! What should we fix?',
      'Hello, rider! What should we fix?',
      'Got an idea for your rides?',
      'Help us make riding simpler',
    ])
      expect(lineLint('home_headline', text, site, voice), text).toBeNull()
    // The feedback page is not held to it.
    expect(lineLint('feedback_headline', 'Ride further with your ideas', site, voice)).toBeNull()
  })
})

describe('the slogan mend', () => {
  it('asks plainly about what they do, keeping their slogan only where it makes plain sense', () => {
    const voice = { ...VOICE, signatures: ['Ride further'] }
    const problem = lineLint('home_headline', 'Ride further with your ideas', SITE, voice)
    expect(problem).toMatch(/ask plainly what would make their product or service better/)
    expect(problem).toMatch(/makes plain sense read literally/)
    expect(wordsPrompt(WORDS_EXAMPLES[0]!.evidence)).toMatch(
      /a slogan whose words make no plain sense/
    )
  })
})
