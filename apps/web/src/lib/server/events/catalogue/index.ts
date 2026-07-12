/**
 * The event catalogue barrel. Importing this module registers every event
 * declaration (each family file calls `defineEvent` at import time), so any
 * consumer that needs the registry populated — the coverage test, the relay,
 * the resolvers, the surface generators — imports from here.
 */
export * from './define'
export * from './post'
export * from './comment'
export * from './changelog'
export * from './status'
export * from './conversation'
export * from './message'
export * from './ticket'
export * from './assistant'
export * from './admin'
export * from './content'
