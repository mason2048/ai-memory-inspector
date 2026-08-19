import { useEffect, useRef } from 'react'

const focusableSelector = [
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useDialogFocus(onDismiss: () => void, active = true) {
  const dialogRef = useRef<HTMLElement>(null)
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useEffect(() => {
    if (!active) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    if (!dialog) return

    const focusable = () => [...dialog.querySelectorAll<HTMLElement>(focusableSelector)]
      .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
    const initial = dialog.querySelector<HTMLElement>('[data-autofocus]') ?? focusable()[0] ?? dialog
    window.requestAnimationFrame(() => initial.focus())

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        dismissRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = items[0]
      const last = items.at(-1) ?? first
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (previous?.isConnected) window.requestAnimationFrame(() => previous.focus())
    }
  }, [active])

  return dialogRef
}
