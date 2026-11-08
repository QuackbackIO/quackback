/**
 * What the builder calls the pages and the Home blocks. Kept apart from the
 * outline so what draws the portal can name them without loading it.
 */
import type { HomeBlockType } from './home'
import type { DesignerPage } from './outline'

/**
 * How far a change to a picked element reaches, narrowest first: the one
 * ladder of words every panel, scope line and undo step says.
 */
export const SCOPE_WORDS = {
  part: 'Just this one',
  block: 'This block',
  page: 'This page',
  everywhere: 'Everywhere',
} as const

export const BLOCK_NAMES: Record<HomeBlockType, string> = {
  welcome: 'Welcome',
  composer: 'Write a post',
  ideas: 'Top posts',
  roadmap: 'Roadmap',
  updates: 'Latest updates',
  help_search: 'Help search',
  help_topics: 'Help topics',
  status: 'Status',
  contact: 'Contact',
  links: 'Links',
}

export const PAGE_NAMES: Record<DesignerPage, string> = {
  home: 'Home',
  feedback: 'Feedback',
  roadmap: 'Roadmap',
  changelog: 'Changelog',
  help: 'Help Center',
  support: 'Support',
  status: 'Status',
  post: 'A post',
}
