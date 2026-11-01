// @vitest-environment happy-dom
/**
 * Messages that name what visitors post, or what groups it, select on the
 * portal's words. The words reach every message below the provider that sets
 * them, through providers nested under it, and a message's own values still
 * win.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { FormattedMessage, IntlProvider, useIntl } from 'react-intl'
import { PortalWordsIntl, usePortalWords } from '../use-intl-setup'

const COMPOSER = {
  id: 'test.composer',
  defaultMessage:
    "{postWord, select, idea {What's your idea?} post {What's on your mind?} feature_request {What should we build?} suggestion {What's your suggestion?} other {What's your idea?}}",
}
const BOARDS = {
  id: 'test.boards',
  defaultMessage:
    '{boardWord, select, board {All boards} category {All categories} other {All boards}}',
}

function Composer() {
  return <p data-testid="composer">{useIntl().formatMessage(COMPOSER)}</p>
}

function Words() {
  const { postWord, boardWord } = usePortalWords()
  return <p data-testid="words">{`${postWord} ${boardWord}`}</p>
}

function intlTree(children: React.ReactNode) {
  return (
    <IntlProvider locale="en" onError={() => {}}>
      {children}
    </IntlProvider>
  )
}

afterEach(cleanup)

describe('the portal’s words', () => {
  it('reach a message, formatted or rendered', () => {
    render(
      intlTree(
        <PortalWordsIntl words={{ postWord: 'feature_request', boardWord: 'category' }}>
          <Composer />
          <p data-testid="boards">
            <FormattedMessage {...BOARDS} />
          </p>
        </PortalWordsIntl>
      )
    )
    expect(screen.getByTestId('composer').textContent).toBe('What should we build?')
    expect(screen.getByTestId('boards').textContent).toBe('All categories')
  })

  it('reach messages under a provider nested below, which applies them again', () => {
    render(
      intlTree(
        <PortalWordsIntl words={{ postWord: 'suggestion', boardWord: 'board' }}>
          <IntlProvider locale="en" messages={{}} onError={() => {}}>
            <PortalWordsIntl>
              <Composer />
              <Words />
            </PortalWordsIntl>
          </IntlProvider>
        </PortalWordsIntl>
      )
    )
    expect(screen.getByTestId('composer').textContent).toBe("What's your suggestion?")
    expect(screen.getByTestId('words').textContent).toBe('suggestion board')
  })

  it('let a draft’s words override the published ones, as the preview does', () => {
    render(
      intlTree(
        <PortalWordsIntl words={{ postWord: 'idea', boardWord: 'board' }}>
          <PortalWordsIntl words={{ postWord: 'post', boardWord: 'board' }}>
            <Composer />
          </PortalWordsIntl>
        </PortalWordsIntl>
      )
    )
    expect(screen.getByTestId('composer').textContent).toBe("What's on your mind?")
  })

  it('are idea and board where nothing sets them', () => {
    render(
      intlTree(
        <PortalWordsIntl>
          <Composer />
          <Words />
        </PortalWordsIntl>
      )
    )
    expect(screen.getByTestId('composer').textContent).toBe("What's your idea?")
    expect(screen.getByTestId('words').textContent).toBe('idea board')
  })

  it('give way to a message’s own value of the same name', () => {
    function Own() {
      return <p data-testid="own">{useIntl().formatMessage(BOARDS, { boardWord: 'category' })}</p>
    }
    render(
      intlTree(
        <PortalWordsIntl words={{ postWord: 'idea', boardWord: 'board' }}>
          <Own />
        </PortalWordsIntl>
      )
    )
    expect(screen.getByTestId('own').textContent).toBe('All categories')
  })
})
