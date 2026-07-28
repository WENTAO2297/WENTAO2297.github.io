(() => {
  'use strict'

  if (window.SitePrefetch) return

  const warningPrefix = '[Site Prefetch]'
  const maxDocuments = 28
  const maxAssets = 72
  const runtime = {
    documentPromises: new Map(),
    assetPromises: new Map(),
    queue: [],
    activeCount: 0,
    maxConcurrency: 2,
    sequence: 0,
    observer: null,
    backgroundUrls: new Set(),
    aboutBannerDispose: null
  }

  const warn = (message, details) => {
    if (details === undefined) console.warn(warningPrefix, message)
    else console.warn(warningPrefix, message, details)
  }

  const connection = () => navigator.connection || navigator.mozConnection || navigator.webkitConnection || null
  const effectiveType = () => String(connection()?.effectiveType || '').toLowerCase()
  const saveDataEnabled = () => Boolean(connection()?.saveData)
  const isSlowConnection = () => ['slow-2g', '2g'].includes(effectiveType())
  const isThreeG = () => effectiveType() === '3g'

  const updateConcurrency = () => {
    runtime.maxConcurrency = saveDataEnabled() || isSlowConnection() || isThreeG() ? 1 : 2
  }

  const normalizeUrl = value => {
    try {
      const url = new URL(value, window.location.href)
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== window.location.origin) return null
      url.hash = ''
      return url
    } catch {
      return null
    }
  }

  const isFileLike = pathname => /\.(?:zip|rar|7z|pdf|docx?|xlsx?|pptx?|mp4|webm|mov|mp3|wav|gif)(?:$|\/)/i.test(pathname)

  const getLinkUrl = link => {
    if (!(link instanceof Element) || link.tagName !== 'A') return null
    if (!link.hasAttribute('href') || link.target === '_blank' || link.hasAttribute('download')) return null
    if (link.hasAttribute('data-no-prefetch') || link.hasAttribute('data-no-pjax')) return null
    if (/^(?:mailto:|tel:|javascript:)/i.test(link.getAttribute('href') || '')) return null

    const url = normalizeUrl(link.href)
    if (!url || isFileLike(url.pathname)) return null

    const current = normalizeUrl(window.location.href)
    if (!current || (url.pathname === current.pathname && url.search === current.search)) return null
    if (/\/(?:admin|wp-admin|api)(?:\/|$)/i.test(url.pathname)) return null
    return url
  }

  const collectLinks = () => Array.from(document.querySelectorAll('a[href]'))
    .map(link => ({ link, url: getLinkUrl(link) }))
    .filter(item => item.url)

  const trimCache = (cache, limit) => {
    if (cache.size <= limit) return
    const removable = Array.from(cache.entries())
      .filter(([, entry]) => entry.status === 'done')
      .sort(([, first], [, second]) => first.usedAt - second.usedAt)
    while (cache.size > limit && removable.length) cache.delete(removable.shift()[0])
  }

  const pump = () => {
    updateConcurrency()
    while (runtime.activeCount < runtime.maxConcurrency && runtime.queue.length) {
      runtime.queue.sort((first, second) => first.priority - second.priority || first.sequence - second.sequence)
      const task = runtime.queue.shift()
      if (task.status !== 'queued') continue
      task.status = 'active'
      runtime.activeCount += 1

      Promise.resolve()
        .then(task.run)
        .catch(error => ({ ok: false, error }))
        .then(result => {
          task.status = 'done'
          task.entry.status = 'done'
          task.entry.usedAt = Date.now()
          task.entry.failedAt = result?.ok === false ? Date.now() : 0
          task.resolve(result || { ok: false })
          runtime.activeCount -= 1
          trimCache(task.cache, task.limit)
          pump()
        })
    }
  }

  const schedule = (cache, key, run, priority, limit) => {
    const existing = cache.get(key)
    if (existing) {
      if (!existing.failedAt || Date.now() - existing.failedAt <= 60000) {
        existing.usedAt = Date.now()
        if (existing.task?.status === 'queued') existing.task.priority = Math.min(existing.task.priority, priority)
        pump()
        return existing.promise
      }
      cache.delete(key)
    }

    let resolve
    const promise = new Promise(nextResolve => { resolve = nextResolve })
    const entry = { promise, status: 'queued', usedAt: Date.now(), failedAt: 0, task: null }
    const task = {
      cache,
      limit,
      key,
      priority,
      sequence: runtime.sequence++,
      status: 'queued',
      entry,
      resolve,
      run
    }
    entry.task = task
    cache.set(key, entry)
    runtime.queue.push(task)
    pump()
    return promise
  }

  const extractCriticalAssets = html => {
    const assets = []
    try {
      const document = new DOMParser().parseFromString(html, 'text/html')
      document.querySelectorAll('[data-boot-critical], [data-first-visit-critical], [data-page-critical-asset]')
        .forEach(element => {
          const source = element.getAttribute('src') || element.getAttribute('content')
          const url = source ? normalizeUrl(source) : null
          if (url && !assets.includes(url.href)) assets.push(url.href)
        })
    } catch (error) {
      warn('critical asset manifest parse failed; using HTML cache only', error)
    }
    return assets
  }

  const preloadAsset = (value, { priority = 0 } = {}) => {
    const url = normalizeUrl(value)
    if (!url) return Promise.resolve({ ok: false })

    return schedule(runtime.assetPromises, url.href, () => new Promise(resolve => {
      const image = new Image()
      let settled = false
      const finish = ok => {
        if (settled) return
        settled = true
        image.onload = null
        image.onerror = null
        if (!ok) {
          warn('critical asset preload failed; continuing', url.href)
          resolve({ ok: false })
          return
        }
        Promise.resolve(typeof image.decode === 'function' ? image.decode() : undefined)
          .catch(() => {})
          .then(() => resolve({ ok: true }))
      }
      image.decoding = 'async'
      image.onload = () => finish(true)
      image.onerror = () => finish(false)
      image.src = url.href
      if (image.complete) finish(image.naturalWidth > 0)
    }), priority, maxAssets)
  }

  const preloadAssets = (values, options = {}) => {
    const urls = Array.from(new Set((Array.isArray(values) ? values : [values])
      .map(value => normalizeUrl(value)?.href)
      .filter(Boolean)))

    return Promise.allSettled(urls.map(async url => {
      const result = await preloadAsset(url, options)
      if (!result?.ok) throw new Error(`Failed to preload ${url}`)
      return result
    }))
  }

  const assetLimitFor = intent => {
    if (intent === 'intent' && isSlowConnection()) return 0
    if (isSlowConnection() || saveDataEnabled()) return 0
    if (isThreeG()) return 2
    return intent === 'intent' ? 8 : 4
  }

  const prefetchDocument = (value, { priority = 2, intent = 'background' } = {}) => {
    const url = normalizeUrl(value)
    if (!url) return Promise.resolve({ ok: false })
    const assetLimit = assetLimitFor(intent)

    const documentPromise = schedule(runtime.documentPromises, url.href, async () => {
      const response = await fetch(url.href, {
        credentials: 'same-origin',
        cache: 'force-cache',
        headers: { Accept: 'text/html' }
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const contentType = response.headers.get('content-type') || ''
      if (contentType && !/text\/html/i.test(contentType)) throw new Error(`Unexpected content type: ${contentType}`)
      const html = await response.text()
      return { ok: true, assets: assetLimit ? extractCriticalAssets(html).slice(0, assetLimit) : [] }
    }, priority, maxDocuments)

    return documentPromise.then(result => {
      if (result?.ok && Array.isArray(result.assets)) {
        result.assets.forEach(asset => { preloadAsset(asset, { priority }) })
      }
      return result
    })
  }

  const prefetchLink = (link, priority, intent = 'background') => {
    const url = getLinkUrl(link)
    if (!url) return Promise.resolve({ ok: false })
    if (intent === 'background' && runtime.backgroundUrls.size >= 8 && !runtime.backgroundUrls.has(url.href)) return Promise.resolve({ ok: false })
    if (intent === 'background') runtime.backgroundUrls.add(url.href)
    window.MemorableMoments?.preheatForUrl?.(url.href, { priority, intent })
    return prefetchDocument(url.href, { priority, intent })
  }

  const refreshObserver = () => {
    runtime.observer?.disconnect()
    runtime.observer = null
    updateConcurrency()
    if (saveDataEnabled() || isSlowConnection() || typeof window.IntersectionObserver !== 'function') return

    runtime.observer = new window.IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return
        const link = entry.target
        runtime.observer?.unobserve(link)
        prefetchLink(link, 1, 'background')
      })
    }, { rootMargin: '180px 0px', threshold: 0.01 })

    collectLinks().forEach(({ link }) => runtime.observer.observe(link))
  }

  const scheduleIdlePrefetch = () => {
    if (saveDataEnabled() || isSlowConnection()) return
    const run = () => {
      collectLinks().slice(0, 4).forEach(({ link }) => prefetchLink(link, 2, 'background'))
    }
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 3500 })
    else window.setTimeout(run, 1200)
  }

  const scheduleBackgroundWork = () => {
    const start = () => {
      runtime.backgroundUrls.clear()
      refreshObserver()
      scheduleIdlePrefetch()
    }
    window.SiteReadiness?.waitForInitialReady?.().then(start).catch(start)
  }

  const aboutBannerTimeout = 1200
  const prepareAboutBanner = () => {
    runtime.aboutBannerDispose?.()
    runtime.aboutBannerDispose = null

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
      if (timeout === null) return
      window.clearTimeout(timeout)
      timeout = null
    }
    const markReady = async () => {
      if (disposed || ready || image.naturalWidth === 0) return
      try { await image.decode?.() } catch {}
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
    function handleLoad () { markReady() }
    function handleError () {
      clearTimeoutFallback()
      removeListeners()
      markFallback()
    }

    setState('loading')
    image.addEventListener('load', handleLoad)
    image.addEventListener('error', handleError)
    timeout = window.setTimeout(markFallback, aboutBannerTimeout)
    if (image.complete) image.naturalWidth > 0 ? markReady() : handleError()

    runtime.aboutBannerDispose = () => {
      disposed = true
      clearTimeoutFallback()
      removeListeners()
      banner.removeAttribute('aria-busy')
    }
  }

  const handleIntent = (event, intent) => {
    const link = event.target?.closest?.('a[href]')
    if (!link) return
    prefetchLink(link, 0, intent)
  }

  document.addEventListener('pointerover', event => {
    if (event.relatedTarget && event.target?.closest?.('a[href]')?.contains(event.relatedTarget)) return
    handleIntent(event, 'intent')
  }, { capture: true, passive: true })
  document.addEventListener('focusin', event => handleIntent(event, 'intent'))
  document.addEventListener('pointerdown', event => handleIntent(event, 'intent'), { capture: true, passive: true })
  document.addEventListener('touchstart', event => handleIntent(event, 'intent'), { capture: true, passive: true })
  document.addEventListener('pjax:complete', () => {
    scheduleBackgroundWork()
    prepareAboutBanner()
  })
  document.addEventListener('site:page-ready', scheduleBackgroundWork)
  document.addEventListener('pjax:send', () => {
    runtime.observer?.disconnect()
    runtime.aboutBannerDispose?.()
  })
  window.addEventListener('pageshow', prepareAboutBanner)

  window.SitePrefetch = {
    preloadAsset,
    preloadAssets,
    prefetchDocument,
    prefetch: prefetchDocument,
    prefetchLink,
    refresh: scheduleBackgroundWork,
    getState: () => ({
      documentCount: runtime.documentPromises.size,
      assetCount: runtime.assetPromises.size,
      activeCount: runtime.activeCount,
      maxConcurrency: runtime.maxConcurrency
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleBackgroundWork, { once: true })
  } else {
    scheduleBackgroundWork()
  }
  prepareAboutBanner()
})()
