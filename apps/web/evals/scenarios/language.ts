/**
 * §7.3 Language & misc (scenarios 24–25). Reply language mirrors the customer;
 * a bare greeting wastes no knowledge search.
 */
import type { Scenario } from '../types'

const HOURS_ARTICLE = {
  title: 'Nos horaires de support',
  content:
    'Notre équipe de support est disponible du lundi au vendredi, de 9h à 17h, heure du Pacifique. ' +
    'En dehors de ces heures, laissez-nous un message et nous vous répondrons le jour ouvré suivant.',
}

export const languageScenarios: Scenario[] = [
  {
    id: '24',
    title: 'French question → French answer',
    roles: ['customer_support'],
    surface: 'widget',
    fixtures: { kbArticles: [HOURS_ARTICLE] },
    prompt: 'Bonjour, quels sont vos horaires de support pendant la semaine ?',
    structural: [{ type: 'status', oneOf: ['answered'] }],
    // Language is judged, not heuristically sniffed: a marker-count heuristic
    // over-rejected fluent French replies that happened to use few of its
    // function words. A single cheap judge call reads far more reliably.
    rubric: { file: 'language.v1.md', dimension: 'language' },
  },
  {
    id: '25',
    title: 'Greeting-only message → no knowledge search wasted',
    roles: ['customer_support'],
    surface: 'widget',
    prompt: 'Hi there!',
    structural: [
      { type: 'status', oneOf: ['answered'] },
      { type: 'toolCallCount', n: 0 },
    ],
  },
]
