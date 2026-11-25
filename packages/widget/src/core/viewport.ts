/**
 * Keep the full-screen phone panel above the on-screen keyboard.
 *
 * The keyboard shrinks the visual viewport but not the layout viewport, so a
 * panel sized by the stylesheet alone runs under it and hides the composer.
 * While attached, and while `phone` matches, the element takes the visual
 * viewport's height and top offset as inline styles, updated at most once per
 * frame. Detaching removes them, so the stylesheet's values apply again.
 *
 * Returns the detach function. Without `window.visualViewport` it does nothing.
 */
export function fitToVisualViewport(el: HTMLElement, phone: MediaQueryList): () => void {
  const viewport = window.visualViewport
  if (!viewport) return () => {}

  let frame = 0
  const clear = () => {
    el.style.removeProperty('height')
    el.style.removeProperty('top')
  }
  const apply = () => {
    frame = 0
    if (!phone.matches) return clear()
    el.style.height = `${viewport.height}px`
    el.style.top = `${viewport.offsetTop}px`
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(apply)
  }

  viewport.addEventListener('resize', schedule)
  viewport.addEventListener('scroll', schedule)
  phone.addEventListener('change', schedule)
  apply()

  return () => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    viewport.removeEventListener('resize', schedule)
    viewport.removeEventListener('scroll', schedule)
    phone.removeEventListener('change', schedule)
    clear()
  }
}
