/**
 * Deterministic anonymous name generator.
 *
 * Generates GitHub-style "Adjective Animal" names from a user/principal ID.
 * The same ID always produces the same name — no DB storage needed.
 */

const ADJECTIVES = [
  'Bold',
  'Brave',
  'Bright',
  'Calm',
  'Clever',
  'Cool',
  'Daring',
  'Eager',
  'Fair',
  'Fast',
  'Fierce',
  'Free',
  'Gentle',
  'Grand',
  'Happy',
  'Keen',
  'Kind',
  'Lively',
  'Lucky',
  'Merry',
  'Mighty',
  'Noble',
  'Proud',
  'Quick',
  'Quiet',
  'Rare',
  'Sharp',
  'Silent',
  'Sleek',
  'Smart',
  'Smooth',
  'Snowy',
  'Solid',
  'Stark',
  'Steady',
  'Still',
  'Storm',
  'Strong',
  'Sure',
  'Swift',
  'Tall',
  'True',
  'Vivid',
  'Warm',
  'Watchful',
  'Wild',
  'Wise',
  'Witty',
  'Young',
  'Zesty',
]

const ANIMALS = [
  'Badger',
  'Bear',
  'Bobcat',
  'Cardinal',
  'Cheetah',
  'Cobra',
  'Condor',
  'Coyote',
  'Crane',
  'Crow',
  'Deer',
  'Dolphin',
  'Dove',
  'Eagle',
  'Elk',
  'Falcon',
  'Finch',
  'Fox',
  'Gazelle',
  'Gecko',
  'Goose',
  'Gopher',
  'Grouse',
  'Hawk',
  'Heron',
  'Horse',
  'Husky',
  'Ibis',
  'Iguana',
  'Impala',
  'Jackal',
  'Jaguar',
  'Jay',
  'Kestrel',
  'Kite',
  'Koala',
  'Lark',
  'Lemur',
  'Leopard',
  'Lion',
  'Llama',
  'Lynx',
  'Magpie',
  'Mantis',
  'Marten',
  'Moose',
  'Newt',
  'Ocelot',
  'Oriole',
  'Osprey',
  'Otter',
  'Owl',
  'Panda',
  'Parrot',
  'Pelican',
  'Puma',
  'Quail',
  'Raven',
  'Robin',
  'Salmon',
  'Seal',
  'Shark',
  'Shrike',
  'Snipe',
  'Sparrow',
  'Stork',
  'Swan',
  'Tern',
  'Thrush',
  'Tiger',
  'Toucan',
  'Trout',
  'Turtle',
  'Viper',
  'Vulture',
  'Walrus',
  'Weasel',
  'Whale',
  'Wolf',
  'Wombat',
  'Wren',
  'Yak',
  'Zebra',
]

// 50 adjectives x 85 animals = 4,250 unique combinations

/**
 * Simple deterministic hash from a string.
 * Produces a consistent unsigned 32-bit integer.
 */
function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }
  return hash >>> 0 // unsigned
}

/**
 * Generate a deterministic anonymous display name from an ID.
 * Same ID always produces the same "Adjective Animal" name.
 *
 * @example
 * generateAnonymousName('principal_01abc') // "Swift Falcon"
 * generateAnonymousName('user_01xyz')      // "Brave Otter"
 */
export function generateAnonymousName(id: string): string {
  const hash = hashString(id)
  const adjective = ADJECTIVES[hash % ADJECTIVES.length]
  const animal = ANIMALS[Math.floor(hash / ADJECTIVES.length) % ANIMALS.length]
  return `${adjective} ${animal}`
}
