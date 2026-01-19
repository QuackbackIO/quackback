/**
 * Friendly Username Generator
 *
 * Generates memorable, approachable usernames using Adjective + Animal + Number pattern.
 * Designed for user-facing display names, not security-sensitive identifiers.
 *
 * Pattern: {Adjective}{Animal}{4-digit number}
 * Examples: "HappyPenguin0042", "CuriousOtter1738", "GentleFox8391"
 */

// Positive, friendly adjectives - all approachable and non-aggressive
const ADJECTIVES = [
  // Personality traits
  'Happy',
  'Cheerful',
  'Merry',
  'Jolly',
  'Sunny',
  'Bright',
  'Radiant',
  'Gleeful',
  'Joyful',
  'Blissful',
  // Calm/peaceful
  'Calm',
  'Peaceful',
  'Serene',
  'Gentle',
  'Tranquil',
  'Mellow',
  'Cozy',
  'Snug',
  'Quiet',
  'Still',
  // Positive traits
  'Kind',
  'Warm',
  'Friendly',
  'Sweet',
  'Caring',
  'Tender',
  'Gracious',
  'Lovely',
  'Charming',
  'Pleasant',
  // Intelligence/skill
  'Clever',
  'Wise',
  'Witty',
  'Smart',
  'Keen',
  'Sharp',
  'Bright',
  'Quick',
  'Apt',
  'Savvy',
  // Energy/action
  'Swift',
  'Nimble',
  'Agile',
  'Spry',
  'Lively',
  'Zippy',
  'Peppy',
  'Bouncy',
  'Perky',
  'Frisky',
  // Curiosity/playfulness
  'Curious',
  'Playful',
  'Whimsy',
  'Quirky',
  'Zany',
  'Goofy',
  'Silly',
  'Funky',
  'Wacky',
  'Dapper',
  // Courage/strength
  'Brave',
  'Bold',
  'Noble',
  'Proud',
  'Valiant',
  'Gallant',
  'Daring',
  'Plucky',
  'Gutsy',
  'Hardy',
  // Nature/elements
  'Misty',
  'Snowy',
  'Frosty',
  'Breezy',
  'Dewy',
  'Rainy',
  'Stormy',
  'Windy',
  'Cloudy',
  'Dusty',
  // Colors/materials
  'Golden',
  'Silver',
  'Amber',
  'Azure',
  'Coral',
  'Jade',
  'Sage',
  'Rustic',
  'Velvet',
  'Crystal',
  // Space/cosmic
  'Cosmic',
  'Stellar',
  'Lunar',
  'Solar',
  'Astral',
  'Starry',
  'Nova',
  'Nebula',
  'Orbit',
  'Galactic',
  // Nature items
  'Maple',
  'Cedar',
  'Willow',
  'Mossy',
  'Leafy',
  'Pebble',
  'Sandy',
  'Rocky',
  'Meadow',
  'Forest',
] as const

// Friendly, likeable animals - universally appealing
const ANIMALS = [
  // Classic cute
  'Penguin',
  'Panda',
  'Koala',
  'Otter',
  'Bunny',
  'Kitten',
  'Puppy',
  'Hamster',
  'Hedgehog',
  'Chinchilla',
  // Forest animals
  'Fox',
  'Deer',
  'Elk',
  'Moose',
  'Bear',
  'Wolf',
  'Badger',
  'Beaver',
  'Raccoon',
  'Squirrel',
  // Birds
  'Owl',
  'Finch',
  'Robin',
  'Sparrow',
  'Falcon',
  'Hawk',
  'Eagle',
  'Raven',
  'Crow',
  'Jay',
  // More birds
  'Swan',
  'Heron',
  'Crane',
  'Stork',
  'Pelican',
  'Puffin',
  'Quail',
  'Wren',
  'Lark',
  'Dove',
  // Sea creatures
  'Dolphin',
  'Whale',
  'Seal',
  'Walrus',
  'Orca',
  'Narwhal',
  'Manatee',
  'Turtle',
  'Octopus',
  'Seahorse',
  // Amphibians/reptiles
  'Frog',
  'Toad',
  'Newt',
  'Gecko',
  'Iguana',
  'Tortoise',
  'Chameleon',
  'Axolotl',
  'Salamander',
  'Skink',
  // Small mammals
  'Mouse',
  'Vole',
  'Shrew',
  'Mole',
  'Lemur',
  'Loris',
  'Possum',
  'Ferret',
  'Meerkat',
  'Mongoose',
  // Insects/bugs
  'Bee',
  'Moth',
  'Cricket',
  'Beetle',
  'Ladybug',
  'Firefly',
  'Butterfly',
  'Dragonfly',
  'Mantis',
  'Cicada',
  // Wild cats
  'Lynx',
  'Bobcat',
  'Ocelot',
  'Puma',
  'Panther',
  'Cheetah',
  'Leopard',
  'Jaguar',
  'Tiger',
  'Lion',
  // Misc favorites
  'Sloth',
  'Alpaca',
  'Llama',
  'Capybara',
  'Wombat',
  'Platypus',
  'Kiwi',
  'Toucan',
  'Parrot',
  'Macaw',
] as const

/**
 * Get a random element from an array using crypto-secure randomness
 */
function randomElement<T>(array: readonly T[]): T {
  const randomBytes = new Uint32Array(1)
  crypto.getRandomValues(randomBytes)
  return array[randomBytes[0] % array.length]
}

/**
 * Generate a random 4-digit number (0000-9999) for uniqueness
 */
function randomSuffix(): string {
  const randomBytes = new Uint32Array(1)
  crypto.getRandomValues(randomBytes)
  return (randomBytes[0] % 10000).toString().padStart(4, '0') // 0000-9999
}

/**
 * Generate a friendly username with number suffix
 *
 * @returns A friendly username like "HappyPenguin0042" or "CuriousOtter1738"
 *
 * @example
 * generateUsername() // "HappyPenguin0042"
 * generateUsername() // "CuriousOtter1738"
 */
export function generateUsername(): string {
  const adjective = randomElement(ADJECTIVES)
  const animal = randomElement(ANIMALS)
  return `${adjective}${animal}${randomSuffix()}`
}

/**
 * Generate multiple username suggestions
 *
 * @param count - Number of suggestions to generate (default: 5)
 * @returns Array of unique username suggestions
 *
 * @example
 * generateUsernameSuggestions(3)
 * // ["HappyPenguin0042", "CuriousOtter1738", "GentleFox8391"]
 */
export function generateUsernameSuggestions(count = 5): string[] {
  const suggestions = new Set<string>()

  while (suggestions.size < count) {
    suggestions.add(generateUsername())
  }

  return Array.from(suggestions)
}

// Total combinations: 110 adjectives × 100 animals × 10000 suffixes = 110,000,000 unique usernames
