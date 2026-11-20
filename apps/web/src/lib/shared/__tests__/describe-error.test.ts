import { describe, expect, it } from 'vitest'
import { describeError, noticeText } from '../describe-error'
import {
  UNEXPECTED_ERROR_MESSAGE,
  liftErrorReference,
  withErrorReference,
} from '../error-reference'

const team = { team: true, online: true }
const visitor = { team: false, online: true }
const FALLBACK = "Couldn't create roadmap"

const hidden = () =>
  liftErrorReference(new Error(withErrorReference(UNEXPECTED_ERROR_MESSAGE, 'D264-C488')))

describe('describeError', () => {
  it('shows a message written for people as written, to everyone', () => {
    const planned = new Error('A board with this slug already exists')
    expect(describeError(planned, FALLBACK, team)).toEqual({ title: planned.message })
    expect(describeError(planned, FALLBACK, visitor)).toEqual({ title: planned.message })
    expect(describeError({ message: 'Slug taken' }, FALLBACK, team)).toEqual({
      title: 'Slug taken',
    })
  })

  it('names the action and gives the team the reference for a failure the server hid', () => {
    expect(describeError(hidden(), FALLBACK, team)).toEqual({
      title: FALLBACK,
      description: UNEXPECTED_ERROR_MESSAGE,
      reference: 'D264-C488',
    })
  })

  it('reads a reference still inside the message', () => {
    const unlifted = new Error(withErrorReference(UNEXPECTED_ERROR_MESSAGE, 'D264-C488'))
    expect(describeError(unlifted, FALLBACK, team).reference).toBe('D264-C488')
  })

  it("gives a visitor the caller's line alone, with no code", () => {
    expect(describeError(hidden(), FALLBACK, visitor)).toEqual({ title: FALLBACK })
  })

  it('tells a dropped connection from an unreachable server', () => {
    const noAnswer = new TypeError('Failed to fetch')
    expect(describeError(noAnswer, FALLBACK, { team: true, online: false }).title).toBe(
      "You're offline"
    )
    expect(describeError(noAnswer, FALLBACK, team).title).toBe("Couldn't reach the server")
    expect(describeError(noAnswer, FALLBACK, visitor)).toEqual({ title: FALLBACK })
  })

  it('offers a reload when the page asks for a file an update replaced', () => {
    const stale = new TypeError(
      'Failed to fetch dynamically imported module: https://acme.example/assets/roadmap-abc.js'
    )
    expect(describeError(stale, FALLBACK, team)).toEqual({
      title: 'Quackback was updated',
      description: 'Reload to keep working.',
      action: 'reload',
    })
  })

  it('offers sign-in when the session has ended', () => {
    expect(describeError(new Error('Authentication required'), FALLBACK, team)).toMatchObject({
      title: "You've been signed out",
      action: 'sign-in',
    })
  })

  it('never shows the role gate wording', () => {
    const denied = new Error('Access denied: Requires [admin], got member')
    expect(describeError(denied, FALLBACK, team)).toEqual({
      title: "You don't have permission to do that",
    })
    expect(describeError(denied, FALLBACK, visitor)).toEqual({ title: FALLBACK })
  })

  it('words a rejected payload instead of printing its issue list', () => {
    const rejected = new Error(
      JSON.stringify([{ code: 'too_small', path: ['name'], message: 'Too small' }])
    )
    expect(describeError(rejected, FALLBACK, team)).toEqual({
      title: FALLBACK,
      description: "Some details aren't valid. Check the form and try again.",
    })
    expect(describeError(rejected, FALLBACK, visitor)).toEqual({ title: FALLBACK })
  })

  it("does not print a bug in the browser's own code", () => {
    const bug = new TypeError("Cannot read properties of undefined (reading 'id')")
    expect(describeError(bug, FALLBACK, team)).toEqual({ title: FALLBACK })
  })

  it('falls back when there is nothing to read', () => {
    expect(describeError(undefined, FALLBACK, team)).toEqual({ title: FALLBACK })
    expect(describeError(new Error(''), FALLBACK, team)).toEqual({ title: FALLBACK })
  })
})

describe('noticeText', () => {
  it('is the title alone for a planned message', () => {
    expect(noticeText({ title: 'Slug taken' })).toBe('Slug taken')
  })

  it('joins the action, the sentence and the reference into one line', () => {
    expect(noticeText(describeError(hidden(), FALLBACK, team))).toBe(
      `${FALLBACK}. ${UNEXPECTED_ERROR_MESSAGE} (Ref D264-C488)`
    )
    expect(
      noticeText({ title: 'Failed to save. Try again.', description: 'Check the form.' })
    ).toBe('Failed to save. Try again. Check the form.')
  })
})
