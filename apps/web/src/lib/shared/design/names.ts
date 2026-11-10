/**
 * What the builder calls the pages and the Home blocks. Kept apart from the
 * outline so what draws the portal can name them without loading it.
 */
import type { HomeBlockType } from './home'
import type { DesignerPage } from './outline'

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
