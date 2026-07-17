(() => {
  'use strict'

  if (window.__internalPagePrefetchInitialized) return
  window.__internalPagePrefetchInitialized = true

  const targetPaths = new Set(['/about/', '/ecust/', '/notes/'])
  const prefetched = new Set()

  const normalizePath = path => {
    const normalized = path.replace(/\/index\.html$/, '/').replace(/\/+$/, '')
    return normalized || '/'
  }

  const isDesktop = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches

  const saveDataEnabled = () => Boolean(navigator.connection?.saveData)

  const getTargetPath = element => {
    if (!(element instanceof Element)) return null
    const link = element.closest('a[href]')
    if (!link || link.target === '_blank' || link.hasAttribute('download')) return null

    try {
      const url = new URL(link.href, window.location.href)
      if (url.origin !== window.location.origin) return null
      const path = normalizePath(url.pathname)
      return targetPaths.has(path) ? path : null
    } catch (error) {
      return null
    }
  }

  const appendPrefetchHint = (path, as, type) => {
    const href = new URL(path, window.location.origin).href
    if (document.head.querySelector(`link[data-internal-prefetch][href="${href}"]`)) return

    const hint = document.createElement('link')
    hint.rel = 'prefetch'
    hint.as = as
    hint.href = href
    hint.dataset.internalPrefetch = 'true'
    if (type) hint.type = type
    document.head.appendChild(hint)
  }

  const prefetch = path => {
    if (!targetPaths.has(path) || saveDataEnabled() || prefetched.has(path)) return
    if (normalizePath(window.location.pathname) === path) return

    prefetched.add(path)
    appendPrefetchHint(path, 'document')

    if (path === '/about/') {
      appendPrefetchHint('/about/fuji-banner.webp', 'image', 'image/webp')
      appendPrefetchHint('/images/logo.webp', 'image', 'image/webp')
    }
  }

  const scheduleIdlePrefetch = () => {
    if (!isDesktop() || saveDataEnabled()) return

    const run = () => targetPaths.forEach(prefetch)
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(run, { timeout: 4000 })
    } else {
      window.setTimeout(run, 1200)
    }
  }

  document.addEventListener('pointerover', event => {
    if (!isDesktop()) return
    const path = getTargetPath(event.target)
    if (path) prefetch(path)
  }, { passive: true })

  document.addEventListener('pointerdown', event => {
    if (isDesktop()) return
    const path = getTargetPath(event.target)
    if (path) prefetch(path)
  }, { passive: true })

  document.addEventListener('focusin', event => {
    const path = getTargetPath(event.target)
    if (path) prefetch(path)
  })

  const startIdlePrefetch = () => scheduleIdlePrefetch()
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startIdlePrefetch, { once: true })
  } else {
    startIdlePrefetch()
  }
})()
