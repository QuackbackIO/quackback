import { defineMessages } from 'react-intl'

/** What Home's blocks say to visitors. */
export const homeMessages = defineMessages({
  composerPlaceholder: {
    id: 'portal.feedback.header.titlePlaceholder',
    defaultMessage:
      "{postWord, select, post {What's on your mind?} feature_request {What should we build?} suggestion {What's your suggestion?} other {What's your idea?}}",
  },
  composerLabel: {
    id: 'portal.feedback.header.titleLabel',
    defaultMessage:
      '{postWord, select, post {Post title} feature_request {Feature request title} suggestion {Suggestion title} other {Idea title}}',
  },
  composerContinue: { id: 'portal.home.composer.continue', defaultMessage: 'Continue' },
  ideasTitle: {
    id: 'portal.home.ideas.title',
    defaultMessage:
      '{postWord, select, post {Top posts} feature_request {Top feature requests} suggestion {Top suggestions} other {Top ideas}}',
  },
  ideasAll: {
    id: 'portal.home.ideas.all',
    defaultMessage:
      '{postWord, select, post {See all posts} feature_request {See all feature requests} suggestion {See all suggestions} other {See all ideas}}',
  },
  ideasEmpty: {
    id: 'portal.home.ideas.empty',
    defaultMessage:
      '{postWord, select, post {No posts yet. Be the first.} feature_request {No feature requests yet. Be the first.} suggestion {No suggestions yet. Be the first.} other {No ideas yet. Be the first.}}',
  },
  roadmapAll: { id: 'portal.home.roadmap.all', defaultMessage: 'See the roadmap' },
  roadmapColumnEmpty: { id: 'portal.home.roadmap.columnEmpty', defaultMessage: 'Nothing here yet' },
  updatesTitle: { id: 'portal.home.updates.title', defaultMessage: 'Latest updates' },
  updatesAll: { id: 'portal.home.updates.all', defaultMessage: 'See all updates' },
  helpSearchTitle: { id: 'portal.home.helpSearch.title', defaultMessage: 'How can we help?' },
  helpSearchField: { id: 'portal.home.helpSearch.field', defaultMessage: 'Search help articles' },
  helpTopicsTitle: { id: 'portal.home.helpTopics.title', defaultMessage: 'Help topics' },
  helpAll: { id: 'portal.home.help.all', defaultMessage: 'Visit the help center' },
  statusTitle: { id: 'portal.home.status.title', defaultMessage: 'Status' },
  statusAll: { id: 'portal.home.status.all', defaultMessage: 'View status' },
  contactTitle: { id: 'portal.home.contact.title', defaultMessage: 'Talk to us' },
  contactBody: {
    id: 'portal.home.contact.body',
    defaultMessage: 'Ask a question or tell us about a problem, and we will get back to you.',
  },
  contactStart: { id: 'portal.home.contact.start', defaultMessage: 'Start a conversation' },
  linksTitle: { id: 'portal.home.links.title', defaultMessage: 'Links' },
})
