import { useEffect, useRef, useState, type ReactNode } from 'react'

// Keep the continuous page view while only mounting the expensive editor for
// pages near the viewport. Browsers without observers retain the full view.
export function DeferredBoard({ children, active }: { children: ReactNode; active: boolean }) {
  const element = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [height, setHeight] = useState<number>()
  useEffect(() => {
    if (!element.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '700px' })
    observer.observe(element.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!element.current || !(visible || active) || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height))
    observer.observe(element.current)
    return () => observer.disconnect()
  }, [visible, active])
  return <div ref={element} className="deferred-board" style={visible || active ? undefined : { height, aspectRatio: height ? undefined : '1.2' }}>
    {visible || active ? children : <div className="board-placeholder" aria-hidden="true">TLA</div>}
  </div>
}
