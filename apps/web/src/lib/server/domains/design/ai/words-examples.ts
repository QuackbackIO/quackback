/**
 * Worked examples for the portal's words: the voice read from a site's words,
 * then one set of words for each way of writing them. Fictional brands only
 * (Harbor, a coffee roastery, and Petalpost, stationery, from the approved
 * goal designs; Nonna Rosa, a fresh pasta kitchen, and Larkpost, a courier
 * whose site offers its service, invented here). Never a
 * brand the matcher is evaluated on: an example's words would be copied into
 * that brand's portal.
 */
import type { VoiceAnswer, WordsAnswer, WordsEvidence } from './words-evidence'

/** How a writer leans: on the brand's signature, on plain warmth, or on its play. */
export const WRITING_ANGLES = ['signature', 'plain', 'playful'] as const
export type WritingAngle = (typeof WRITING_ANGLES)[number]

export interface WordsExample {
  brand: string
  /** The evidence as the prompt lists it for any brand (wordsEvidenceLines). */
  evidence: WordsEvidence
  voice: VoiceAnswer
  answers: Record<WritingAngle, WordsAnswer>
}

const PAGES = ['feedback', 'roadmap', 'changelog', 'help', 'support']

export const WORDS_EXAMPLES: WordsExample[] = [
  {
    brand: 'Harbor',
    evidence: {
      name: 'Harbor Coffee',
      headline: 'Small-batch coffee, roasted by the sea',
      subtitle: 'Fresh beans at your door every other week.',
      button: 'Start a subscription',
      seen: ['HARBOR', 'Meet the roasters'],
      pages: PAGES,
      language: null,
    },
    voice: {
      evidence:
        'Warm and crafted, about roasting by the sea; calm sentences, no exclamation marks, no catchphrase. The logo is in capitals; their sentences write Harbor.',
      name: 'Harbor',
      known: 'not',
      signatures: [],
      home_language: 'none',
      formality: 'neutral',
      humour: 'warm',
      exclamations: 'never',
      emoji: 'never',
      vocabulary: ['roast', 'beans', 'blends', 'brew', 'subscription', 'roasters'],
      avoid: ['hard selling', 'coffee puns that say nothing'],
    },
    answers: {
      signature: {
        evidence: 'Warm and crafted; their roasting by the sea, asked about.',
        home_layout: 'portal',
        home_headline: 'What should we roast by the sea next?',
        home_subtitle:
          'Suggest what we roast next, see what is coming and find help with your subscription.',
        feedback_headline: 'Tell us how to roast it better',
        feedback_subtitle:
          "Share ideas for beans, blends and subscriptions, and vote for the ones you'd like to taste.",
        prompt: 'Suggest a bean or a blend',
        submit: 'Send to the roasters',
      },
      plain: {
        evidence: 'Calm and warm, in their words for roasting; no wordplay.',
        home_layout: 'portal',
        home_headline: 'Help us roast what you love',
        home_subtitle:
          'Share ideas for beans and blends, see what is coming next and get help with your subscription.',
        feedback_headline: 'What should Harbor roast next?',
        feedback_subtitle:
          'Tell us the beans, blends and brews you would like, and vote for the ideas you want in your cup.',
        prompt: 'A bean or a better subscription',
        submit: 'Pass it to the roasters',
      },
      playful: {
        evidence: 'Warm, with an idiom about brewing that still says what it means.',
        home_layout: 'portal',
        home_headline: 'Which bean should we roast next?',
        home_subtitle: 'Suggest beans, vote on blends and see what is brewing next.',
        feedback_headline: 'What should we brew next?',
        feedback_subtitle:
          'Tell us the bean or blend you are curious about, and vote for the ones you want in your cup.',
        prompt: 'A bean, a blend, a better brew?',
        submit: 'Send it over',
      },
    },
  },
  {
    brand: 'Nonna Rosa',
    evidence: {
      name: 'Nonna Rosa',
      headline: 'Ciao! Fresh pasta, made by hand every morning',
      subtitle: 'Rolled in our kitchen, at your door by dinner.',
      button: 'Order now',
      seen: ['Mangia!', 'Recipes from Nonna'],
      pages: PAGES,
      language: null,
    },
    voice: {
      evidence:
        'Warm family-kitchen talk in English, with Italian greetings as flavour (Ciao!, Mangia!) and happy exclamation marks.',
      name: 'Nonna Rosa',
      known: 'not',
      signatures: ['Ciao!', 'Mangia!'],
      home_language: 'Italian',
      formality: 'casual',
      humour: 'warm',
      exclamations: 'often',
      emoji: 'never',
      vocabulary: ['pasta', 'kitchen', 'made by hand', 'recipes', 'dinner', 'sauces'],
      avoid: ['corporate words', 'whole sentences in Italian'],
    },
    answers: {
      signature: {
        evidence: 'Their Italian greeting as flavour, and their made-by-hand words asked about.',
        home_layout: 'portal',
        home_headline: 'Ciao! What should we make by hand next?',
        home_subtitle:
          'Tell us what to cook next, see what is coming from our kitchen and find help with your orders.',
        feedback_headline: 'What should Nonna make next?',
        feedback_subtitle:
          'Share ideas for shapes, sauces and deliveries, and vote for the ones you want on your table.',
        prompt: 'Suggest a shape or a sauce',
        submit: 'Send to the kitchen',
      },
      plain: {
        evidence: 'Warm and plain, in their kitchen words and their name; no Italian.',
        home_layout: 'portal',
        home_headline: 'Help us cook your favourite pasta',
        home_subtitle:
          'Share ideas, see what is coming from our kitchen and get help with your orders.',
        feedback_headline: 'What should Nonna Rosa make next?',
        feedback_subtitle:
          'Tell us what would make your pasta nights better, and vote for the ideas you like.',
        prompt: 'A pasta shape or a better box',
        submit: 'Tell Nonna',
      },
      playful: {
        evidence: 'Their greeting and exclamation marks, with a friendly question.',
        home_layout: 'portal',
        home_headline: 'Ciao! What are we cooking next?',
        home_subtitle:
          'Suggest a dish, vote for your favourites and see what is simmering in our kitchen.',
        feedback_headline: 'Got a craving? Tell us!',
        feedback_subtitle:
          'Suggest shapes, sauces and sides, and vote for the ones you would order tonight.',
        prompt: 'A shape, a sauce, a side?',
        submit: 'Send it over!',
      },
    },
  },
  {
    brand: 'Petalpost',
    evidence: {
      name: 'Petalpost',
      headline: 'Stationery to fall in love with 💌',
      subtitle: '',
      button: 'Shop the collection',
      seen: ['Hello, pen pal!', 'New in: spring papers'],
      pages: PAGES,
      language: null,
    },
    voice: {
      evidence:
        'Friendly and a little playful; it greets you as a pen pal, with an emoji now and then.',
      name: 'Petalpost',
      known: 'not',
      signatures: ['Hello, pen pal!'],
      home_language: 'none',
      formality: 'casual',
      humour: 'playful',
      exclamations: 'sometimes',
      emoji: 'sometimes',
      vocabulary: ['notebooks', 'pens', 'papers', 'letters', 'collection'],
      avoid: ['an emoji in every line', 'shop talk'],
    },
    answers: {
      signature: {
        evidence: 'Their pen-pal greeting leads; the rest is friendly and plain.',
        home_layout: 'portal',
        home_headline: 'Hello, pen pal!',
        home_subtitle:
          'Share what you would love to see on our shelves, peek at what is coming and find help.',
        feedback_headline: 'What should we stock next?',
        feedback_subtitle:
          "Tell us which notebooks, pens and papers you'd love to see, and vote for your favourites.",
        prompt: 'Suggest a notebook or a pen',
        submit: 'Suggest it',
      },
      plain: {
        evidence: 'Friendly and plain, in their words for paper things.',
        home_layout: 'portal',
        home_headline: 'Help us fill your stationery drawer',
        home_subtitle:
          'Suggest new notebooks, pens and papers, see what is coming and find help with your orders.',
        feedback_headline: 'What should Petalpost make next?',
        feedback_subtitle:
          'Tell us what you would love to write with, and vote for the ideas you like.',
        prompt: 'A notebook you would love',
        submit: 'Send it our way',
      },
      playful: {
        evidence: 'Letter-writing play that still says what it means, with their one emoji.',
        home_layout: 'portal',
        home_headline: 'Write us your wishes, pen pal 💌',
        home_subtitle: 'Suggest new papers, vote for your favourites and see what is landing next.',
        feedback_headline: 'Dear Petalpost, please make…',
        feedback_subtitle:
          'Tell us the notebook, pen or paper you are dreaming of, and vote for the ones you love.',
        prompt: 'Which notebook should we make?',
        submit: 'Post it',
      },
    },
  },
  {
    brand: 'Larkpost',
    evidence: {
      name: 'Larkpost',
      headline: 'Hello! What can we help you send today?',
      subtitle: 'Parcels and letters, collected from your door.',
      button: 'Get a quote',
      seen: ['Track a parcel', 'Find a drop-off point'],
      pages: PAGES,
      language: null,
    },
    voice: {
      evidence:
        'Friendly and helpful, with a cheerful hello; plain words for sending, tracking and drop-offs.',
      name: 'Larkpost',
      known: 'not',
      signatures: ['Hello!'],
      home_language: 'none',
      formality: 'casual',
      humour: 'warm',
      exclamations: 'sometimes',
      emoji: 'never',
      vocabulary: ['parcels', 'letters', 'sending', 'tracking', 'drop-off points', 'deliveries'],
      avoid: ['offering to send things on the portal', 'courier jargon'],
    },
    answers: {
      signature: {
        evidence:
          'Their cheerful hello leads; the site offers sending, so the portal asks for ideas about it.',
        home_layout: 'portal',
        home_headline: 'Hello! What would make sending easier?',
        home_subtitle:
          'Share ideas for sending, tracking and drop-offs, see what is coming and get help with your parcels.',
        feedback_headline: 'How should Larkpost deliver better?',
        feedback_subtitle:
          'Tell us what would make sending and tracking easier, and vote for the ideas you like.',
        prompt: 'A tracking or drop-off idea',
        submit: 'Send it our way',
      },
      plain: {
        evidence:
          'Friendly and plain, in their words for parcels; ideas about the service, not the service.',
        home_layout: 'portal',
        home_headline: 'Help us make your deliveries better',
        home_subtitle:
          'Suggest ideas for sending and tracking, vote for the ones you want and get help with your parcels.',
        feedback_headline: 'What should Larkpost improve next?',
        feedback_subtitle:
          'Tell us how sending, tracking and drop-offs could work better, and vote for your favourites.',
        prompt: 'A better way to track parcels',
        submit: 'Pop it in the post',
      },
      playful: {
        evidence: 'Postal play that still says what it means, with their cheerful hello.',
        home_layout: 'portal',
        home_headline: 'Post us your ideas',
        home_subtitle:
          'Suggest what we should deliver better, vote on ideas and see what is on its way.',
        feedback_headline: 'Special delivery: your ideas',
        feedback_subtitle:
          'Tell us the tracking, drop-off or parcel idea you would love, and vote for the ones you like.',
        prompt: 'A parcel idea for us?',
        submit: 'Post it to us',
      },
    },
  },
]
