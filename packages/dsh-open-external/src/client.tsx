// dsh-open-external — CLIENT half. Harness marks external links with
// target="_blank". Electron's setWindowOpenHandler already forwards those to
// the system browser; this interceptor covers in-page <a> clicks that never
// create a window. Ask the desktop preload via postMessage, then fall back to
// window.open. Same-origin links keep in-app behaviour.

const PARENT_OPEN_MESSAGE = 'dsh-open-external'

function openExternal(url: string): void {
  fallback(url)
}

/**
 * When this iframe cannot reach the opener directly, ask the parent shell (which
 * always can) over postMessage; if there is no parent, try a plain new window.
 */
function fallback(url: string): void {
  try {
    if (window.parent !== window) {
      window.parent.postMessage({ type: PARENT_OPEN_MESSAGE, url }, '*')
      return
    }
  } catch { /* cross-origin parent access denied — fall through */ }
  try { window.open(url, '_blank', 'noopener,noreferrer') } catch { /* nothing else to try */ }
}

/** True for an absolute http(s) URL on a different origin than this frame. */
export function isExternalHttp(href: string): boolean {
  if (!/^https?:\/\//i.test(href)) return false
  try { return new URL(href).origin !== window.location.origin } catch { return false }
}

function installExternalLinkOpener(): () => void {
  const onClick = (event: MouseEvent): void => {
    if (event.defaultPrevented || event.button !== 0
      || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const start = event.target as Element | null
    const anchor = start !== null && typeof start.closest === 'function'
      ? start.closest('a[href]') as HTMLAnchorElement | null
      : null
    if (anchor === null) return
    const href = anchor.href
    if (!isExternalHttp(href)) return
    // Preempt the dead target="_blank" navigation and open it for real.
    event.preventDefault()
    event.stopPropagation()
    openExternal(href)
  }
  document.addEventListener('click', onClick, true)
  return () => { document.removeEventListener('click', onClick, true) }
}

export const inject: string[] = []

export function apply(ctx: any): void {
  ctx.effect(installExternalLinkOpener, 'dsh-open-external: intercept external links')
}

export const internals = { isExternalHttp }
