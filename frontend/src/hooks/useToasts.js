import { useCallback, useEffect, useRef, useState } from 'react'

/** Small toast queue (max 3 visible). Timers are cleared when the component unmounts. */
export function useToasts() {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const dismissToast = useCallback(id => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setToasts(previous => previous.filter(toast => toast.id !== id))
  }, [])

  const pushToast = useCallback((type, message, options = {}) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const duration = options.duration ?? (type === 'error' ? 7000 : 3500)

    setToasts(previous => [
      ...previous.slice(-2),
      { id, type, message, actionLabel: options.actionLabel, onAction: options.onAction },
    ])
    timers.current.set(id, setTimeout(() => dismissToast(id), duration))
    return id
  }, [dismissToast])

  useEffect(() => {
    const active = timers.current
    return () => active.forEach(timer => clearTimeout(timer))
  }, [])

  return { toasts, pushToast, dismissToast }
}
