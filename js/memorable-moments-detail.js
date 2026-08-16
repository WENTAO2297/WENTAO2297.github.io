/**
 * @typedef {{photo: HTMLElement, source: HTMLImageElement}} GalleryPhoto
 * @typedef {{index: number, photos: HTMLElement[]}} LightboxState
 */
(() => {
  'use strict'

  if (window.MemorableMomentDetail) {
    window.MemorableMomentDetail.init()
    return
  }

  // Configuration and one reusable PJAX page instance.
  const rootSelector = '.memorable-moment-detail'
  const restoreStorageKey = 'memorable-moments:return'
  const viewStorageKey = 'memorable-moments:view'
  const restoreClassName = 'is-restoring-memorable-moments'
  const restoreVersion = 1
  const restoreMaxAgeMs = 30 * 60 * 1000
  const defaultGalleryGapPx = 12
  const lightboxSwipeThresholdPx = 44
  const runtime = {
    lifecycle: null,
    root: null,
    gallery: null,
    photos: [],
    rows: [],
    resizeObserver: null,
    rowObserver: null,
    motionQuery: null,
    motionHandler: null,
    reduced: false,
    lightbox: null,
    /** @type {HTMLElement[]} */
    lightboxPhotos: [],
    lightboxIndex: 0,
    pointerStartX: null,
    lastFocusedButton: null,
    backLink: null
  }
  let layoutFrame = null

  const addListener = (target, event, handler, options) => {
    return runtime.lifecycle?.addListener(target, event, handler, options)
  }

  const scheduleFrame = callback => {
    if (typeof window.requestAnimationFrame !== 'function') {
      callback()
      return null
    }
    const lifecycle = runtime.lifecycle
    if (!lifecycle) return null
    let frame
    frame = window.requestAnimationFrame(() => {
      lifecycle.removeFrame(frame)
      callback()
    })
    return lifecycle.addFrame(frame)
  }

  // Gallery measurement, row grouping, and coalesced layout.
  const scheduleLayout = () => {
    if (typeof window.requestAnimationFrame !== 'function') {
      layoutGallery()
      return
    }
    const lifecycle = runtime.lifecycle
    if (!lifecycle) return
    if (layoutFrame !== null) {
      window.cancelAnimationFrame(layoutFrame)
      lifecycle.removeFrame(layoutFrame)
    }
    layoutFrame = window.requestAnimationFrame(() => {
      lifecycle.removeFrame(layoutFrame)
      layoutFrame = null
      layoutGallery()
    })
    lifecycle.addFrame(layoutFrame)
  }

  const targetRowHeight = () => {
    if (window.innerWidth <= 430) return 170
    if (window.innerWidth <= 760) return 205
    return 240
  }

  const maxPhotosPerRow = () => {
    if (window.innerWidth <= 430) return 2
    if (window.innerWidth <= 900) return 3
    return 4
  }

  const galleryGap = () => {
    const value = Number.parseFloat(getComputedStyle(runtime.gallery).getPropertyValue('--gallery-gap'))
    return Number.isFinite(value) ? value : defaultGalleryGapPx
  }

  const photoRatio = photo => {
    const image = photo.querySelector('img')
    const naturalWidth = image?.naturalWidth || 0
    const naturalHeight = image?.naturalHeight || 0
    if (naturalWidth > 0 && naturalHeight > 0) {
      const ratio = naturalWidth / naturalHeight
      photo.dataset.photoRatio = String(ratio)
      return ratio
    }

    const cachedRatio = Number.parseFloat(photo.dataset.photoRatio)
    return Number.isFinite(cachedRatio) && cachedRatio > 0 ? cachedRatio : 1.5
  }

  const makeRows = (photos, availableWidth, desiredHeight, gap) => {
    const rows = []
    const maxPerRow = maxPhotosPerRow()
    let cursor = 0

    while (cursor < photos.length) {
      const row = []
      let ratioSum = 0

      while (cursor < photos.length) {
        const photo = photos[cursor]
        const ratio = photoRatio(photo)
        const projectedCount = row.length + 1
        const projectedRatio = ratioSum + ratio
        const projectedWidth = projectedRatio * desiredHeight + gap * (projectedCount - 1)

        if (row.length > 0 && projectedWidth > availableWidth) break

        row.push(photo)
        ratioSum = projectedRatio
        cursor += 1

        const isWideSingle = row.length === 1 && ratio * desiredHeight >= availableWidth * 0.92
        const reachesTarget = projectedWidth >= availableWidth * 0.96 && row.length >= 2
        if (isWideSingle || reachesTarget || row.length >= maxPerRow) break
      }

      rows.push(row)
    }

    return rows
  }

  const showRowImmediately = row => {
    row.classList.add('is-visible')
    runtime.rowObserver?.unobserve(row)
  }

  const observeRows = rows => {
    if (runtime.reduced || typeof window.IntersectionObserver !== 'function') {
      runtime.rowObserver?.disconnect()
      rows.forEach(showRowImmediately)
      return
    }

    if (!runtime.rowObserver) {
      runtime.rowObserver = new window.IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) showRowImmediately(entry.target)
        })
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })
      runtime.lifecycle?.addObserver(runtime.rowObserver)
    } else {
      runtime.rowObserver.disconnect()
    }

    rows.forEach(row => runtime.rowObserver.observe(row))
  }

  const layoutGallery = () => {
    const gallery = runtime.gallery
    if (!gallery || !gallery.isConnected || !runtime.photos.length) return

    const availableWidth = gallery.clientWidth
    if (!availableWidth) return

    const desiredHeight = targetRowHeight()
    const gap = galleryGap()
    const groups = makeRows(runtime.photos, availableWidth, desiredHeight, gap)
    const fragment = document.createDocumentFragment()
    const rows = []

    groups.forEach((group, index) => {
      const isLast = index === groups.length - 1
      const ratios = group.map(photoRatio)
      const ratioSum = ratios.reduce((sum, ratio) => sum + ratio, 0)
      const availableForImages = Math.max(1, availableWidth - gap * Math.max(0, group.length - 1))
      const calculatedRowHeight = group.length === 1
        ? Math.min(desiredHeight, availableForImages / Math.max(ratioSum, 0.01))
        : isLast
        ? Math.min(desiredHeight, availableForImages / Math.max(ratioSum, 0.01))
        : availableForImages / Math.max(ratioSum, 0.01)
      const rowHeight = Math.min(calculatedRowHeight, desiredHeight * 1.08)
      const naturalRowWidth = ratioSum * rowHeight + gap * Math.max(0, group.length - 1)
      const row = document.createElement('div')
      row.className = 'memorable-moment-detail__gallery-row'
      row.dataset.galleryRow = String(index)
      row.style.height = `${Math.max(1, rowHeight)}px`
      row.style.justifyContent = group.length === 1 ? 'center' : 'flex-start'

      group.forEach((photo, photoIndex) => {
        photo.style.width = `${Math.max(1, ratios[photoIndex] * rowHeight)}px`
        photo.style.height = `${Math.max(1, rowHeight)}px`
        row.append(photo)
      })

      // Keep the final row and height-capped mixed rows at their natural width.
      if ((isLast || rowHeight < calculatedRowHeight) && group.length > 1 && naturalRowWidth < availableWidth - 1) {
        row.style.width = `${naturalRowWidth}px`
        row.style.marginInline = 'auto'
      }
      rows.push(row)
      fragment.append(row)
    })

    gallery.replaceChildren(fragment)
    runtime.rows = rows
    observeRows(rows)
  }

  // Lightbox state and controls are derived from the current gallery DOM.
  const currentPhoto = () => runtime.lightboxPhotos[runtime.lightboxIndex]

  const updateLightbox = () => {
    const lightbox = runtime.lightbox
    const photo = currentPhoto()
    if (!lightbox || !photo) return

    const source = photo.querySelector('img')
    const image = lightbox.querySelector('.moment-detail-lightbox__image')
    const caption = lightbox.querySelector('.moment-detail-lightbox__caption')
    const counter = lightbox.querySelector('.moment-detail-lightbox__counter')
    const previous = lightbox.querySelector('.moment-detail-lightbox__button--previous')
    const next = lightbox.querySelector('.moment-detail-lightbox__button--next')
    image.src = source.currentSrc || source.src
    image.alt = source.alt || ''
    caption.textContent = photo.querySelector('figcaption')?.textContent?.trim() || ''
    caption.hidden = !caption.textContent
    lightbox.classList.toggle('has-caption', !caption.hidden)
    const disabled = runtime.lightboxPhotos.length < 2
    previous.disabled = disabled
    next.disabled = disabled
    previous.hidden = disabled
    next.hidden = disabled
    counter.textContent = `${runtime.lightboxIndex + 1} / ${runtime.lightboxPhotos.length}`
    lightbox.setAttribute('aria-label', `${runtime.lightboxIndex + 1} of ${runtime.lightboxPhotos.length}`)
  }

  const closeLightbox = () => {
    const lightbox = runtime.lightbox
    if (!lightbox) return
    lightbox.hidden = true
    lightbox.classList.remove('is-open')
    document.body.classList.remove('moment-detail-lightbox-open')
    runtime.pointerStartX = null
    const lastFocusedButton = runtime.lastFocusedButton
    runtime.lastFocusedButton = null
    if (lastFocusedButton?.isConnected) lastFocusedButton.focus({ preventScroll: true })
  }

  const openLightbox = photo => {
    if (!runtime.lightbox || photo.classList.contains('is-image-failed')) return
    runtime.lightboxPhotos = runtime.photos.filter(item => !item.classList.contains('is-image-failed'))
    runtime.lightboxIndex = Math.max(0, runtime.lightboxPhotos.indexOf(photo))
    runtime.lastFocusedButton = photo.querySelector('button')
    runtime.lightbox.hidden = false
    runtime.lightbox.classList.add('is-open')
    document.body.classList.add('moment-detail-lightbox-open')
    updateLightbox()
    runtime.lightbox.querySelector('.moment-detail-lightbox__button--close')?.focus({ preventScroll: true })
  }

  const stepLightbox = direction => {
    if (!runtime.lightboxPhotos.length) return
    runtime.lightboxIndex = (runtime.lightboxIndex + direction + runtime.lightboxPhotos.length) % runtime.lightboxPhotos.length
    updateLightbox()
  }

  const buildLightbox = () => {
    const shell = document.createElement('div')
    shell.className = 'moment-detail-lightbox'
    shell.hidden = true
    shell.setAttribute('role', 'dialog')
    shell.setAttribute('aria-modal', 'true')
    shell.setAttribute('aria-label', 'Photo preview')

    const backdrop = document.createElement('div')
    backdrop.className = 'moment-detail-lightbox__backdrop'
    const content = document.createElement('div')
    content.className = 'moment-detail-lightbox__content'
    const image = document.createElement('img')
    image.className = 'moment-detail-lightbox__image'
    image.alt = ''
    const caption = document.createElement('p')
    caption.className = 'moment-detail-lightbox__caption'
    const counter = document.createElement('span')
    counter.className = 'moment-detail-lightbox__counter'
    counter.setAttribute('aria-live', 'polite')
    const close = document.createElement('button')
    close.className = 'moment-detail-lightbox__button moment-detail-lightbox__button--close'
    close.type = 'button'
    close.setAttribute('aria-label', 'Close photo preview')
    close.textContent = '×'
    const previous = document.createElement('button')
    previous.className = 'moment-detail-lightbox__button moment-detail-lightbox__button--previous'
    previous.type = 'button'
    previous.setAttribute('aria-label', 'Previous photo')
    previous.textContent = '‹'
    const next = document.createElement('button')
    next.className = 'moment-detail-lightbox__button moment-detail-lightbox__button--next'
    next.type = 'button'
    next.setAttribute('aria-label', 'Next photo')
    next.textContent = '›'

    content.append(image, caption, counter)
    shell.append(backdrop, content, close, previous, next)
    document.body.append(shell)
    runtime.lightbox = shell

    const bind = (target, event, handler, options) => {
      addListener(target, event, handler, options)
    }

    bind(backdrop, 'click', closeLightbox)
    bind(close, 'click', closeLightbox)
    bind(previous, 'click', () => stepLightbox(-1))
    bind(next, 'click', () => stepLightbox(1))
    bind(content, 'pointerdown', event => {
      runtime.pointerStartX = event.clientX
    })
    bind(content, 'pointerup', event => {
      if (runtime.pointerStartX === null) return
      const delta = event.clientX - runtime.pointerStartX
      runtime.pointerStartX = null
      if (Math.abs(delta) < lightboxSwipeThresholdPx) return
      stepLightbox(delta > 0 ? -1 : 1)
    })
    bind(document, 'keydown', event => {
      if (shell.hidden) return
      if (event.key === 'Escape') closeLightbox()
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        stepLightbox(-1)
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        stepLightbox(1)
      }
    })
  }

  const bindPhotos = photos => {
    photos.forEach(photo => {
      const button = photo.querySelector('button')
      const image = photo.querySelector('img')
      if (!button || !image) return

      const clickHandler = () => openLightbox(photo)
      const loadHandler = () => {
        photo.classList.remove('is-image-failed')
        scheduleLayout()
      }
      const errorHandler = () => {
        photo.classList.add('is-image-failed')
        scheduleLayout()
      }
      addListener(button, 'click', clickHandler)
      addListener(image, 'load', loadHandler)
      addListener(image, 'error', errorHandler)

      if (image.complete) {
        if (image.naturalWidth) loadHandler()
        else if (image.src) errorHandler()
      }
    })
  }

  /** Resolve after an image load/error and optional decode have settled. */
  const waitForImageReady = image => new Promise(resolve => {
    let settled = false
    let removeLoad = null
    let removeError = null
    const finish = success => {
      if (settled) return
      settled = true
      removeLoad?.()
      removeError?.()
      const decoded = success && typeof image.decode === 'function'
        ? image.decode().catch(() => {})
        : Promise.resolve()
      decoded.then(resolve)
    }

    const loadHandler = () => finish(true)
    const errorHandler = () => finish(false)
    removeLoad = addListener(image, 'load', loadHandler)
    removeError = addListener(image, 'error', errorHandler)
    runtime.lifecycle?.addCleanup(() => finish(false))

    if (image.complete) {
      if (image.naturalWidth > 0) finish(true)
      else finish(false)
    }
  })

  const revealGalleryWhenReady = root => {
    const gallery = runtime.gallery
    if (!gallery || !runtime.photos.length) return

    Promise.allSettled(runtime.photos.map(photo => waitForImageReady(photo.querySelector('img')))).then(() => {
      if (runtime.root !== root || !root.isConnected || runtime.gallery !== gallery) return
      const reveal = () => {
        if (runtime.root !== root || !root.isConnected || runtime.gallery !== gallery) return
        gallery.dataset.galleryState = 'ready'
        gallery.removeAttribute('aria-busy')
        scheduleLayout()
      }
      if (runtime.reduced || typeof window.requestAnimationFrame !== 'function') reveal()
      else scheduleFrame(reveal)
    })
  }

  // Return target updates and detail-page navigation.
  const getDetailSlugFromUrl = href => {
    try {
      const url = new URL(href, window.location.href)
      const marker = '/memorable-moments/'
      const start = url.pathname.indexOf(marker)
      if (start < 0) return ''
      const slug = url.pathname.slice(start + marker.length).replace(/^\/|\/$/g, '')
      return slug && !slug.includes('/') ? decodeURIComponent(slug) : ''
    } catch {
      return ''
    }
  }

  const setRestoreClass = active => {
    document.documentElement.classList.toggle(restoreClassName, Boolean(active))
  }

  const normalizeViewMode = value => value === 'grid' ? 'grid' : 'timeline'

  const readStoredViewMode = () => {
    try {
      return normalizeViewMode(window.sessionStorage.getItem(viewStorageKey))
    } catch {
      return 'timeline'
    }
  }

  const discardReturnState = () => {
    try {
      window.sessionStorage.removeItem(restoreStorageKey)
    } catch {}
    setRestoreClass(false)
  }

  const readReturnState = () => {
    try {
      const value = JSON.parse(window.sessionStorage.getItem(restoreStorageKey) || 'null')
      if (!value || typeof value !== 'object') return null
      const savedAt = Number(value.savedAt)
      if (!value.slug || !Number.isFinite(savedAt) || Date.now() - savedAt > restoreMaxAgeMs) {
        discardReturnState()
        return null
      }
      return {
        version: Number(value.version) || restoreVersion,
        pending: value.pending === true,
        source: String(value.source || 'moment-detail'),
        slug: String(value.slug),
        loadedCount: Math.max(1, Number(value.loadedCount) || 1),
        scrollY: Number(value.scrollY) || 0,
        viewportOffset: Number(value.viewportOffset) || 120,
        viewMode: normalizeViewMode(value.viewMode || readStoredViewMode()),
        savedAt
      }
    } catch {
      discardReturnState()
      return null
    }
  }

  const writeReturnState = state => {
    if (!state?.slug) return null
    const nextState = {
      version: restoreVersion,
      pending: state.pending === true,
      source: 'moment-detail',
      slug: String(state.slug),
      loadedCount: Math.max(1, Number(state.loadedCount) || 1),
      scrollY: Number(state.scrollY) || 0,
      viewportOffset: Number.isFinite(Number(state.viewportOffset)) ? Number(state.viewportOffset) : 120,
      viewMode: normalizeViewMode(state.viewMode || readStoredViewMode()),
      savedAt: Date.now()
    }
    try {
      window.sessionStorage.setItem(restoreStorageKey, JSON.stringify(nextState))
    } catch {}
    return nextState
  }

  const updateReturnTarget = slug => {
    if (!slug) return
    const state = writeReturnState({ ...readReturnState(), slug, pending: false })
    if (state) setRestoreClass(true)
    return state
  }

  const bindPagerLinks = root => {
    root?.querySelectorAll('.memorable-moment-detail__pager-link[href]').forEach(link => {
      const handler = event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

        const targetSlug = getDetailSlugFromUrl(link.href)
        if (!targetSlug) return

        updateReturnTarget(targetSlug)
      }

      addListener(link, 'click', handler, true)
    })
  }

  const bindBrowserBackIntent = root => {
    window.__memorableMomentActiveSlug = root.dataset.momentSlug || ''
    if (window.__memorableMomentBackIntentBound) return

    const handler = () => {
      const path = window.location.pathname.replace(/\/+$/, '')
      const slug = String(window.__memorableMomentActiveSlug || '')
      if (path !== '/memorable-moments' || !slug) return
      const state = writeReturnState({ ...readReturnState(), slug, pending: true })
      if (state) setRestoreClass(true)
    }

    window.addEventListener('popstate', handler, true)
    window.__memorableMomentBackIntentBound = true
  }

  const bindBackLink = root => {
    const link = root?.querySelector('[data-detail-back]')
    if (!link) return

    const handler = event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      event.preventDefault()
      try {
        const currentSlug = root.dataset.momentSlug || ''
        writeReturnState({ ...readReturnState(), slug: currentSlug, pending: true })
        setRestoreClass(true)

        const url = new URL(link.href, window.location.href)
        url.hash = ''
        if (window.pjax?.loadUrl) window.pjax.loadUrl(url.href)
        else window.location.assign(url.href)
      } catch {
        window.location.assign('/memorable-moments/')
      }
    }

    addListener(link, 'click', handler, true)
    runtime.backLink = link
  }

  // PJAX/BFCache cleanup is idempotent and restores body scroll on every exit.
  const cleanup = () => {
    closeLightbox()
    runtime.lifecycle?.destroy()
    runtime.lifecycle = null
    layoutFrame = null
    runtime.resizeObserver = null
    runtime.rowObserver = null
    runtime.lightbox?.remove()
    runtime.root = null
    runtime.gallery = null
    runtime.photos = []
    runtime.rows = []
    runtime.lightbox = null
    runtime.lightboxPhotos = []
    runtime.motionQuery = null
    runtime.motionHandler = null
    runtime.reduced = false
    runtime.pointerStartX = null
    runtime.lastFocusedButton = null
    runtime.backLink = null
  }

  const initializeMemorableMomentDetailPage = () => {
    const root = document.querySelector(rootSelector)
    if (!root) {
      cleanup()
      window.__memorableMomentActiveSlug = ''
      if (!document.querySelector('.memorable-moments')) setRestoreClass(false)
      return false
    }
    const returnState = readReturnState()
    setRestoreClass(Boolean(returnState))
    if (runtime.root === root && root.dataset.momentDetailInitialized === 'true') return true

    cleanup()
    const lifecycle = window.SitePageRuntime?.create?.({ name: 'memorable-moment-detail' })
    if (!lifecycle) return false
    runtime.lifecycle = lifecycle
    runtime.root = root
    runtime.gallery = root.querySelector('.memorable-moment-detail__gallery')
    runtime.photos = runtime.gallery ? Array.from(runtime.gallery.querySelectorAll('.memorable-moment-detail__photo')) : []
    runtime.photos.forEach(photo => {
      const image = photo.querySelector('img')
      if (image) image.loading = 'eager'
    })
    root.dataset.momentDetailInitialized = 'true'
    bindBackLink(root)
    bindPagerLinks(root)
    bindBrowserBackIntent(root)
    buildLightbox()
    bindPhotos(runtime.photos)

    runtime.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    runtime.reduced = runtime.motionQuery.matches
    runtime.motionHandler = () => {
      runtime.reduced = runtime.motionQuery.matches
      if (runtime.reduced) {
        if (runtime.gallery) {
          runtime.gallery.dataset.galleryState = 'ready'
          runtime.gallery.removeAttribute('aria-busy')
        }
        runtime.rows.forEach(showRowImmediately)
      }
      else scheduleLayout()
    }
    addListener(runtime.motionQuery, 'change', runtime.motionHandler)

    if (runtime.gallery && typeof window.ResizeObserver === 'function') {
      runtime.resizeObserver = new window.ResizeObserver(scheduleLayout)
      runtime.lifecycle.addObserver(runtime.resizeObserver)
      runtime.resizeObserver.observe(runtime.gallery)
    } else {
      addListener(window, 'resize', scheduleLayout, { passive: true })
    }

    if (runtime.gallery && runtime.reduced) {
      runtime.gallery.dataset.galleryState = 'ready'
      runtime.gallery.removeAttribute('aria-busy')
    } else {
      revealGalleryWhenReady(root)
    }
    if (!runtime.gallery || !runtime.photos.length) {
    }
    scheduleLayout()
    return true
  }

  window.MemorableMomentDetail = { init: initializeMemorableMomentDetailPage, cleanup }
  initializeMemorableMomentDetailPage()

  if (!window.memorableMomentDetailPjaxBound) {
    window.memorableMomentDetailPjaxBound = true
    document.addEventListener('pjax:send', cleanup)
    document.addEventListener('pjax:complete', initializeMemorableMomentDetailPage)
    document.addEventListener('pjax:error', () => {
      cleanup()
      setRestoreClass(false)
    })
    window.addEventListener('pageshow', event => {
      if (event.persisted) cleanup()
      initializeMemorableMomentDetailPage()
    })
  }
})()
