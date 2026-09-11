// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EmojiPicker } from '../emoji-picker'
import { installInMemoryLocalStorage } from '@/test/local-storage'
import { recordRecentEmoji } from '@/lib/shared/emoji-recommendations'

installInMemoryLocalStorage()

describe('EmojiPicker', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('includes the fingers-crossed glyph in the popular grid', async () => {
    render(<EmojiPicker onSelect={() => {}} />)
    fireEvent.click(screen.getByLabelText('Insert emoji'))
    expect(await screen.findByText('🤞')).toBeInTheDocument()
  })

  it('shows a Recent row above Popular when recents exist', async () => {
    recordRecentEmoji('🤞')
    recordRecentEmoji('🎉')
    render(<EmojiPicker onSelect={() => {}} />)
    fireEvent.click(screen.getByLabelText('Insert emoji'))
    expect(await screen.findByText('Recent')).toBeInTheDocument()
    expect(screen.getByText('Popular')).toBeInTheDocument()
    expect(screen.getAllByText('🤞').length).toBeGreaterThanOrEqual(1)
  })

  it('records a pick as recent and invokes onSelect', async () => {
    const onSelect = vi.fn()
    render(<EmojiPicker onSelect={onSelect} />)
    fireEvent.click(screen.getByLabelText('Insert emoji'))
    fireEvent.click(await screen.findByText('🤞'))
    expect(onSelect).toHaveBeenCalledWith('🤞')
    expect(JSON.parse(window.localStorage.getItem('quackback:emoji-recent')!)).toEqual(['🤞'])
  })
})
