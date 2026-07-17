(() => {
  'use strict'

  const state = window.__firstVisitLoaderState
  if (!state || window.__firstVisitLoaderController) {
    document.getElementById('first-visit-loader')?.remove()
    return
  }
  window.__firstVisitLoaderController = true

  const root = document.documentElement
  const loader = document.getElementById('first-visit-loader')
  const minimumVisible = 1500
  const maximumVisible = 2200
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const contentExitDuration = reducedMotion ? 80 : 170
  const layerExitDuration = reducedMotion ? 140 : 300
  const startedAt = Number(state.startedAt) || Date.now()

  const waitForDom = () => {
    if (document.readyState !== 'loading') return Promise.resolve()
    return new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }))
  }

  const waitForStylesheet = stylesheet => new Promise(resolve => {
    try {
      if (stylesheet.sheet) {
        resolve()
        return
      }
    } catch (error) {
      // Treat load/error and the short fallback timeout as authoritative.
    }

    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      stylesheet.removeEventListener('load', finish)
      stylesheet.removeEventListener('error', finish)
      window.clearTimeout(timeout)
      resolve()
    }
    const timeout = window.setTimeout(finish, 300)
    stylesheet.addEventListener('load', finish, { once: true })
    stylesheet.addEventListener('error', finish, { once: true })
  })

  const waitForCriticalStyles = () => {
    const stylesheets = Array.from(document.querySelectorAll(
      'link[rel="stylesheet"][href$="/css/custom.css"], #content-inner link[rel="stylesheet"]'
    ))
    return Promise.all(stylesheets.map(waitForStylesheet))
  }

  const getCriticalImages = () => {
    const path = window.location.pathname.replace(/\/index\.html$/, '/').replace(/\/+$/, '') || '/'
    if (path === '/') return Array.from(document.querySelectorAll('.personal-profile__avatar'))
    if (path === '/about') {
      return Array.from(document.querySelectorAll('.about-profile-banner img, .about-profile-avatar'))
    }
    return Array.from(document.querySelectorAll('[data-first-visit-critical]'))
  }

  const waitForImage = image => new Promise(resolve => {
    if (image.complete) {
      resolve()
      return
    }
    image.addEventListener('load', resolve, { once: true })
    image.addEventListener('error', resolve, { once: true })
  })

  const release = () => {
    if (state.finished) return
    state.finished = true
    window.clearTimeout(state.timer)

    const delay = Math.max(0, minimumVisible - (Date.now() - startedAt))
    window.setTimeout(() => {
      if (!loader) {
        root.classList.remove('first-visit-pending')
        return
      }

      loader.classList.add('is-exiting-content')
      window.setTimeout(() => {
        loader.classList.add('is-leaving')
        window.setTimeout(() => {
          root.classList.remove('first-visit-pending')
          loader.remove()
        }, layerExitDuration)
      }, contentExitDuration)
    }, delay)
  }

  if (!loader) {
    state.fallback?.()
    return
  }

  const ready = Promise.all([
    waitForDom(),
    waitForCriticalStyles(),
    Promise.all(getCriticalImages().map(waitForImage))
  ])
  const remaining = Math.max(0, maximumVisible - (Date.now() - startedAt))
  Promise.race([ready, new Promise(resolve => window.setTimeout(resolve, remaining))]).then(release)
})()
