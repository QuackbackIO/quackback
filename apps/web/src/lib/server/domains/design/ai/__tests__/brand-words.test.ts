/**
 * The portal's words as a step of their own: the evidence from every word
 * the finder read, the lints a set must pass, the choice among the writers'
 * sets (held to rules over the critic's word) and the step's calls.
 */
import { describe, expect, it } from 'vitest'
import type { FamilyRequest } from '../brand-brief'
import {
  BUTTON_RULE,
  lineLint,
  nameAsWritten,
  voiceLines,
  voiceSchema,
  WORD_LINES,
  WORDS_LIMITS,
  wordsEvidenceFrom,
  wordsEvidenceLines,
  wordsLints,
  wordsSchema,
  type VoiceAnswer,
  type WordsAnswer,
  unclearButton,
} from '../words-evidence'
import { WORDS_EXAMPLES, WRITING_ANGLES } from '../words-examples'
import { voicePrompt, wordsPrompt } from '../words-family'
import {
  pickWords,
  writeWords,
  wordsPickPrompt,
  type WordsCandidate,
  type WordsPick,
} from '../words-pick'

const read = (over: Partial<Record<string, string>> = {}) => ({
  headline_text: '',
  subtitle_text: '',
  logo_text: '',
  primary_button_text: '',
  section_heading_text: '',
  ...over,
})

const SITE = {
  headline: 'Money that moves',
  subtitle: 'Send it for less.',
  button: 'Get started',
}

/** An English site, for the button test. */
const EN = { language: null }

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

const set = (over: Partial<WordsAnswer> = {}): WordsAnswer => ({
  evidence: 'plain',
  home_layout: 'portal',
  home_headline: 'Help us make sending simpler',
  home_subtitle: 'Share ideas, see what is coming and find help.',
  feedback_headline: 'Your ideas',
  feedback_subtitle: 'Tell us what would help, and vote for the ideas you like.',
  prompt: 'What would make sending easier?',
  submit: 'Send it over',
  ...over,
})

const review = (s: 'a' | 'b' | 'c', plain_sense: number, voice = 3, delight = 3) => ({
  set: s,
  problems: [],
  plain_sense,
  voice,
  delight,
})

describe('words evidence', () => {
  it('gathers every word read on every screenshot, the main one’s headline, subtitle and button apart', () => {
    const ev = wordsEvidenceFrom({
      name: 'Acme',
      main: read({
        headline_text: ' Ship it ',
        subtitle_text: 'Fast.',
        logo_text: 'ACME',
        primary_button_text: 'Go',
        section_heading_text: 'Built for  teams',
      }),
      others: [
        read({ headline_text: 'Hej! Welcome back', logo_text: 'acme', primary_button_text: 'go' }),
        read({ section_heading_text: 'built for teams', subtitle_text: 'Hej! welcome back' }),
      ],
      pages: ['feedback'],
      language: null,
    })
    expect(ev).toMatchObject({ headline: 'Ship it', subtitle: 'Fast.', button: 'Go' })
    // Each word once, in the order read; the main lines are not repeated.
    expect(ev.seen).toEqual(['ACME', 'Built for teams', 'Hej! Welcome back'])
    expect(wordsEvidenceLines(ev)).toContain(
      'Other words on their pages: "ACME"; "Built for teams"; "Hej! Welcome back".'
    )
  })

  it('says when nothing else was read, and names the language only when it is not English', () => {
    const ev = wordsEvidenceFrom({
      name: null,
      main: read(),
      others: [],
      pages: ['help'],
      language: null,
    })
    const lines = wordsEvidenceLines(ev)
    expect(lines).toContain('Their headline: none read.')
    expect(lines.join(' ')).not.toMatch(/Other words|Write every word/)
    expect(wordsEvidenceLines({ ...ev, language: 'Swedish' })).toContain(
      'Write every word in Swedish.'
    )
  })

  it('takes a voice read longer than asked, as a strict answer is not held to lengths, and shows only the first few', () => {
    const long = { ...VOICE, vocabulary: Array.from({ length: 12 }, (_, i) => `w${i}`) }
    expect(voiceSchema.parse(long)).toEqual(long)
    expect(voiceLines(long).join(' ')).toContain('w7.')
    expect(voiceLines(long).join(' ')).not.toContain('w8')
  })

  it('writes a voice read as lines, leaving out what it does not have', () => {
    const lines = voiceLines({ ...VOICE, signatures: ['Hej!'], home_language: 'Swedish' })
    expect(lines).toContain('Their signature words: "Hej!".')
    expect(lines).toContain('A home language they use as flavour: Swedish.')
    const none = voiceLines(VOICE).join(' ')
    expect(none).toContain('Their signature words: none known.')
    expect(none).not.toMatch(/home language|Avoid/)
  })
})

describe('words lints', () => {
  it('holds each line to its length, marks taken off', () => {
    expect(lineLint('submit', 'x'.repeat(WORDS_LIMITS.submit), SITE, VOICE)).toBeNull()
    expect(lineLint('submit', 'x'.repeat(WORDS_LIMITS.submit + 1), SITE, VOICE)).toMatch(/longer/)
    expect(lineLint('home_headline', '', SITE, VOICE)).toBe('empty')
  })

  it('refuses a dash, all capitals, the site’s own sales lines, and emoji from a brand that uses none', () => {
    expect(lineLint('home_headline', 'Ideas \u2014 and help', SITE, VOICE)).toBe('a dash')
    expect(lineLint('home_headline', 'YOUR IDEAS HERE', SITE, VOICE)).toBe('all capitals')
    expect(lineLint('home_headline', 'money that moves!', SITE, VOICE)).toMatch(/sales line/)
    expect(lineLint('submit', 'Get started', SITE, VOICE)).toMatch(/sales line/)
    expect(lineLint('home_headline', 'Hello 👋', SITE, VOICE)).toMatch(/emoji/)
    expect(lineLint('home_headline', 'Hello 👋', SITE, { emoji: 'sometimes', name: '' })).toBeNull()
    // A greeting with its own punctuation, and a script without capitals, pass.
    expect(lineLint('home_headline', 'Hej! Tell us what you need', SITE, VOICE)).toBeNull()
    expect(lineLint('home_headline', 'ご意見をお聞かせください', SITE, VOICE)).toBeNull()
    expect(lineLint('submit', 'OK', SITE, null)).toBe('all capitals')
  })

  it('refuses the site’s sales line reused with words tacked on', () => {
    const site = { ...SITE, headline: 'Money for every trip, every border and every home' }
    expect(
      lineLint(
        'home_headline',
        'Money for every trip, every border and every home, Fernway',
        site,
        VOICE
      )
    ).toMatch(/tacked on/)
    // A short line of theirs may be echoed.
    expect(lineLint('home_headline', 'Ideas for money that moves', SITE, VOICE) ?? '').not.toMatch(
      /sales line/
    )
  })

  it('refuses the site’s button in a headline, not in the composer', () => {
    expect(lineLint('home_headline', 'Get started with Fernway support', SITE, VOICE)).toMatch(
      /button, in a headline/
    )
    expect(lineLint('feedback_headline', 'Get started: what should we fix?', SITE, VOICE)).toMatch(
      /button/
    )
    expect(lineLint('submit', 'Get started', SITE, VOICE)).toMatch(/sales line/)
    expect(lineLint('prompt', 'Get started with an idea', SITE, VOICE)).toBeNull()
  })

  it('refuses dates, numbers and time limits, but not a number in their name', () => {
    expect(
      lineLint('home_headline', 'Fernway is sunsetting, here is what is next', SITE, VOICE)
    ).toMatch(/date/)
    expect(lineLint('prompt', 'Your feedback before December 22', SITE, VOICE)).toMatch(/date/)
    expect(lineLint('home_headline', 'Go from 0 to what is next', SITE, VOICE)).toMatch(/number/)
    expect(
      lineLint('home_headline', 'Shape what 1Vault builds', SITE, { ...VOICE, name: '1Vault' })
    ).toBeNull()
  })

  it('refuses promises and claims about how they work', () => {
    for (const line of [
      'Welcome to Fernway, we put you first',
      'Fernway, shaped by the people who use it',
      'Built with your ideas',
      'We read every suggestion',
    ])
      expect(lineLint('home_headline', line, SITE, VOICE), line).toMatch(/promise/)
    expect(lineLint('home_headline', 'Help shape what Fernway builds', SITE, VOICE)).toBeNull()
  })

  it('refuses a greeting to the brand, not the customer', () => {
    expect(lineLint('home_headline', 'Hello Fernway. What should we build?', SITE, VOICE)).toMatch(
      /greeting to the brand/
    )
    expect(lineLint('home_headline', 'Hello, Fernway team', SITE, VOICE)).toMatch(/greeting/)
    expect(lineLint('home_headline', 'Hello from Fernway', SITE, VOICE)).toBeNull()
    expect(lineLint('home_headline', 'Hi from the Fernway team', SITE, VOICE)).toBeNull()
  })

  it('reads a lower-case name as the logo’s styling unless their sentences write it so', () => {
    expect(nameAsWritten('coralbank', { headline: 'Spend less time on money', subtitle: '' })).toBe(
      'Coralbank'
    )
    expect(nameAsWritten('acme', { headline: 'Why teams pick acme', subtitle: '' })).toBe('acme')
    expect(nameAsWritten('HEMLA', { headline: '', subtitle: '' })).toBe('HEMLA')
    expect(nameAsWritten('Fernway', { headline: '', subtitle: '' })).toBe('Fernway')
  })

  it('holds the company’s name to the way they write it', () => {
    expect(lineLint('home_headline', 'Help us make fernway better', SITE, VOICE)).toMatch(
      /their name/
    )
    expect(lineLint('home_headline', 'Help us make FERNWAY better', SITE, VOICE)).toMatch(
      /their name/
    )
    expect(lineLint('home_headline', 'Help us make Fernway simpler', SITE, VOICE)).toBeNull()
    // A word that only contains the name is not the name.
    expect(lineLint('home_headline', 'Unfernwayed, tell us', SITE, VOICE)).toBeNull()
    expect(
      lineLint('home_headline', 'Help us make fernway better', SITE, { ...VOICE, name: '' })
    ).toBeNull()
  })

  it('refuses a headline that joins two thoughts, unless the first is a short greeting', () => {
    const voice = { emoji: 'never' as const, name: 'Lumen', signatures: ['Lights on!'] }
    expect(lineLint('home_headline', 'Glow on. What should we make next?', SITE, voice)).toMatch(
      /two thoughts/
    )
    expect(
      lineLint('home_headline', 'Where to next, night owl? Tell us what to improve', SITE, voice)
    ).toMatch(/two thoughts/)
    expect(
      lineLint('home_headline', 'Hello, you. What should we make next?', SITE, voice)
    ).toBeNull()
    expect(lineLint('home_headline', 'Hej! Pull up a chair', SITE, voice)).not.toMatch(
      /two thoughts/
    )
    expect(lineLint('home_headline', 'Lights on! What should we make?', SITE, voice)).toBeNull()
    // A short call and answer is one beat; a name with a dot in it is one sentence.
    expect(lineLint('home_headline', 'Got a lamp? Tell us!', SITE, voice)).toBeNull()
    expect(lineLint('home_headline', 'What should Lumen.io make next?', SITE, voice)).toBeNull()
    expect(lineLint('home_subtitle', 'See what is coming. Share an idea.', SITE, voice)).toBeNull()
  })

  it('refuses a headline that opens with a welcome, a preamble that says nothing of them', () => {
    for (const line of [
      'Welcome to Lumen',
      'Welcome back, we are glad you are here',
      'Hello, and welcome to the Lumen space',
    ])
      expect(lineLint('home_headline', line, SITE, VOICE), line).toMatch(/welcome/)
    expect(lineLint('home_subtitle', 'Welcome! Share an idea.', SITE, VOICE)).toBeNull()
  })

  it('refuses a question in a headline without its question mark', () => {
    expect(lineLint('feedback_headline', 'What should Lumen build next', SITE, VOICE)).toMatch(
      /question mark/
    )
    expect(lineLint('feedback_headline', 'Should we make it brighter', SITE, VOICE)).toMatch(
      /question mark/
    )
    expect(lineLint('feedback_headline', 'What should Lumen build next?', SITE, VOICE)).toBeNull()
    expect(lineLint('feedback_headline', 'Where Lumen is heading next', SITE, VOICE)).toBeNull()
  })

  it('refuses a feedback headline that repeats Home’s', () => {
    expect(
      wordsLints(
        set({
          home_headline: 'What should we light up?',
          feedback_headline: 'What should we light up?',
        }),
        SITE,
        VOICE
      )
    ).toEqual([{ line: 'feedback_headline', problem: 'the same as Home’s headline' }])
  })

  it('refuses a home headline any company could use with only their name in it', () => {
    for (const line of [
      'What should Fernway build next?',
      'What should we build next?',
      'Tell Fernway what to build next',
      'Tell us what Fernway should build next',
      'Help us make Fernway better',
      'Help us build what comes next',
      "What's next for Fernway?",
    ])
      expect(lineLint('home_headline', line, SITE, VOICE), line).toMatch(/any company/)
    // Their own verb, their words, or a greeting of theirs before the question make it theirs.
    for (const line of [
      'What should Fernway send next?',
      'Help us make sending simpler',
      'Hello, you. What should we make next?',
      'Help shape what Fernway builds',
    ])
      expect(lineLint('home_headline', line, SITE, VOICE), line).toBeNull()
    // The feedback page may ask its plain question.
    expect(lineLint('feedback_headline', 'What should Fernway build next?', SITE, VOICE)).toBeNull()
  })

  it('refuses a headline or subtitle that offers their own service, as if the portal were the product', () => {
    for (const [line, text] of [
      ['home_headline', 'Hello, what can we help you send?'],
      ['home_headline', 'What can we help you book today?'],
      ['home_headline', 'Where would you like to go?'],
      ['home_headline', 'What will you build on Fernway?'],
      ['home_headline', 'Tell us what you want delivered'],
      ['home_headline', 'Fernway, here to help you send and spend'],
      ['home_subtitle', 'We help you send money abroad, and you can share ideas too.'],
      ['feedback_headline', 'Where would you like to go next?'],
      ['feedback_subtitle', 'What would you like to send today? Share an idea.'],
    ] as const)
      expect(lineLint(line, text, SITE, VOICE), text).toMatch(/offers their own service/)
    // Feedback about their service, or help with it, is the portal's own.
    for (const [line, text] of [
      ['home_headline', 'What should Fernway send next?'],
      ['home_headline', 'What would you like us to build?'],
      ['home_headline', 'What should we help you send next?'],
      ['home_headline', 'What would help you ride further?'],
      ['home_headline', 'Get help with your transfers'],
      ['home_subtitle', 'Tell us what would help you send more, and vote for the ideas you like.'],
      ['home_subtitle', 'Share an idea or get help with your transfers.'],
      ['home_subtitle', 'Vote on what you need and see what is coming.'],
      ['home_subtitle', 'Suggest what you need in your transfers, and vote.'],
      ['feedback_headline', 'What would you like to see next?'],
      ['feedback_subtitle', 'Tell us what you want us to fix, and vote for the ideas you like.'],
    ] as const)
      expect(lineLint(line, text, SITE, VOICE), text).toBeNull()
  })

  it('refuses a Home headline or subtitle that invites nothing: a tagline about the product', () => {
    for (const [line, text] of [
      ['home_headline', 'Ship software peacefully, with Fernway'],
      ['home_headline', 'Secure access, for people and agents'],
      ['home_headline', "Hello there, what's on your list?"],
      ['home_headline', 'Ship your next idea peacefully'],
      ['home_headline', 'Make your next idea real'],
      ['home_headline', 'One idea is worth a thousand words'],
      ['home_headline', 'Bring your next idea to life with Fernway'],
      ['home_headline', 'Define what is next for Fernway'],
      ['home_subtitle', 'Fresh transfers at your door, every other week.'],
      ['home_subtitle', 'Search for answers on payments, or send us a question.'],
    ] as const)
      expect(lineLint(line, text, SITE, VOICE), text).toMatch(/invites nothing/)
    // A greeting of theirs alone may lead, with the subtitle doing the inviting.
    for (const [line, text] of [
      ['home_headline', 'Hello, pen pal!'],
      ['home_headline', 'Hej!'],
      ['home_headline', 'Help us make sending simpler'],
      ['home_headline', 'Where teams build, Fernway listens'],
      ['home_headline', 'Got an idea for your transfers?'],
      ['home_headline', 'What would make sending easier?'],
      ['home_headline', 'Got an idea for us?'],
      ['home_headline', 'Bring your ideas to Fernway'],
      ['home_headline', 'Post us your ideas'],
      ['home_headline', 'Which transfer should we add next?'],
      ['home_headline', 'What is on your mind, Fernway friend?'],
      ['home_subtitle', 'Search answers, ask a question or suggest a feature.'],
      ['home_subtitle', 'What would make your pasta nights better?'],
    ] as const)
      expect(lineLint(line, text, SITE, VOICE), text).toBeNull()
    // The feedback page's lines are held to the service rule only.
    expect(lineLint('feedback_headline', 'Fernway, for every transfer', SITE, VOICE)).toBeNull()
  })

  it('tells the writers and the critic that Home invites feedback first, help second, never the service', () => {
    const prompt = wordsPrompt(WORDS_EXAMPLES[0]!.evidence)
    expect(prompt).toMatch(/what to improve or make next/)
    expect(prompt).toMatch(/What can we help you send/)
    // Their slogan's words, inside the invitation.
    expect(prompt).toMatch(/What would help you ride further\?/)
    expect(prompt).not.toMatch(/"Tell us what to build next", "Help us improve"\) says nothing/)
    // Feedback-first words are no reason to move Home about.
    expect(prompt).toMatch(/no reason to choose feedback_first/)
    expect(wordsPickPrompt(WORDS_EXAMPLES[0]!.evidence, null, [set()])).toMatch(
      /offers their own service/
    )
    // Never their slogan with an invitation fitted round it, for the writers and the critic.
    expect(prompt).toMatch(/never their slogan or catchphrase with an invitation fitted round it/)
    expect(wordsPickPrompt(WORDS_EXAMPLES[0]!.evidence, null, [set()])).toMatch(
      /catchphrase with an invitation fitted round it/
    )
  })

  it('refuses a composer prompt that names nothing of theirs', () => {
    for (const line of [
      'A feature or a fix',
      'Suggest a feature',
      'Suggest a feature or a fix',
      'Describe your idea',
      'What would help your team?',
      'An idea or improvement you need',
    ])
      expect(lineLint('prompt', line, SITE, VOICE), line).toMatch(/names nothing of theirs/)
    for (const line of ['A transfer or a card idea', 'What would make sending easier?'])
      expect(lineLint('prompt', line, SITE, VOICE), line).toBeNull()
  })

  it('refuses a stock button, bare or with only their name on it', () => {
    for (const line of [
      'Send idea',
      'Submit',
      'Send feedback',
      'Send to Fernway',
      'Send it to Fernway',
      'Send to the Fernway team',
      'Send to the team',
    ])
      expect(lineLint('submit', line, SITE, VOICE), line).toMatch(/stock button/)
    for (const line of ['Send it over', 'Send to the roasters', 'Post it', 'Send the tip'])
      expect(
        lineLint('submit', line, { ...SITE, seen: ['Meet the roasters'] }, VOICE),
        line
      ).toBeNull()
  })

  it('finds a button a customer must guess at: sent to their customers, or a verb that does not send', () => {
    for (const line of [
      'Take it to the drivers',
      'Send it to the hosts',
      'Pass it to the readers',
      'Post it for the creators',
      'Send it to the community',
      'Send to the hosts',
      'Send to the meditators',
      'Pitch it to the schedulers',
      'Post it for the patrons',
    ])
      expect(unclearButton(line, EN), line).toMatch(/to their customers/)
    for (const line of [
      'Hang out with us',
      'Give it kudos',
      'Bring it to life',
      'Put it to work',
      "Let's get to work",
      'Take it on the road',
      'Take it for a spin',
      'Shake it up',
    ])
      expect(unclearButton(line, EN), line).toMatch(/something other than send/)
    for (const line of [
      'Get it built',
      'Open the issue',
      'Deploy the idea',
      'Send it to the inbox',
      'Send it to the vault',
      'Put it in the vault',
      'Send it to the team',
      'Send to the studio',
      'Send it to the newsroom',
      'Send it to Fernway',
      'Zap it over',
      'Push it',
      'Post it',
    ])
      expect(unclearButton(line, EN), line).toBeNull()
    expect(unclearButton('Hang out with us', { language: 'French' })).toBeNull()
  })

  it('leaves the r14 lints as they were for buttons', () => {
    for (const line of ['Take it to the drivers', 'Hang out with us', 'Put it to work'])
      expect(lineLint('submit', line, SITE, VOICE), line).toBeNull()
  })

  it('lists every line’s problem in order', () => {
    expect(
      wordsLints(set({ submit: 'Send your idea to the whole team now' }), SITE, VOICE)
    ).toEqual([{ line: 'submit', problem: 'longer than 24 characters' }])
  })
})

describe('words examples', () => {
  it('are valid answers that pass every lint, for every angle, with a valid voice read', () => {
    for (const e of WORDS_EXAMPLES) {
      expect(voiceSchema.parse(e.voice)).toEqual(e.voice)
      for (const angle of WRITING_ANGLES) {
        const answer = e.answers[angle]
        expect(wordsSchema.parse(answer)).toEqual(answer)
        expect(wordsLints(answer, e.evidence, e.voice), `${e.brand} ${angle}`).toEqual([])
      }
    }
  })

  it('give every button a voice of its own, never a bare one', () => {
    for (const e of WORDS_EXAMPLES)
      for (const angle of WRITING_ANGLES)
        expect(e.answers[angle].submit, `${e.brand} ${angle}`).not.toMatch(
          /^(submit|send)( (idea|feedback))?$/i
        )
    expect(wordsPrompt(WORDS_EXAMPLES[0]!.evidence)).toMatch(/never a bare "Submit"/)
    expect(wordsPrompt(WORDS_EXAMPLES[0]!.evidence)).toMatch(/not just their name/)
    // The button sends to the company's own people, with a verb that sends.
    expect(wordsPrompt(WORDS_EXAMPLES[0]!.evidence)).toMatch(/company's own people/)
    expect(wordsPrompt(WORDS_EXAMPLES[0]!.evidence)).toMatch(/never to their customers/)
    expect(wordsPrompt(WORDS_EXAMPLES[0]!.evidence)).not.toMatch(/the people who read it/)
    // Their own people only by a word of theirs, else no one named: never "the team" by default.
    expect(wordsPrompt(WORDS_EXAMPLES[0]!.evidence)).toMatch(
      /only by a word for them that their words above use/
    )
    expect(wordsPrompt(WORDS_EXAMPLES[0]!.evidence)).toMatch(/it names no one/)
    expect(wordsPrompt(WORDS_EXAMPLES[0]!.evidence)).toMatch(/Never "the team"/)
    expect(wordsPrompt(WORDS_EXAMPLES[0]!.evidence)).not.toMatch(/when they have none, "the team"/)
    expect(BUTTON_RULE).toMatch(/names no one/)
    expect(BUTTON_RULE).not.toMatch(/their team or a place of theirs/)
    expect(wordsPickPrompt(WORDS_EXAMPLES[0]!.evidence, null, [set()])).toMatch(
      /button sent to "the team"/
    )
    expect(wordsPrompt(WORDS_EXAMPLES[0]!.evidence)).not.toMatch(/the makers/)
    for (const e of WORDS_EXAMPLES)
      for (const angle of WRITING_ANGLES)
        expect(unclearButton(e.answers[angle].submit, EN), `${e.brand} ${angle}`).toBeNull()
  })

  it('show a signature touch: a greeting or signature word leads some home headline', () => {
    const signed = WORDS_EXAMPLES.filter((e) =>
      e.voice.signatures.some((s) =>
        e.answers.signature.home_headline.includes(s.replace(/!$/, ''))
      )
    )
    expect(signed.length).toBeGreaterThanOrEqual(2)
  })

  it('are shown in each prompt as any brand’s evidence and voice are', () => {
    const ev = WORDS_EXAMPLES[0]!.evidence
    for (const angle of WRITING_ANGLES) {
      const prompt = wordsPrompt(ev, VOICE, angle)
      for (const e of WORDS_EXAMPLES) {
        for (const line of [...wordsEvidenceLines(e.evidence), ...voiceLines(e.voice)])
          expect(prompt).toContain(line)
        expect(prompt).toContain(JSON.stringify(e.answers[angle]))
      }
    }
    const voice = voicePrompt(ev)
    for (const e of WORDS_EXAMPLES) expect(voice).toContain(JSON.stringify(e.voice))
  })

  it('name every limit in the writers’ prompt as the lints hold it', () => {
    const prompt = wordsPrompt(WORDS_EXAMPLES[0]!.evidence)
    for (const line of WORD_LINES)
      expect(prompt).toContain(`${line} (under ${WORDS_LIMITS[line]} characters)`)
  })

  it('hold the composer’s prompt to what a phone’s input shows, and say why', () => {
    expect(WORDS_LIMITS.prompt).toBeLessThanOrEqual(32)
    expect(lineLint('prompt', 'Suggest a feature, a tool or a better way', SITE, VOICE)).toMatch(
      /longer/
    )
    expect(wordsPrompt(WORDS_EXAMPLES[0]!.evidence)).toMatch(/fit a phone/)
  })
})

describe('pickWords', () => {
  const cands: WordsCandidate[] = [
    { angle: 'signature', answer: set({ home_headline: 'Hej! Tell us what you need' }) },
    { angle: 'plain', answer: set() },
    {
      angle: 'playful',
      answer: set({ home_headline: 'Your feedback saves us all', submit: 'Go!' }),
    },
  ]
  const pick = (over: Partial<WordsPick>): WordsPick => ({
    reviews: [review('a', 5, 5, 4), review('b', 5, 3, 2), review('c', 2, 4, 5)],
    choice: 'a',
    swaps: [],
    why: '',
    ...over,
  })

  it('takes the critic’s choice when it makes plain sense', () => {
    expect(pickWords(cands, pick({}), SITE, VOICE)?.angle).toBe('signature')
  })

  it('passes over a choice short of plain sense for the best of the rest', () => {
    expect(pickWords(cands, pick({ choice: 'c' }), SITE, VOICE)?.angle).toBe('signature')
  })

  it('passes over a generic choice as surely as an odd one', () => {
    const generic = pick({
      reviews: [review('a', 4, 4, 3), review('b', 5, 2, 2), review('c', 2, 5, 5)],
      choice: 'b',
    })
    expect(pickWords(cands, generic, SITE, VOICE)?.angle).toBe('signature')
  })

  it('mends a set’s failing line from another set, keeping the rest of its voice', () => {
    const linted = [
      { ...cands[0]!, answer: set({ home_headline: 'HEJ!', submit: 'Post it to Fernway' }) },
      cands[1]!,
      cands[2]!,
    ]
    const out = pickWords(linted, pick({}), SITE, VOICE)
    expect(out?.angle).toBe('signature')
    expect(out?.answer.home_headline).toBe('Help us make sending simpler')
    expect(out?.answer.submit).toBe('Post it to Fernway')
  })

  it('passes over a set whose failing line no sensible set writes well while another has none', () => {
    const linted = [
      { ...cands[0]!, answer: set({ prompt: 'Ideas before December 1' }) },
      cands[1]!,
      { ...cands[2]!, answer: set({ prompt: 'Ideas by May 2' }) },
    ]
    // The only good prompt is the plain set's, short of plain sense: it gives no lines.
    const reviews = [review('a', 5, 5, 4), review('b', 3, 3, 2), review('c', 4, 4, 5)]
    expect(pickWords(linted, pick({ reviews }), SITE, VOICE)?.angle).toBe('plain')
    // Once it makes plain sense, the critic's choice is mended from it.
    const out = pickWords(linted, pick({}), SITE, VOICE)
    expect(out?.angle).toBe('signature')
    expect(out?.answer.prompt).toBe('What would make sending easier?')
  })

  it('without a critic, takes the brand’s signature, clean', () => {
    expect(pickWords(cands, null, SITE, VOICE)?.angle).toBe('signature')
    const linted = [{ ...cands[0]!, answer: set({ prompt: 'Ideas by May 2' }) }, cands[1]!]
    expect(pickWords(linted, null, SITE, VOICE)?.angle).toBe('signature')
    expect(pickWords([cands[2]!], null, SITE, VOICE)?.angle).toBe('playful')
    expect(pickWords([], null, SITE, VOICE)).toBeNull()
  })

  it('swaps in a line from a sensible set, once a line, never one that fails a lint', () => {
    const out = pickWords(
      cands,
      pick({
        swaps: [
          { line: 'submit', from: 'b' },
          { line: 'submit', from: 'c' },
          { line: 'home_headline', from: 'c' },
        ],
      }),
      SITE,
      VOICE
    )
    expect(out?.answer.home_headline).toBe('Hej! Tell us what you need')
    expect(out?.swapped).toEqual([{ line: 'submit', from: 'plain' }])
    const long = [cands[0]!, { ...cands[1]!, answer: set({ submit: 'x'.repeat(30) }) }]
    expect(
      pickWords(long, pick({ swaps: [{ line: 'submit', from: 'b' }] }), SITE, VOICE)?.swapped
    ).toEqual([])
  })

  it('arranges Home as the writers chose only when they all agree, else the default', () => {
    const laid = (layouts: Array<WordsAnswer['home_layout']>) =>
      layouts.map((home_layout, i) => ({
        ...cands[i]!,
        answer: { ...cands[i]!.answer, home_layout },
      }))
    const layoutOf = (layouts: Array<WordsAnswer['home_layout']>) =>
      pickWords(laid(layouts), pick({}), SITE, VOICE)?.answer.home_layout
    expect(layoutOf(['help_first', 'help_first', 'help_first'])).toBe('help_first')
    expect(layoutOf(['help_first', 'help_first', 'portal'])).toBe('portal')
    expect(layoutOf(['roadmap_first', 'help_first'])).toBe('portal')
    // One writer alone is not agreement.
    expect(layoutOf(['help_first'])).toBe('portal')
  })

  it('mends a chosen set’s failing line from another sensible set', () => {
    const copied = [
      { ...cands[0]!, answer: set({ home_headline: 'Money that moves' }) },
      cands[1]!,
      cands[2]!,
    ]
    // Every set fails somewhere, so the critic's choice stands and its weak line is mended.
    copied[1] = { ...cands[1]!, answer: set({ submit: 'x'.repeat(30) }) }
    copied[2] = { ...cands[2]!, answer: set({ prompt: 'Ideas before December 1' }) }
    const out = pickWords(copied, pick({}), SITE, VOICE)
    expect(out?.angle).toBe('signature')
    expect(out?.answer.home_headline).toBe('Help us make sending simpler')
    expect(out?.swapped).toContainEqual({ line: 'home_headline', from: 'plain' })
  })

  it('writes the company’s name as they write it in every set before choosing', () => {
    const named = [
      {
        angle: 'plain' as const,
        answer: set({ feedback_headline: 'What should fernway do next?' }),
      },
    ]
    expect(pickWords(named, null, SITE, VOICE)?.answer.feedback_headline).toBe(
      'What should Fernway do next?'
    )
  })

  it('shows the critic every set by letter, with the brand’s voice', () => {
    const prompt = wordsPickPrompt(
      { ...SITE, name: 'Acme', seen: [], pages: ['feedback'], language: null },
      VOICE,
      cands.map((c) => c.answer)
    )
    expect(prompt).toContain('Set a: {"home_headline":"Hej! Tell us what you need"')
    expect(prompt).toContain('Set c:')
    expect(prompt).toContain('Their voice: Plain and friendly.')
  })
})

describe('writeWords', () => {
  const EV = { ...SITE, name: 'Acme', seen: [], pages: ['feedback'], language: null }

  it('writes every angle at once, then asks the critic', async () => {
    const order: string[] = []
    let open = 0
    let most = 0
    const call = async <T>(request: FamilyRequest<T>): Promise<T> => {
      order.push(request.family)
      open++
      most = Math.max(most, open)
      await new Promise((done) => setTimeout(done, 5))
      open--
      if (request.family === 'words_pick')
        return { reviews: [review('a', 5, 5, 5)], choice: 'a', swaps: [], why: '' } as T
      return set({
        home_headline: request.prompt.includes('their signature') ? 'Hej! Hello' : 'Hi',
      }) as T
    }
    const out = await writeWords({ ev: EV, voice: VOICE, call, ms: 10_000 })
    expect(order).toEqual(['words', 'words', 'words', 'layout', 'layout', 'layout', 'words_pick'])
    // The writers and Home's arrangement at once.
    expect(most).toBe(6)
    expect(out?.angle).toBe('signature')
    expect(out?.answer.home_headline).toBe('Hej! Hello')
  })

  it('leaves out a writer that fails, and without the critic takes the next angle', async () => {
    let n = 0
    const call = async <T>(request: FamilyRequest<T>): Promise<T> => {
      if (request.family === 'words_pick') throw new Error('model down')
      if (n++ === 0) throw new Error('Failed to parse structured output as JSON')
      return set() as T
    }
    const out = await writeWords({ ev: EV, voice: null, call, ms: 10_000 })
    expect(out?.angle).toBe('plain')
  })

  it('asks for the lines no set wrote well once more, keeping the rest', async () => {
    const asked: string[] = []
    const call = async <T>(request: FamilyRequest<T>): Promise<T> => {
      if (request.family === 'words_pick')
        return { reviews: [], choice: 'a', swaps: [], why: '' } as T
      const fix = request.prompt.includes('These lines fail')
      asked.push(fix ? 'fix' : request.family)
      return set({
        home_headline: fix ? 'Hello! Tell us what you need' : 'Money that moves',
      }) as T
    }
    const out = await writeWords({ ev: EV, voice: VOICE, call, ms: 10_000 })
    expect(asked).toEqual(['words', 'words', 'words', 'layout', 'layout', 'layout', 'fix'])
    expect(out?.answer.home_headline).toBe('Hello! Tell us what you need')
    expect(out?.answer.submit).toBe('Send it over')
  })

  it('asks a second time when the fix fails too, showing it its own failing line', async () => {
    const fixes: string[] = []
    const call = async <T>(request: FamilyRequest<T>): Promise<T> => {
      if (request.family === 'words_pick')
        return { reviews: [], choice: 'a', swaps: [], why: '' } as T
      if (!request.prompt.includes('These lines fail'))
        return set({ home_headline: 'Money that moves' }) as T
      fixes.push(request.prompt.split('These lines fail').pop()!)
      return set({
        home_headline: fixes.length === 1 ? 'Ideas by May 2' : 'Hej! Tell us',
      }) as T
    }
    const out = await writeWords({ ev: EV, voice: VOICE, call, ms: 10_000 })
    expect(fixes).toHaveLength(2)
    expect(fixes[1]).toContain('"Ideas by May 2"')
    expect(out?.answer.home_headline).toBe('Hej! Tell us')
  })

  describe('a button a customer must guess at', () => {
    const run = (writers: WordsAnswer[], fixes: string[], seen: string[]) =>
      writeWords({
        ev: EV,
        voice: VOICE,
        ms: 10_000,
        call: async <T>(request: FamilyRequest<T>): Promise<T> => {
          if (request.family === 'words_pick')
            return {
              reviews: [review('a', 5, 5, 5), review('b', 5, 3, 3), review('c', 5, 3, 3)],
              choice: 'a',
              swaps: [],
              why: '',
            } as T
          if (!request.prompt.includes('These lines fail')) {
            const angle = request.prompt.includes('their signature')
              ? 0
              : request.prompt.includes('plain and warm')
                ? 1
                : 2
            return writers[angle] as T
          }
          seen.push(request.prompt.split('These lines fail').pop()!)
          return set({ home_headline: 'A new headline', submit: fixes[seen.length - 1]! }) as T
        },
      })
    const signature = set({ home_headline: 'Hej! Tell us', submit: 'Take it to the drivers' })

    it('mends a button that sends the idea to their customers', async () => {
      const seen: string[] = []
      const hosts = set({ home_headline: 'Hej! Tell us', submit: 'Send to the hosts' })
      const out = await run([hosts, ...others], ['Send it our way'], seen)
      expect(out?.answer.submit).toBe('Send it our way')
    })
    const others = [set({ home_headline: 'Plain one' }), set({ home_headline: 'Playful one' })]

    it('is fixed on its own inside the chosen set: the set and its headlines stay', async () => {
      const seen: string[] = []
      const out = await run([signature, ...others], ['Post it to us'], seen)
      expect(out?.angle).toBe('signature')
      expect(out?.answer.home_headline).toBe('Hej! Tell us')
      expect(out?.answer.submit).toBe('Post it to us')
      expect(seen).toHaveLength(1)
      expect(seen[0]).toContain('submit ("Take it to the drivers")')
      expect(seen[0]).not.toContain('home_headline (')
    })

    it('is asked for on its own too when it still fails a lint after the set’s fixes', async () => {
      const seen: string[] = []
      const long = set({ home_headline: 'Hej! Tell us', submit: 'Send it to the practice team' })
      const out = await run(
        [long, ...others],
        ['Send it to the', 'Send it to the', 'Post it'],
        seen
      )
      expect(out?.answer.submit).toBe('Post it')
      expect(out?.answer.home_headline).toBe('Hej! Tell us')
      expect(seen.at(-1)).toContain('submit (')
      expect(seen.at(-1)).not.toContain('home_headline (')
    })

    it('shows a second fix the tries before it, and stays as it was when both fail', async () => {
      const seen: string[] = []
      const out = await run([signature, ...others], ['Hang out with us', 'Send to the team'], seen)
      expect(seen).toHaveLength(2)
      expect(seen[1]).toContain('"Hang out with us"')
      expect(seen[1]).toContain('also tried before, and failing: "Take it to the drivers"')
      expect(out?.answer.submit).toBe('Take it to the drivers')
      expect(out?.answer.home_headline).toBe('Hej! Tell us')
    })
  })

  it('asks the plain writer once more when no set parses', async () => {
    let n = 0
    const call = async <T>(): Promise<T> => {
      if (n++ < 3) throw new Error('Failed to parse structured output as JSON')
      return set() as T
    }
    const out = await writeWords({ ev: EV, voice: null, call, ms: 10_000 })
    // Three writers, Home's three readings, then the plain writer again.
    expect(n).toBe(7)
    expect(out?.angle).toBe('plain')
  })
})
