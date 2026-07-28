(() => {
  'use strict'

  if (window.SiteReadiness) return

  const root = document.documentElement
  const bootState = window.__siteBootState || window.__firstVisitLoaderState || null
  const warningPrefix = '[Site Readiness]'
  const minimumVisible = 850
  const pageReadyFallback = 1800
  const stylesheetTimeout = 1600
  const fontTimeout = 3500
  const videoTimeout = 5500

  const createDeferred = () => {
    let resolve
    const promise = new Promise(nextResolve => { resolve = nextResolve })
    return { promise, resolve }
  }

  const runtime = {
    initialStarted: false,
    initialPromise: null,
    initialDeferred: createDeferred(),
    pageEpoch: 0,
    pageReady: createDeferred(),
    pageReadyMarked: false,
    pageReadyTimer: null,
    pageAbortHandlers: new Set(),
    tasks: new Map(),
    videoPromise: null
  }

  const warn = (message, details) => {
    if (details === undefined) console.warn(warningPrefix, message)
    else console.warn(warningPrefix, message, details)
  }

  const nextFrame = callback => {
    if (typeof window.requestAnimationFrame === 'function') return window.requestAnimationFrame(callback)
    return window.setTimeout(callback, 16)
  }

  const afterFrames = count => new Promise(resolve => {
    let remaining = count
    const advance = () => {
      remaining -= 1
      if (remaining <= 0) resolve()
      else nextFrame(advance)
    }
    nextFrame(advance)
  })

  const waitForDom = () => {
    if (document.readyState !== 'loading') return Promise.resolve()
    return new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }))
  }

  const waitForStylesheet = stylesheet => new Promise(resolve => {
    let settled = false
    let timeout = null
    const finish = () => {
      if (settled) return
      settled = true
      stylesheet.removeEventListener('load', finish)
      stylesheet.removeEventListener('error', finish)
      if (timeout !== null) window.clearTimeout(timeout)
      resolve()
    }

    try {
      if (stylesheet.sheet) {
        finish()
        return
      }
    } catch {
      // Cross-origin stylesheets can throw here; load/error remain authoritative.
    }

    stylesheet.addEventListener('load', finish, { once: true })
    stylesheet.addEventListener('error', finish, { once: true })
    timeout = window.setTimeout(finish, stylesheetTimeout)
  })

  const waitForCriticalStyles = () => Promise.all(
    Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .filter(stylesheet => stylesheet.media !== 'print')
      .map(waitForStylesheet)
  )

  const waitForFonts = () => {
    if (!document.fonts?.ready) return Promise.resolve()

    return new Promise(resolve => {
      let settled = false
      const timeout = window.setTimeout(() => {
        if (settled) return
        settled = true
        warn('font readiness timed out; continuing with fallback fonts')
        resolve()
      }, fontTimeout)
      Promise.resolve(document.fonts.ready).then(() => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        resolve()
      }).catch(error => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        warn('font readiness failed; continuing with fallback fonts', error)
        resolve()
      })
    })
  }

  const settleImage = (image, epoch) => new Promise(resolve => {
    let settled = false
    const finish = (loaded, reason = '') => {
      if (settled) return
      settled = true
      image.removeEventListener('load', onLoad)
      image.removeEventListener('error', onError)
      runtime.pageAbortHandlers.delete(abort)

      if (!loaded && reason !== 'aborted') warn('critical image unavailable; continuing', image.currentSrc || image.src)
      if (!loaded || epoch !== runtime.pageEpoch || !image.isConnected) {
        resolve()
        return
      }

      Promise.resolve(typeof image.decode === 'function' ? image.decode() : undefined)
        .catch(error => warn('critical image decode failed; continuing', error))
        .then(resolve)
    }
    const onLoad = () => finish(true)
    const onError = () => finish(false, 'error')
    const abort = () => finish(false, 'aborted')

    runtime.pageAbortHandlers.add(abort)
    image.addEventListener('load', onLoad, { once: true })
    image.addEventListener('error', onError, { once: true })
    image.loading = 'eager'

    if (!image.isConnected || epoch !== runtime.pageEpoch) abort()
    else if (image.complete) {
      if (image.naturalWidth > 0) onLoad()
      else onError()
    }
  })

  const waitForCriticalImages = () => {
    const epoch = runtime.pageEpoch
    const markedImages = Array.from(document.querySelectorAll('[data-boot-critical], [data-first-visit-critical]'))
    const fallbackImages = markedImages.length
      ? []
      : Array.from(document.querySelectorAll('.about-profile-banner__image, .about-profile-avatar'))
    const images = markedImages.length ? markedImages : fallbackImages
    return Promise.all(images.map(image => settleImage(image, epoch)))
  }

  const markVideoReady = (container, media) => {
    container.classList.add('is-video-ready')
    container.classList.remove('is-video-failed')
    media.dataset.siteVideoFrameReady = 'true'
  }

  const markVideoFailed = (container, media, reason) => {
    container.classList.remove('is-video-ready')
    container.classList.add('is-video-failed')
    media.dataset.siteVideoFrameReady = 'fallback'
    warn('background video unavailable; using static fallback', reason)
  }

  const waitForVideoFrame = () => {
    const container = document.querySelector('.site-video-background')
    const media = container?.querySelector('.site-video-background__media')
    if (!container || !media) return Promise.resolve()
    if (runtime.videoPromise) return runtime.videoPromise

    runtime.videoPromise = new Promise(resolve => {
      let settled = false
      let timeout = null
      let frameFallback = null
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
      const finish = (success, reason = '') => {
        if (settled) return
        settled = true
        media.removeEventListener('loadeddata', onLoadedData)
        media.removeEventListener('error', onError)
        if (timeout !== null) window.clearTimeout(timeout)
        if (frameFallback !== null) window.clearTimeout(frameFallback)
        if (success) markVideoReady(container, media)
        else markVideoFailed(container, media, reason)
        resolve()
      }
      const fallbackAfterLoadedData = () => {
        afterFrames(2).then(() => finish(true))
      }
      const onLoadedData = () => {
        if (media.readyState < 2) return

        if (!reducedMotion && typeof media.requestVideoFrameCallback === 'function') {
          media.requestVideoFrameCallback(() => finish(true))
          // A paused or autoplay-blocked video may not submit a callback.
          frameFallback = window.setTimeout(fallbackAfterLoadedData, 500)
        } else {
          fallbackAfterLoadedData()
        }
      }
      const onError = event => finish(false, event)

      media.addEventListener('loadeddata', onLoadedData)
      media.addEventListener('error', onError, { once: true })
      timeout = window.setTimeout(() => finish(false, 'timeout'), videoTimeout)

      if (media.readyState >= 2) onLoadedData()
      if (!reducedMotion && document.visibilityState !== 'hidden') {
        Promise.resolve(media.play?.()).catch(() => {})
      }
    })

    return runtime.videoPromise
  }

  const registerTask = (name, promise) => {
    if (runtime.tasks.has(name)) return runtime.tasks.get(name)
    const task = Promise.resolve(typeof promise === 'function' ? promise() : promise)
      .catch(error => warn(`task "${name}" failed; continuing`, error))
    runtime.tasks.set(name, task)
    return task
  }

  const currentPageMode = () => document.getElementById('content-inner')?.dataset.pageReadiness || 'auto'

  const clearPageReadyTimer = () => {
    if (runtime.pageReadyTimer === null) return
    window.clearTimeout(runtime.pageReadyTimer)
    runtime.pageReadyTimer = null
  }

  const markPageReady = detail => {
    if (runtime.pageReadyMarked) return false
    runtime.pageReadyMarked = true
    clearPageReadyTimer()
    runtime.pageReady.resolve({ epoch: runtime.pageEpoch, detail })
    document.dispatchEvent(new CustomEvent('site:page-ready', {
      detail: { epoch: runtime.pageEpoch, ...(detail || {}) }
    }))
    return true
  }

  const schedulePageReadyFallback = () => {
    clearPageReadyTimer()
    if (runtime.pageReadyMarked) return

    if (currentPageMode() !== 'explicit') {
      nextFrame(() => markPageReady({ page: 'auto', reason: 'next-frame' }))
      return
    }

    runtime.pageReadyTimer = window.setTimeout(() => {
      warn('page initialization timed out; continuing')
      markPageReady({ page: 'fallback', reason: 'timeout' })
    }, pageReadyFallback)
  }

  const resetPageReady = () => {
    clearPageReadyTimer()
    runtime.pageEpoch += 1
    runtime.pageReady = createDeferred()
    runtime.pageReadyMarked = false
    schedulePageReadyFallback()
  }

  const finishOpening = (reason = 'ready', force = false) => {
    if (!bootState?.active || bootState.finished) return false
    bootState.finished = true
    if (bootState.fallbackTimer !== undefined) window.clearTimeout(bootState.fallbackTimer)

    const loader = document.getElementById('first-visit-loader')
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    const contentExitDuration = reducedMotion ? 80 : 170
    const layerExitDuration = reducedMotion ? 140 : 300
    const elapsed = Date.now() - (Number(bootState.startedAt) || Date.now())
    const delay = force ? 0 : Math.max(0, minimumVisible - elapsed)

    root.classList.add('is-site-ready')
    window.setTimeout(() => {
      if (!loader) {
        root.classList.remove('first-visit-pending', 'is-site-booting')
        return
      }

      loader.classList.add('is-exiting-content')
      window.setTimeout(() => {
        loader.classList.add('is-leaving')
        window.setTimeout(() => {
          root.classList.remove('first-visit-pending', 'is-site-booting')
          loader.remove()
        }, layerExitDuration)
      }, contentExitDuration)
    }, delay)

    if (reason !== 'ready' && reason !== 'pjax-navigation') warn(`opening ended via ${reason}`)
    return true
  }

  const beginInitialBoot = () => {
    if (runtime.initialStarted) return runtime.initialPromise || runtime.initialDeferred.promise
    runtime.initialStarted = true

    if (!bootState?.active) {
      runtime.initialDeferred.resolve({ skipped: true })
      return runtime.initialDeferred.promise
    }

    registerTask('dom-ready', waitForDom())
    registerTask('critical-styles', waitForCriticalStyles())
    registerTask('fonts-ready', waitForFonts())
    registerTask('background-video-frame', waitForVideoFrame())
    registerTask('critical-images', waitForCriticalImages())

    const allTasks = Promise.allSettled([
      ...runtime.tasks.values(),
      runtime.pageReady.promise
    ])
    const minimumTime = new Promise(resolve => {
      const elapsed = Date.now() - (Number(bootState.startedAt) || Date.now())
      window.setTimeout(resolve, Math.max(0, minimumVisible - elapsed))
    })

    runtime.initialPromise = Promise.allSettled([allTasks, minimumTime])
      .then(() => {
        finishOpening('ready')
        runtime.initialDeferred.resolve({ ready: true })
      })
      .catch(error => {
        warn('opening coordinator failed; continuing', error)
        finishOpening('coordinator-error', true)
        runtime.initialDeferred.resolve({ ready: false })
      })

    return runtime.initialPromise
  }

  const startInitialBoot = () => {
    if (!bootState?.active) {
      document.documentElement.classList.remove('first-visit-pending', 'is-site-booting')
      document.getElementById('first-visit-loader')?.remove()
      if (!runtime.initialStarted) {
        runtime.initialStarted = true
        runtime.initialDeferred.resolve({ skipped: true })
      }
      return runtime.initialDeferred.promise
    }

    if (document.readyState === 'loading' || document.readyState === 'interactive') {
      document.addEventListener('DOMContentLoaded', beginInitialBoot, { once: true })
      return runtime.initialDeferred.promise
    }
    return beginInitialBoot()
  }

  document.addEventListener('pjax:send', () => {
    runtime.pageAbortHandlers.forEach(abort => abort())
    if (bootState?.active && !bootState.finished) finishOpening('pjax-navigation', true)
    markPageReady({ page: 'leaving', reason: 'pjax-navigation' })
    resetPageReady()
  })

  document.addEventListener('pjax:complete', schedulePageReadyFallback)
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      root.classList.remove('first-visit-pending', 'is-site-booting')
      document.getElementById('first-visit-loader')?.remove()
      if (bootState) bootState.finished = true
    }
    schedulePageReadyFallback()
  })

  window.SiteReadiness = {
    registerTask,
    markPageReady,
    waitInitialReady: () => startInitialBoot(),
    waitForInitialReady: () => runtime.initialDeferred.promise,
    finishOpening: () => finishOpening('manual'),
    abort: reason => finishOpening(reason || 'aborted', true),
    waitForVideoFrame,
    get pageEpoch () { return runtime.pageEpoch }
  }

  schedulePageReadyFallback()
  startInitialBoot()
})()
