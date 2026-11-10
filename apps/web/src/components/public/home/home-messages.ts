import { defineMessages } from 'react-intl'

/** What Home's blocks say to visitors. */
export const homeMessages = defineMessages({
  composerContinue: { id: 'portal.home.composer.continue', defaultMessage: 'Continue' },
  /** The hero's call to action, and its quiet second, by where each goes. */
  heroWritePost: { id: 'portal.home.hero.writePost', defaultMessage: 'Write a post' },
  heroSeeRoadmap: { id: 'portal.home.hero.seeRoadmap', defaultMessage: "See what's coming" },
  /** The ideas block's heading follows its sort: votes, trending or newest. */
  ideasTitle: {
    id: 'portal.home.ideas.title',
    defaultMessage: 'Top posts',
  },
  ideasTitleTrending: { id: 'portal.home.ideas.titleTrending', defaultMessage: 'Trending posts' },
  ideasTitleNew: { id: 'portal.home.ideas.titleNew', defaultMessage: 'Newest posts' },
  ideasAll: {
    id: 'portal.home.ideas.all',
    defaultMessage: 'See all posts',
  },
  ideasEmpty: {
    id: 'portal.home.ideas.empty',
    defaultMessage: 'No posts yet. Be the first.',
  },
  /** A roadmap block's heading when there is no roadmap to name it. */
  roadmapTitle: { id: 'portal.roadmap.title', defaultMessage: 'Roadmap' },
  roadmapAll: { id: 'portal.home.roadmap.all', defaultMessage: 'See the roadmap' },
  roadmapColumnEmpty: { id: 'portal.home.roadmap.columnEmpty', defaultMessage: 'Nothing here yet' },
  updatesTitle: { id: 'portal.home.updates.title', defaultMessage: 'Latest updates' },
  updatesAll: { id: 'portal.home.updates.all', defaultMessage: 'See all updates' },
  helpSearchTitle: { id: 'portal.home.helpSearch.title', defaultMessage: 'How can we help?' },
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
  roadmapEmpty: { id: 'portal.home.roadmap.empty', defaultMessage: 'Nothing on the roadmap yet.' },
  updatesEmpty: { id: 'portal.home.updates.empty', defaultMessage: 'No updates yet.' },
  helpTopicsEmpty: { id: 'portal.home.helpTopics.empty', defaultMessage: 'No help topics yet.' },
  statusEmpty: { id: 'portal.home.status.empty', defaultMessage: 'No status to show yet.' },
  /** What marks items the builder draws in a block with nothing of its own yet. */
  sample: { id: 'portal.home.sample', defaultMessage: 'Sample' },
  ideasComments: {
    id: 'portal.home.ideas.comments',
    defaultMessage: '{count, plural, one {# comment} other {# comments}}',
  },
  roadmapVotes: {
    id: 'portal.home.roadmap.votes',
    defaultMessage: '{count, plural, one {# vote} other {# votes}}',
  },
})
