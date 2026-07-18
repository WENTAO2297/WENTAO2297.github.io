(() => {
  'use strict'

  if (window.__internalPagePrefetchInitialized) return
  window.__internalPagePrefetchInitialized = true

  const targetPaths = new Set(['/about/', '/ecust/', '/notes/'])
  const prefetched = new Set()
  const aboutBannerTimeout = 1200
  let disposeAboutBanner = null

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
    } catch {
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

  const prepareAboutBanner = () => {
    disposeAboutBanner?.()
    disposeAboutBanner = null

    const image = document.querySelector('.about-profile-banner__image')
    const banner = image?.closest('.about-profile-banner')
    if (!image || !banner) return

    let disposed = false
    let ready = false
    let timeout = null

    const setState = state => {
      banner.classList.remove('is-image-loading', 'is-image-ready', 'is-image-fallback')
      banner.classList.add(`is-image-${state}`)
      if (state === 'loading') banner.setAttribute('aria-busy', 'true')
      else banner.removeAttribute('aria-busy')
    }

    const removeListeners = () => {
      image.removeEventListener('load', handleLoad)
      image.removeEventListener('error', handleError)
    }

    const clearTimeoutFallback = () => {
      if (!timeout) return
      window.clearTimeout(timeout)
      timeout = null
    }

    const markReady = async () => {
      if (disposed || ready || image.naturalWidth === 0) return

      try {
        if (typeof image.decode === 'function') await image.decode()
      } catch {
        // A successful load can still be displayed when decode() rejects.
      }

      if (disposed || !image.isConnected || image.naturalWidth === 0) return
      ready = true
      clearTimeoutFallback()
      removeListeners()
      setState('ready')
    }

    const markFallback = () => {
      if (disposed || ready) return
      setState('fallback')
    }

    function handleLoad () {
      markReady()
    }

    function handleError () {
      clearTimeoutFallback()
      removeListeners()
      markFallback()
    }

    setState('loading')
    image.addEventListener('load', handleLoad)
    image.addEventListener('error', handleError)
    timeout = window.setTimeout(markFallback, aboutBannerTimeout)

    if (image.complete) {
      if (image.naturalWidth > 0) markReady()
      else handleError()
    }

    disposeAboutBanner = () => {
      disposed = true
      clearTimeoutFallback()
      removeListeners()
      banner.removeAttribute('aria-busy')
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

  document.addEventListener('pjax:send', () => disposeAboutBanner?.())
  document.addEventListener('pjax:complete', prepareAboutBanner)
  window.addEventListener('pageshow', prepareAboutBanner)

  const startIdlePrefetch = () => {
    scheduleIdlePrefetch()
    prepareAboutBanner()
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startIdlePrefetch, { once: true })
  } else {
    startIdlePrefetch()
  }
})()
