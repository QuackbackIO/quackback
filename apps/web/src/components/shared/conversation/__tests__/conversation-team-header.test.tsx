// @vitest-environment happy-dom
/**
 * The visitor conversation header: who the visitor is talking to (up to three
 * teammates and the team name) and when to expect a reply. Online reads
 * "Online now"; otherwise the workspace's usual reply time, or the plain away
 * copy when the workspace hides it.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { ConversationTeamHeader } from '../conversation-team-header'
import { TeamFacepile } from '../team-facepile'

afterEach(cleanup)

function withIntl(ui: ReactNode) {
  return (
    <IntlProvider locale="en" messages={{}} onError={() => {}}>
      {ui}
    </IntlProvider>
  )
}

const TEAM = [
  { name: 'Ada Lovelace', avatarUrl: null },
  { name: 'Grace Hopper', avatarUrl: null },
  { name: 'Alan Turing', avatarUrl: null },
  { name: 'Edsger Dijkstra', avatarUrl: null },
]

function renderHeader(props: Partial<Parameters<typeof ConversationTeamHeader>[0]> = {}) {
  return render(
    withIntl(
      <ConversationTeamHeader
        team={TEAM}
        teamName="Acme Support"
        available={false}
        canReplyByEmail={false}
        {...props}
      />
    )
  )
}

describe('ConversationTeamHeader', () => {
  it('names the team and shows up to three teammates', () => {
    renderHeader()
    expect(screen.getByText('Acme Support')).toBeInTheDocument()
    expect(screen.getByText('AL')).toBeInTheDocument()
    expect(screen.getByText('GH')).toBeInTheDocument()
    expect(screen.getByText('AT')).toBeInTheDocument()
    expect(screen.queryByText('ED')).not.toBeInTheDocument()
  })

  it('renders without a facepile when there are no teammates', () => {
    const { container } = renderHeader({ team: [] })
    expect(screen.getByText('Acme Support')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="avatar"]')).toBeNull()
  })

  it('says online now while the team is available', () => {
    renderHeader({ available: true, replyTime: 'day' })
    expect(screen.getByText('Online now')).toBeInTheDocument()
    expect(screen.queryByText(/Typically replies/)).not.toBeInTheDocument()
  })

  it('shows under an hour while away when the workspace never set a reply time', () => {
    renderHeader()
    expect(screen.getByText('Typically replies in under an hour')).toBeInTheDocument()
  })

  it.each([
    ['minutes', 'Typically replies in a few minutes'],
    ['hour', 'Typically replies in under an hour'],
    ['hours', 'Typically replies in a few hours'],
    ['day', 'Typically replies within a day'],
  ] as const)('words the %s reply time while away', (replyTime, copy) => {
    renderHeader({ replyTime })
    expect(screen.getByText(copy)).toBeInTheDocument()
  })

  it('falls back to the away copy when the reply time is hidden', () => {
    const { rerender } = renderHeader({ replyTime: 'off', canReplyByEmail: true })
    expect(screen.getByText("We'll reply by email")).toBeInTheDocument()
    rerender(
      withIntl(
        <ConversationTeamHeader
          team={TEAM}
          teamName="Acme Support"
          available={false}
          canReplyByEmail={false}
          replyTime="off"
        />
      )
    )
    expect(screen.getByText("We'll reply here")).toBeInTheDocument()
    expect(screen.queryByText(/Typically replies/)).not.toBeInTheDocument()
  })

  it('adds when the team is back while away', () => {
    renderHeader({ nextOpenAt: '2030-01-07T09:00:00.000Z' })
    expect(screen.getByText(/Back/)).toBeInTheDocument()
  })
})

describe('TeamFacepile', () => {
  it('overlaps a little and stacks earlier faces on top so initials stay readable', () => {
    const { container } = render(
      <TeamFacepile faces={TEAM.slice(0, 3)} ringClassName="ring-card" />
    )
    const avatars = [...container.querySelectorAll<HTMLElement>('[data-slot="avatar"]')]
    expect(avatars).toHaveLength(3)
    expect(avatars.map((a) => a.style.zIndex)).toEqual(['3', '2', '1'])
    for (const avatar of avatars) {
      expect(avatar.className).toContain('ring-2')
      expect(avatar.className).toContain('ring-card')
    }
    // A 2px overlap plus the 2px ring keeps even wide initials (MW at 10px) clear.
    expect(container.firstElementChild?.className).toContain('-space-x-0.5')
    expect(container.firstElementChild?.className).not.toContain('-space-x-2')
  })
})
