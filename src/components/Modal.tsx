import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

type ModalProps = {
  children: ReactNode
  onClose: () => void
  label: string
  className?: string
}

const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'

const focusableElements = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => {
  if (element.tabIndex < 0 || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false
  let current: HTMLElement | null = element
  while (current && root.contains(current)) {
    const style = getComputedStyle(current)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    current = current.parentElement
  }
  return true
})

/** Put the backdrop outside this component; className styles the dialog section. */
export function Modal({ children, onClose, label, className = 'modal' }: ModalProps) {
  const rootRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  const [returnFocus] = useState(() => typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null)

  useLayoutEffect(() => { onCloseRef.current = onClose }, [onClose])
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusFirst = () => (focusableElements(root)[0] ?? root).focus()
    if (!root.contains(document.activeElement)) focusFirst()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
      }
      if (event.key !== 'Tab') return
      const elements = focusableElements(root)
      const first = elements[0]
      const last = elements.at(-1)
      if (!first || !last) {
        event.preventDefault()
        root.focus()
      } else if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root || !root.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !root.contains(event.target)) focusFirst()
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', onFocusIn)
      document.body.style.overflow = previousOverflow
      if (returnFocus?.isConnected) returnFocus.focus()
    }
  }, [returnFocus])

  return <section ref={rootRef} className={className} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>{children}</section>
}
