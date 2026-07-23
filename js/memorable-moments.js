(() => {
  'use strict'

  if (window.MemorableMoments) {
    window.MemorableMoments.init()
    return
  }

  // Configuration: one source of truth for list loading, motion, view switching, and restore.
  const rootSelector = '.memorable-moments'
  const viewContentSelector = '.memorable-moments__view-content'
  const VIEW_MODE = Object.freeze({
    TIMELINE: 'timeline',
    GRID: 'grid'
  })
  const LOAD_CONFIG = Object.freeze({
    initial: 3,
    batch: 2,
    rootMargin: '0px 0px 360px 0px',
    scrollActivationY: 24
  })
  const TIMELINE_ANIMATION = Object.freeze({
    cardThreshold: 0.15,
    cardRootMargin: '0px 0px -8% 0px',
    cardDuration: 520,
    nodeDuration: 460,
    cardStagger: 80,
    nodeLead: 60,
    lineDuration: 620,
    extensionDuration: 480,
    statusDuration: 620,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
  })
  const GRID_ANIMATION = Object.freeze({
    duration: 500,
    rowDelay: 100,
    itemDelay: 30,
    rowTolerance: 6,
    bufferTop: 100,
    bufferBottom: 120,
    desktopOffset: 16,
    mobileOffset: 12
  })
  const VIEW_SWITCH_ANIMATION = Object.freeze({
    leaveDuration: 160,
    enterDuration: 240
  })
  const HERO_ANIMATION = Object.freeze({
    titleDuration: 440,
    titleOffset: 8,
    switchDuration: 360,
    switchDelay: 120,
    switchOffset: 8
  })
  const RESTORE_CONFIG = Object.freeze({
    storageKey: 'memorable-moments:return',
    className: 'is-restoring-memorable-moments',
    detailNavigationClass: 'is-memorable-moments-detail-navigation',
    historyKey: '__memorableMomentsReturnMarker',
    version: 1,
    maxAge: 30 * 60 * 1000,
    guardTimeout: 800,
    targetDuration: 360,
    positionTolerance: 8
  })
  const VIEW_STORAGE_KEY = 'memorable-moments:view'

  const { initial: initialCount, batch: batchSize, rootMargin: loadRootMargin, scrollActivationY } = LOAD_CONFIG
  const { cardThreshold, cardRootMargin, cardDuration: cardEntryDuration, nodeDuration: nodeEntryDuration,
    cardStagger: cardEntryStagger, nodeLead: nodeEntryLead, lineDuration, extensionDuration, statusDuration,
    easing: entryEasing } = TIMELINE_ANIMATION
  const { duration: gridRevealDuration, rowDelay: gridRowDelay, itemDelay: gridItemDelay,
    rowTolerance: gridRevealTolerance, bufferTop: restoreRevealBufferTop, bufferBottom: restoreRevealBufferBottom,
    desktopOffset: gridDesktopOffset, mobileOffset: gridMobileOffset } = GRID_ANIMATION
  const { leaveDuration: viewFadeOutDuration, enterDuration: viewFadeInDuration } = VIEW_SWITCH_ANIMATION
  const { storageKey: restoreStorageKey, className: restoreClassName, detailNavigationClass,
    historyKey: restoreHistoryKey,
    version: restoreVersion, maxAge: restoreMaxAge, guardTimeout: restoreGuardLimit,
    targetDuration: returnTargetDuration, positionTolerance: restorePositionTolerance } = RESTORE_CONFIG

  const reportRestoreWarning = (reason, details = {}) => {
    console.warn('[Memorable Moments] restore warning', reason, details)
  }
  // Runtime state: one instance is reused across PJAX page replacements.
  const runtime = {
    root: null,
    items: [],
    cursor: 0,
    animations: new Set(),
    cardHandlers: [],
    imageHandlers: [],
    timers: new Set(),
    frames: new Set(),
    loadObserver: null,
    cardObserver: null,
    sentinel: null,
    scrollHandler: null,
    sentinelIntersecting: false,
    hasScrolled: false,
    loading: false,
    loadingEpoch: 0,
    motionQuery: null,
    motionHandler: null,
    reduced: false,
    generation: 0,
    restoreState: null,
    restoreGuardTimer: null,
    revealTarget: null,
    heroEntranceTargets: new Set(),
    viewMode: VIEW_MODE.TIMELINE,
    viewSwitching: false
  }

  // Return state: sessionStorage holds the complete transaction; history only carries a marker.
  const setRestoreClass = active => {
    document.documentElement.classList.toggle(restoreClassName, Boolean(active))
  }

  const setDetailNavigationClass = active => {
    document.documentElement.classList.toggle(detailNavigationClass, Boolean(active))
  }

  const skipPageMotionForRestore = root => {
    if (!runtime.restoreState || !root?.querySelector('.memorable-moments')) return
    window.PageMotion?.cleanup?.()
  }

  const clearRevealState = root => {
    runtime.revealTarget?.classList.remove('is-return-target')
    root?.querySelectorAll('.moment-item.is-return-target').forEach(item => item.classList.remove('is-return-target'))
    runtime.revealTarget = null
  }

  const cancelRestoreGuard = () => {
    if (!runtime.restoreGuardTimer) return
    window.clearTimeout(runtime.restoreGuardTimer)
    runtime.timers.delete(runtime.restoreGuardTimer)
    runtime.restoreGuardTimer = null
  }

  const track = animation => {
    runtime.animations.add(animation)
    animation.finished.catch(() => {}).finally(() => runtime.animations.delete(animation))
    return animation
  }

  const scheduleFrame = callback => {
    if (typeof window.requestAnimationFrame !== 'function') {
      callback()
      return null
    }
    const frame = window.requestAnimationFrame(() => {
      runtime.frames.delete(frame)
      callback()
    })
    runtime.frames.add(frame)
    return frame
  }

  const scheduleTimer = (callback, delay) => {
    const timer = window.setTimeout(() => {
      runtime.timers.delete(timer)
      callback()
    }, delay)
    runtime.timers.add(timer)
    return timer
  }

  const clearHeroBootClass = () => {
    document.documentElement.classList.remove('is-memorable-moments-hero-pending')
  }

  const clearHeroEntrance = () => {
    runtime.heroEntranceTargets.forEach(element => {
      element.style.removeProperty('opacity')
      element.style.removeProperty('transform')
    })
    runtime.heroEntranceTargets.clear()
  }

  const prepareHeroEntrance = root => {
    clearHeroEntrance()
    const title = root.querySelector('.memorable-moments__title')
    const viewSwitch = root.querySelector('.memorable-moments__view-switch')
    const targets = []
    if (title) {
      title.style.opacity = '0'
      title.style.transform = `translate3d(0, ${HERO_ANIMATION.titleOffset}px, 0)`
      runtime.heroEntranceTargets.add(title)
      targets.push({
        element: title,
        duration: HERO_ANIMATION.titleDuration,
        delay: 0,
        offset: HERO_ANIMATION.titleOffset
      })
    }
    if (viewSwitch) {
      viewSwitch.style.opacity = '0'
      viewSwitch.style.transform = `translate3d(0, ${HERO_ANIMATION.switchOffset}px, 0)`
      runtime.heroEntranceTargets.add(viewSwitch)
      targets.push({
        element: viewSwitch,
        duration: HERO_ANIMATION.switchDuration,
        delay: HERO_ANIMATION.switchDelay,
        offset: HERO_ANIMATION.switchOffset
      })
    }
    return targets
  }

  const playHeroEntrance = (targets, generation = runtime.generation) => {
    Array.from(targets || []).forEach(({ element, duration, delay, offset }) => {
      if (!element?.isConnected) return
      try {
        const animation = track(element.animate([
          { opacity: 0, transform: `translate3d(0, ${offset}px, 0)` },
          { opacity: 1, transform: 'translate3d(0, 0, 0)' }
        ], {
          duration,
          delay,
          easing: entryEasing,
          fill: 'both'
        }))
        animation.finished.then(() => {
          if (runtime.generation !== generation) return
          element.style.removeProperty('opacity')
          element.style.removeProperty('transform')
          runtime.heroEntranceTargets.delete(element)
          animation.cancel()
        }).catch(() => {})
      } catch {
        element.style.removeProperty('opacity')
        element.style.removeProperty('transform')
        runtime.heroEntranceTargets.delete(element)
      }
    })
  }

  const normalizeViewMode = value => value === VIEW_MODE.GRID ? VIEW_MODE.GRID : VIEW_MODE.TIMELINE

  const readStoredViewMode = () => {
    try {
      return normalizeViewMode(window.sessionStorage.getItem(VIEW_STORAGE_KEY))
    } catch {
      return VIEW_MODE.TIMELINE
    }
  }

  const persistViewMode = mode => {
    try {
      window.sessionStorage.setItem(VIEW_STORAGE_KEY, normalizeViewMode(mode))
    } catch {}
  }

  const updateViewControls = (root, mode, announce = false) => {
    const viewSwitch = root.querySelector('.memorable-moments__view-switch')
    viewSwitch?.setAttribute('data-active-view', mode)
    document.documentElement.dataset.memorableMomentsView = mode
    root.querySelectorAll('[data-view-mode]').forEach(button => {
      const active = button.dataset.viewMode === mode
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-pressed', String(active))
    })
    if (announce) {
      const status = root.querySelector('.memorable-moments__view-status')
      if (status) status.textContent = mode === VIEW_MODE.GRID ? '已切换到矩阵网络视图' : '已切换到中枢链路视图'
    }
  }

  const applyViewMode = (root, mode, { persist = true, announce = false } = {}) => {
    const nextMode = normalizeViewMode(mode)
    runtime.viewMode = nextMode
    root.dataset.view = nextMode
    updateViewControls(root, nextMode, announce)
    if (persist) persistViewMode(nextMode)
    return nextMode
  }

  const setViewSwitchLocked = (root, locked) => {
    root?.querySelectorAll('[data-view-mode]').forEach(button => {
      button.setAttribute('aria-disabled', String(Boolean(locked)))
    })
  }

  const getViewContent = root => root?.querySelector(viewContentSelector) || root

  const clearViewBootClass = () => {
    document.documentElement.classList.remove('is-memorable-moments-view-pending')
  }

  const clearViewSwitchBootState = () => {
    document.documentElement.classList.remove('is-memorable-moments-switch-ready')
    document.documentElement.removeAttribute('data-memorable-moments-view')
  }

  const switchViewMode = (root, mode) => {
    const nextMode = normalizeViewMode(mode)
    if (nextMode === runtime.viewMode || runtime.viewSwitching) return

    const generation = runtime.generation
    const viewContent = getViewContent(root)
    const resettingToTimeline = runtime.viewMode === VIEW_MODE.GRID && nextMode === VIEW_MODE.TIMELINE
    // Manual view switches keep the document position. Detail returns use
    // restoreTimelinePosition(), which is the only path allowed to scroll.
    runtime.viewSwitching = true
    setViewSwitchLocked(root, true)
    if (runtime.viewMode === VIEW_MODE.TIMELINE) cancelTimelineLoading(root)

    const finishTransition = () => {
      if (runtime.generation !== generation || runtime.root !== root || !root.isConnected) return
      viewContent?.removeAttribute('data-view-transition')
      runtime.viewSwitching = false
      setViewSwitchLocked(root, false)
    }

    const finishLayout = () => {
      if (runtime.generation !== generation || runtime.root !== root || !root.isConnected) return

      if (resettingToTimeline) {
        const timelineItems = resetTimelineView(root)
        if (runtime.reduced) {
          finishTransition()
          return
        }
        viewContent.dataset.viewTransition = 'in'
        scheduleFrame(() => {
          if (runtime.generation !== generation || runtime.root !== root || !root.isConnected) return
          viewContent.dataset.viewTransition = 'active'
          animateInitialTimeline(root, runtime.reduced)
          playTimelineEntrance(timelineItems, { generation })
          scheduleTimer(finishTransition, viewFadeInDuration)
        })
        return
      }

      if (nextMode === VIEW_MODE.GRID) appendAllGridItems(root, { showImmediately: false })
      applyViewMode(root, nextMode, { persist: true, announce: true })
      if (runtime.reduced) {
        if (nextMode === VIEW_MODE.GRID) root.querySelectorAll('.moment-item').forEach(showCardImmediately)
        finishTransition()
        return
      }
      const gridPlan = getGridRevealPlan(root)
      viewContent.dataset.viewTransition = 'in'
      scheduleFrame(() => {
        if (runtime.generation !== generation || runtime.root !== root || !root.isConnected) return
        viewContent.dataset.viewTransition = 'active'
        playGridRowReveal(gridPlan, generation)
        scheduleTimer(finishTransition, viewFadeInDuration)
      })
    }

    if (runtime.reduced) {
      finishLayout()
      return
    }

    viewContent.dataset.viewTransition = 'out'
    scheduleTimer(finishLayout, viewFadeOutDuration)
  }

  const formatDate = value => {
    if (!value) return ''
    const normalized = value instanceof Date ? value.toISOString() : String(value)
    return normalized.slice(0, 10)
  }

  const getMomentSlug = (item, index) => String(item?.slug || item?.id || `moment-${String(index + 1).padStart(2, '0')}`)
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/g, '-')

  const getMomentId = (item, index) => `moment-${getMomentSlug(item, index)}`

  const normalizeRestoreState = value => {
    if (!value || typeof value !== 'object') return null

    const slug = String(value.slug || '').trim()
    const savedAt = Number(value.savedAt)
    if (!slug || !Number.isFinite(savedAt) || Date.now() - savedAt > restoreMaxAge) return null

    return {
      version: Number(value.version) || restoreVersion,
      pending: value.pending === true,
      source: String(value.source || 'moment-detail'),
      slug,
      loadedCount: Number.isFinite(Number(value.loadedCount)) ? Number(value.loadedCount) : initialCount,
      scrollY: Number.isFinite(Number(value.scrollY)) ? Number(value.scrollY) : 0,
      viewportOffset: Number.isFinite(Number(value.viewportOffset)) ? Number(value.viewportOffset) : 0,
      viewMode: normalizeViewMode(value.viewMode || readStoredViewMode()),
      savedAt
    }
  }

  const readSessionRestoreState = () => {
    try {
      return normalizeRestoreState(JSON.parse(window.sessionStorage.getItem(restoreStorageKey) || 'null'))
    } catch {
      return null
    }
  }

  const getHashSlug = () => {
    const hash = String(window.location.hash || '').replace(/^#/, '')
    if (!hash.startsWith('moment-')) return ''
    try {
      return decodeURIComponent(hash.slice('moment-'.length))
    } catch {
      return hash.slice('moment-'.length)
    }
  }

  const clearRestoreState = clearHash => {
    try {
      window.sessionStorage.removeItem(restoreStorageKey)
    } catch {}

    const currentState = window.history.state
    if (currentState && typeof currentState === 'object' && restoreHistoryKey in currentState) {
      const nextState = { ...currentState }
      delete nextState[restoreHistoryKey]
      const nextUrl = clearHash ? `${window.location.pathname}${window.location.search}` : window.location.href
      try {
        window.history.replaceState(nextState, '', nextUrl)
      } catch {}
    } else if (clearHash && window.location.hash) {
      try {
        window.history.replaceState(currentState, '', `${window.location.pathname}${window.location.search}`)
      } catch {}
    }
  }

  const clearRestoreHash = () => {
    if (!window.location.hash) return
    try {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`)
    } catch {}
  }

  const readRestoreRequest = items => {
    const hashSlug = getHashSlug()
    const sessionState = readSessionRestoreState()
    let state = sessionState?.pending ? sessionState : null

    if (hashSlug) {
      state = state ? { ...state, slug: hashSlug, savedAt: state.savedAt || Date.now() } : {
        version: restoreVersion,
        pending: true,
        source: 'moment-detail',
        slug: hashSlug,
        loadedCount: initialCount,
        scrollY: 0,
        viewportOffset: 0,
        savedAt: Date.now()
      }
    }

    if (!state) {
      return null
    }
    if (Date.now() - state.savedAt > restoreMaxAge) {
      clearRestoreState(Boolean(hashSlug))
      return null
    }

    const targetIndex = items.findIndex((item, index) => getMomentSlug(item, index) === state.slug)
    if (targetIndex < 0) {
      clearRestoreState(Boolean(hashSlug))
      return null
    }

    return {
      ...state,
      targetIndex,
      loadedCount: Math.min(items.length, Math.max(initialCount, state.loadedCount, targetIndex + 1))
    }
  }

  const rememberHistoryRestoreMarker = state => {
    try {
      const currentState = window.history.state
      const nextState = currentState && typeof currentState === 'object'
        ? { ...currentState, [restoreHistoryKey]: { version: restoreVersion, source: state.source, slug: state.slug } }
        : { [restoreHistoryKey]: { version: restoreVersion, source: state.source, slug: state.slug } }
      window.history.replaceState(nextState, '', window.location.href)
    } catch {}
  }

  const saveMomentReturnState = state => {
    if (!state?.slug) return false
    const nextState = {
      version: restoreVersion,
      pending: false,
      source: 'moment-detail',
      slug: state.slug,
      loadedCount: Math.max(initialCount, Number(state.loadedCount) || initialCount),
      scrollY: Number(state.scrollY) || 0,
      viewportOffset: Number(state.viewportOffset) || 0,
      viewMode: normalizeViewMode(state.viewMode || runtime.viewMode),
      savedAt: Date.now()
    }
    try {
      window.sessionStorage.setItem(restoreStorageKey, JSON.stringify(nextState))
    } catch {}

    rememberHistoryRestoreMarker(nextState)

    return true
  }

  const captureMomentNavigation = (anchor, article = anchor?.closest('.moment-item[data-moment-slug]')) => {
    const root = article?.closest(rootSelector)
    const slug = article?.dataset.momentSlug || anchor?.dataset.momentSlug
    if (!root || !root.isConnected || !slug) return false

    if (runtime.root !== root) return false

    // Capture the target geometry before PJAX cleanup removes generated cards.
    const rect = article.getBoundingClientRect()
    const saved = saveMomentReturnState({
      slug,
      loadedCount: Math.max(initialCount, runtime.cursor),
      scrollY: window.scrollY,
      viewportOffset: rect.top,
      viewMode: runtime.viewMode,
      savedAt: Date.now()
    })
    if (saved) setDetailNavigationClass(true)
    return saved
  }

  const appendText = (parent, text) => {
    if (text !== undefined && text !== null) parent.append(document.createTextNode(String(text)))
    return parent
  }

  // DOM and card creation.
  const showImagePlaceholder = image => {
    const media = image.closest('.moment-card__media')
    if (!media) return
    image.remove()
    media.classList.add('moment-card__media--placeholder')
    media.setAttribute('aria-hidden', 'true')
    if (!media.querySelector('span')) appendText(media.appendChild(document.createElement('span')), 'MEMORY')
  }

  const bindImageFallback = (root, items = root.querySelectorAll('.moment-item')) => {
    Array.from(items).forEach(item => {
      item.querySelectorAll('.moment-card__media img').forEach(image => {
        const onError = () => showImagePlaceholder(image)
        image.addEventListener('error', onError, { once: true })
        runtime.imageHandlers.push({ image, onError })
        if (image.complete && image.naturalWidth === 0) onError()
      })
    })
  }

  const createMomentCard = (item, index) => {
    const side = index % 2 === 0 ? 'right' : 'left'
    const slug = getMomentSlug(item, index)
    const article = document.createElement('article')
    article.className = `moment-item moment-item--${side}`
    article.id = getMomentId(item, index)
    article.dataset.momentSlug = slug
    article.dataset.momentGenerated = 'true'

    const node = document.createElement('span')
    node.className = 'moment-item__node'
    node.setAttribute('aria-hidden', 'true')
    const nodeCore = document.createElement('span')
    nodeCore.className = 'moment-item__node-core'
    node.append(nodeCore)
    article.append(node)

    const card = document.createElement(item.url ? 'a' : 'div')
    card.className = 'moment-card'
    card.dataset.momentSlug = slug
    if (item.url) {
      card.href = item.url
      card.setAttribute('aria-label', `${item.title || 'Memorable Moment'}，打开详情`)
    }

    const media = document.createElement('div')
    media.className = 'moment-card__media'
    if (item.cover) {
      const image = document.createElement('img')
      image.src = item.cover
      image.alt = ''
      image.loading = 'lazy'
      media.append(image)
    } else {
      media.classList.add('moment-card__media--placeholder')
      media.setAttribute('aria-hidden', 'true')
      appendText(media.appendChild(document.createElement('span')), 'MEMORY')
    }
    card.append(media)

    const body = document.createElement('div')
    body.className = 'moment-card__body'

    const date = document.createElement('p')
    date.className = 'moment-card__date'
    const time = document.createElement('time')
    const dateText = formatDate(item.date)
    time.dateTime = `${dateText}${item.time ? `T${item.time}` : ''}`
    appendText(time, dateText)
    date.append(time)
    if (item.time) {
      const separator = document.createElement('span')
      separator.setAttribute('aria-hidden', 'true')
      appendText(separator, ' · ')
      date.append(separator)
      appendText(date.appendChild(document.createElement('span')), item.time)
    }
    body.append(date)

    const title = document.createElement('h2')
    title.className = 'moment-card__title'
    appendText(title, item.title)
    body.append(title)

    if (item.description) {
      const description = document.createElement('p')
      description.className = 'moment-card__description'
      appendText(description, item.description)
      body.append(description)
    }

    card.append(body)
    article.append(card)
    return article
  }

  const getStatus = root => root.querySelector('.moments-load-status')

  const getSentinel = root => root.querySelector('.moments-load-sentinel')

  const ensureSentinel = root => {
    let sentinel = getSentinel(root)
    if (sentinel) return sentinel

    sentinel = document.createElement('span')
    sentinel.className = 'moments-load-sentinel'
    sentinel.setAttribute('aria-hidden', 'true')
    root.querySelector('.moments-timeline')?.append(sentinel)
    return sentinel
  }

  const ensureStatus = root => {
    let status = getStatus(root)
    if (status) return status

    status = document.createElement('span')
    status.className = 'moments-load-status'
    status.setAttribute('aria-live', 'polite')
    status.hidden = true
    status.textContent = '···'
    root.querySelector('.moments-timeline')?.append(status)
    return status
  }

  const cancelTimelineLoading = root => {
    runtime.loadingEpoch += 1
    runtime.loadObserver?.disconnect()
    runtime.loadObserver = null
    if (runtime.scrollHandler) window.removeEventListener('scroll', runtime.scrollHandler)
    runtime.scrollHandler = null
    runtime.sentinelIntersecting = false
    runtime.loading = false
    if (root) {
      root.querySelector('.moments-load-status')?.remove()
      root.querySelector('.moments-load-sentinel')?.remove()
    }
    runtime.sentinel = null
  }

  const pruneDetachedHandlers = root => {
    const activeCards = new Set(root?.querySelectorAll('.moment-card') || [])
    const retainedCards = []
    runtime.cardHandlers.splice(0).forEach(handler => {
      if (activeCards.has(handler.card)) {
        retainedCards.push(handler)
        return
      }
      handler.card.removeEventListener('pointerenter', handler.enter)
      handler.card.removeEventListener('pointerleave', handler.leave)
      handler.card.removeEventListener('focusin', handler.enter)
      handler.card.removeEventListener('focusout', handler.leave)
    })
    runtime.cardHandlers.push(...retainedCards)

    const activeImages = new Set(root?.querySelectorAll('.moment-card__media img') || [])
    const retainedImages = []
    runtime.imageHandlers.splice(0).forEach(handler => {
      if (activeImages.has(handler.image)) retainedImages.push(handler)
      else handler.image.removeEventListener('error', handler.onError)
    })
    runtime.imageHandlers.push(...retainedImages)
  }

  const removeGeneratedCards = root => {
    root?.querySelectorAll('.moment-item[data-moment-generated]').forEach(item => item.remove())
    pruneDetachedHandlers(root)
  }

  const resetGeneratedCards = root => {
    removeGeneratedCards(root)
    if (root) {
      ensureSentinel(root)
      ensureStatus(root).hidden = true
    }
  }

  const resetCardStates = root => {
    root?.querySelectorAll('.moment-item').forEach(item => {
      const card = item.querySelector('.moment-card')
      item.classList.remove('moment-item--entering', 'moment-item--visible')
      item.removeAttribute('data-moment-entry-state')
      item.style.removeProperty('opacity')
      item.style.removeProperty('transform')
      card?.style.removeProperty('opacity')
      card?.style.removeProperty('transform')
      item.querySelector('.moment-item__node')?.style.removeProperty('opacity')
      item.querySelector('.moment-item__node')?.style.removeProperty('transform')
    })
  }

  const cleanup = ({ preserveVisualState = false, preserveHeroBootState = false } = {}) => {
    const root = runtime.root
    const shouldPreserveVisualState = Boolean(preserveVisualState && root?.isConnected)
    runtime.generation += 1
    runtime.animations.forEach(animation => animation.cancel())
    runtime.animations.clear()
    runtime.frames.forEach(frame => window.cancelAnimationFrame(frame))
    runtime.frames.clear()
    runtime.timers.forEach(timer => window.clearTimeout(timer))
    runtime.timers.clear()
    runtime.loadObserver?.disconnect()
    runtime.loadObserver = null
    runtime.cardObserver?.disconnect()
    runtime.cardObserver = null
    if (runtime.scrollHandler) window.removeEventListener('scroll', runtime.scrollHandler)
    runtime.cardHandlers.splice(0).forEach(({ card, enter, leave }) => {
      card.removeEventListener('pointerenter', enter)
      card.removeEventListener('pointerleave', leave)
      card.removeEventListener('focusin', enter)
      card.removeEventListener('focusout', leave)
    })
    runtime.imageHandlers.splice(0).forEach(({ image, onError }) => image.removeEventListener('error', onError))
    if (runtime.motionQuery && runtime.motionHandler) {
      if (runtime.motionQuery.removeEventListener) runtime.motionQuery.removeEventListener('change', runtime.motionHandler)
      else runtime.motionQuery.removeListener?.(runtime.motionHandler)
    }

    clearRevealState(root)
    clearHeroEntrance()
    getViewContent(root)?.removeAttribute('data-view-transition')
    clearViewBootClass()
    clearViewSwitchBootState()
    if (!preserveHeroBootState) clearHeroBootClass()

    if (root?.isConnected) {
      if (shouldPreserveVisualState) root.querySelectorAll('.moment-item').forEach(showCardImmediately)
      else {
        resetGeneratedCards(root)
        resetCardStates(root)
      }
    }
    if (root) root.dataset.momentsState = 'destroyed'
    root?.removeAttribute('data-moments-initialized')
    runtime.root = null
    runtime.items = []
    runtime.cursor = 0
    runtime.sentinel = null
    runtime.scrollHandler = null
    runtime.sentinelIntersecting = false
    runtime.hasScrolled = false
    runtime.loading = false
    runtime.loadingEpoch = 0
    runtime.motionQuery = null
    runtime.motionHandler = null
    runtime.reduced = false
    runtime.restoreState = null
    runtime.restoreGuardTimer = null
    runtime.revealTarget = null
    runtime.viewMode = VIEW_MODE.TIMELINE
    runtime.viewSwitching = false
    setViewSwitchLocked(root, false)
  }

  const bindHover = (root, items = root.querySelectorAll('.moment-item')) => {
    Array.from(items).forEach(item => {
      const card = item.querySelector('.moment-card')
      if (!card || runtime.cardHandlers.some(handler => handler.card === card)) return
      const enter = () => item.classList.add('is-hovered')
      const leave = event => {
        if (event.type === 'focusout' && item.contains(event.relatedTarget)) return
        item.classList.remove('is-hovered')
      }
      card.addEventListener('pointerenter', enter)
      card.addEventListener('pointerleave', leave)
      card.addEventListener('focusin', enter)
      card.addEventListener('focusout', leave)
      runtime.cardHandlers.push({ card, enter, leave })
    })
  }

  // Card and timeline motion.
  const animateInitialTimeline = (root, reduced) => {
    const line = root.querySelector('.moments-timeline__line')
    root.dataset.momentsState = 'ready'
    if (reduced || runtime.viewMode === VIEW_MODE.GRID) return

    if (line) {
      try {
        track(line.animate([
          { transform: 'translateX(-50%) scaleY(0)' },
          { transform: 'translateX(-50%) scaleY(1)' }
        ], { duration: lineDuration, easing: entryEasing, fill: 'both' }))
      } catch {}
    }
  }

  const showCardImmediately = item => {
    const card = item.querySelector('.moment-card')
    item.dataset.momentEntryState = 'visible'
    item.classList.remove('moment-item--entering')
    item.classList.add('moment-item--visible')
    item.style.removeProperty('opacity')
    item.style.removeProperty('transform')
    card?.style.removeProperty('opacity')
    card?.style.removeProperty('transform')
    item.querySelector('.moment-item__node')?.style.removeProperty('opacity')
    item.querySelector('.moment-item__node')?.style.removeProperty('transform')
  }

  const prepareTimelineEntrance = items => {
    const preparedItems = []
    Array.from(items || []).forEach(item => {
      if (!item?.isConnected) return
      const entryX = Number.parseFloat(getComputedStyle(item).getPropertyValue('--moment-entry-offset-x')) || 0
      const card = item.querySelector('.moment-card')
      const node = item.querySelector('.moment-item__node')
      item.dataset.momentEntryState = 'entering'
      item.classList.remove('moment-item--visible')
      item.classList.add('moment-item--entering')
      if (card) {
        card.style.opacity = '0'
        card.style.transform = `translate3d(${entryX}px, 10px, 0) scale(0.98)`
      }
      if (node) {
        node.style.opacity = '0'
        node.style.transform = 'translate(-50%, -50%) scale(0.65)'
      }
      preparedItems.push(item)
    })
    return preparedItems
  }

  const finishTimelineEntranceItem = item => {
    showCardImmediately(item)
    runtime.cardObserver?.unobserve(item)
  }

  const playTimelineEntrance = (items, { baseDelay = 0, generation = runtime.generation } = {}) => {
    Array.from(items || []).forEach((item, index) => {
      const delay = baseDelay + index * cardEntryStagger
      const entryX = Number.parseFloat(getComputedStyle(item).getPropertyValue('--moment-entry-offset-x')) || 0
      const card = item.querySelector('.moment-card')
      const node = item.querySelector('.moment-item__node')
      if (!card) {
        finishTimelineEntranceItem(item)
        return
      }
      try {
        const cardAnimation = track(card.animate([
          { opacity: 0, transform: `translate3d(${entryX}px, 10px, 0) scale(0.98)` },
          { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' }
        ], {
          duration: cardEntryDuration,
          delay,
          easing: entryEasing,
          fill: 'both'
        }))
        if (node) {
          track(node.animate([
            { opacity: 0, transform: 'translate(-50%, -50%) scale(0.65)' },
            { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' }
          ], {
            duration: nodeEntryDuration,
            delay: Math.max(0, delay - nodeEntryLead),
            easing: entryEasing,
            fill: 'both'
          }))
        }
        cardAnimation.finished.then(() => {
          if (runtime.generation !== generation) return
          finishTimelineEntranceItem(item)
          cardAnimation.cancel()
        }).catch(() => {})
      } catch {
        finishTimelineEntranceItem(item)
      }
    })
  }

  const getTimelineRestoreAnimationItems = (root, target = null) => {
    const top = -restoreRevealBufferTop
    const bottom = window.innerHeight + restoreRevealBufferBottom
    const visibleItems = Array.from(root.querySelectorAll('.moment-item[data-moment-slug]'))
      .filter(item => {
        const rect = item.getBoundingClientRect()
        return rect.bottom >= top && rect.top <= bottom
      })
    const itemSet = new Set(visibleItems)
    if (target?.isConnected) itemSet.add(target)
    return Array.from(itemSet).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
  }

  const groupGridItemsByVisualRow = items => {
    const rows = []
    const measurements = Array.from(items || [])
      .filter(item => item?.isConnected)
      .map(item => ({
        item,
        top: item.offsetTop,
        left: item.getBoundingClientRect().left
      }))

    measurements.forEach(({ item, top, left }) => {
      let row = rows.find(candidate => Math.abs(candidate.top - top) <= gridRevealTolerance)
      if (!row) {
        row = { top, items: [] }
        rows.push(row)
      }
      row.items.push({ item, left })
    })
    rows.sort((a, b) => a.top - b.top)
    rows.forEach(row => {
      row.items.sort((a, b) => a.left - b.left)
      row.items = row.items.map(entry => entry.item)
    })
    return rows
  }

  const getGridRevealOffset = () => window.innerWidth <= 679 ? gridMobileOffset : gridDesktopOffset

  const prepareGridReveal = items => {
    const offset = getGridRevealOffset()
    const preparedItems = []
    Array.from(items || []).forEach(item => {
      if (!item?.isConnected) return
      const card = item.querySelector('.moment-card')
      item.dataset.momentEntryState = 'entering'
      item.classList.remove('moment-item--visible')
      item.classList.add('moment-item--entering')
      if (card) {
        card.style.opacity = '0'
        card.style.transform = `translate3d(0, -${offset}px, 0) scale(0.985)`
      }
      preparedItems.push(item)
    })
    return preparedItems
  }

  const getGridRevealPlan = (root, target = null) => {
    const rows = groupGridItemsByVisualRow(root.querySelectorAll('.moment-item[data-moment-slug]'))
    if (!rows.length) return { rows: [], items: [] }

    const visibleRowIndexes = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.items.some(item => {
        const rect = item.getBoundingClientRect()
        return rect.bottom >= -restoreRevealBufferTop && rect.top <= window.innerHeight + restoreRevealBufferBottom
      }))
      .map(({ index }) => index)

    const revealIndexes = new Set(visibleRowIndexes)
    const targetRowIndex = rows.findIndex(row => row.items.includes(target))
    if (targetRowIndex >= 0) revealIndexes.add(targetRowIndex)
    const lastVisibleIndex = visibleRowIndexes[visibleRowIndexes.length - 1]
    if (lastVisibleIndex !== undefined && lastVisibleIndex + 1 < rows.length) revealIndexes.add(lastVisibleIndex + 1)

    const revealRows = rows.filter((_, index) => revealIndexes.has(index))
    const revealItems = revealRows.flatMap(row => row.items)
    const revealSet = new Set(revealItems)
    rows.forEach(row => row.items.forEach(item => {
      if (!revealSet.has(item)) showCardImmediately(item)
    }))
    return { rows: revealRows, items: prepareGridReveal(revealItems) }
  }

  const playGridRowReveal = (plan, generation = runtime.generation) => {
    const offset = getGridRevealOffset()
    plan.rows.forEach((row, rowIndex) => {
      row.items.forEach((item, itemIndex) => {
        const delay = rowIndex * gridRowDelay + itemIndex * gridItemDelay
        const card = item.querySelector('.moment-card')
        if (!card) {
          showCardImmediately(item)
          return
        }
        try {
          const animation = track(card.animate([
            { opacity: 0, transform: `translate3d(0, -${offset}px, 0) scale(0.985)` },
            { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' }
          ], {
            duration: gridRevealDuration,
            delay,
            easing: entryEasing,
            fill: 'both'
          }))
          animation.finished.then(() => {
            if (runtime.generation !== generation) return
            showCardImmediately(item)
            animation.cancel()
          }).catch(() => {})
        } catch {
          showCardImmediately(item)
        }
      })
    })
  }

  const highlightReturnTarget = (target, generation) => {
    if (!target) return
    runtime.revealTarget = target
    target.classList.add('is-return-target')
    scheduleTimer(() => {
      if (runtime.generation !== generation || runtime.root !== target.closest(rootSelector)) return
      target.classList.remove('is-return-target')
      if (runtime.revealTarget === target) runtime.revealTarget = null
    }, returnTargetDuration)
  }

  const showRestoredViewImmediately = (root, generation) => {
    cancelRestoreGuard()
    root.dataset.momentsState = 'ready'
    clearRevealState(root)
    if (runtime.generation !== generation || runtime.root !== root || !root.isConnected) return
    root.querySelectorAll('.moment-item').forEach(showCardImmediately)
    clearHeroEntrance()
    clearHeroBootClass()
    setRestoreClass(false)
  }

  const revealRestoredView = (root, target, generation) => {
    cancelRestoreGuard()
    root.dataset.momentsState = 'ready'

    if (runtime.reduced) {
      showRestoredViewImmediately(root, generation)
      return
    }

    clearRevealState(root)
    const plan = runtime.viewMode === VIEW_MODE.GRID
      ? getGridRevealPlan(root, target)
      : { items: getTimelineRestoreAnimationItems(root, target) }
    const animatedItems = runtime.viewMode === VIEW_MODE.GRID
      ? plan.items
      : prepareTimelineEntrance(plan.items)
    const heroTargets = prepareHeroEntrance(root)
    const animatedSet = new Set(animatedItems)
    root.querySelectorAll('.moment-item').forEach(item => {
      if (!animatedSet.has(item)) showCardImmediately(item)
    })
    clearHeroBootClass()
    setRestoreClass(false)

    scheduleFrame(() => {
      if (runtime.generation !== generation || runtime.root !== root || !root.isConnected) return
      playHeroEntrance(heroTargets, generation)
      if (runtime.viewMode === VIEW_MODE.GRID) playGridRowReveal(plan, generation)
      else playTimelineEntrance(animatedItems, { generation })
      highlightReturnTarget(target, generation)
    })
  }

  const failTimelineRestore = (root, state, generation, reason, details = {}) => {
    root.querySelectorAll('.moment-item').forEach(showCardImmediately)
    reportRestoreWarning(reason, { slug: state?.slug || '', ...details })
    showRestoredViewImmediately(root, generation)
  }

  const armRestoreGuard = (root, state, generation) => {
    cancelRestoreGuard()
    runtime.restoreGuardTimer = scheduleTimer(() => {
      runtime.restoreGuardTimer = null
      if (runtime.generation !== generation || runtime.root !== root || !root.isConnected) return
      failTimelineRestore(root, state, generation, 'restore visibility guard expired')
    }, restoreGuardLimit)
  }

  const animateCardEntry = (item, delay, reduced) => {
    if (item.dataset.momentEntryState) return
    if (reduced) {
      showCardImmediately(item)
      runtime.cardObserver?.unobserve(item)
      return
    }

    const preparedItems = prepareTimelineEntrance([item])
    playTimelineEntrance(preparedItems, { baseDelay: delay })
  }

  const observeCards = (root, items = root.querySelectorAll('.moment-item')) => {
    const cardItems = Array.from(items)
    if (runtime.reduced || typeof window.IntersectionObserver !== 'function') {
      cardItems.forEach(showCardImmediately)
      return
    }

    if (!runtime.cardObserver) {
      try {
        runtime.cardObserver = new window.IntersectionObserver(entries => {
          let staggerIndex = 0
          entries.forEach(entry => {
            if (!entry.isIntersecting || entry.target.dataset.momentEntryState) return
            animateCardEntry(entry.target, staggerIndex * cardEntryStagger, runtime.reduced)
            staggerIndex += 1
          })
        }, { rootMargin: cardRootMargin, threshold: cardThreshold })
      } catch {
        cardItems.forEach(showCardImmediately)
        return
      }
    }

    cardItems.forEach(item => {
      if (!item.dataset.momentEntryState) runtime.cardObserver.observe(item)
    })
  }

  const animateTimelineExtension = (root, oldHeight, newHeight, reduced, generation) => {
    const line = root.querySelector('.moments-timeline__line')
    if (!line || reduced || runtime.viewMode === VIEW_MODE.GRID || newHeight <= oldHeight) return

    const oldVisibleRatio = Math.max(0, Math.min(1, oldHeight / newHeight))
    const clipFrom = `inset(0 0 ${(1 - oldVisibleRatio) * 100}% 0)`
    line.style.clipPath = clipFrom
    scheduleFrame(() => {
      if (runtime.generation !== generation || runtime.root !== root) return
      try {
        const animation = track(line.animate([
          { clipPath: clipFrom },
          { clipPath: 'inset(0)' }
        ], { duration: extensionDuration, easing: entryEasing, fill: 'both' }))
        animation.finished.then(() => {
          if (runtime.generation === generation && runtime.root === root) line.style.removeProperty('clip-path')
        }).catch(() => {})
      } catch {
        line.style.removeProperty('clip-path')
      }
    })
  }

  const finishLoadingState = (root, generation) => {
    scheduleTimer(() => {
      if (runtime.generation !== generation || runtime.root !== root) return
      const status = getStatus(root)
      if (status) status.hidden = true
    }, statusDuration)
  }

  // Incremental loading and sentinel lifecycle.
  const appendItemsTo = (targetCursor, { showImmediately = true } = {}) => {
    const root = runtime.root
    if (!root) return []
    const timeline = root.querySelector('.moments-timeline')
    const sentinel = runtime.sentinel || getSentinel(root)
    const nextCursor = Math.min(targetCursor, runtime.items.length)
    if (!timeline || nextCursor <= runtime.cursor) return []

    const newItems = []
    const fragment = document.createDocumentFragment()
    for (let index = runtime.cursor; index < nextCursor; index += 1) {
      const item = createMomentCard(runtime.items[index], index)
      newItems.push(item)
      fragment.append(item)
    }
    timeline.insertBefore(fragment, sentinel?.parentNode === timeline ? sentinel : null)
    runtime.cursor = nextCursor
    bindHover(root, newItems)
    bindImageFallback(root, newItems)
    if (showImmediately) newItems.forEach(showCardImmediately)
    return newItems
  }

  const appendAllGridItems = (root, { showImmediately = false } = {}) => {
    const newItems = appendItemsTo(runtime.items.length, { showImmediately })
    cancelTimelineLoading(root)
    return newItems
  }

  const resetTimelineView = root => {
    runtime.animations.forEach(animation => animation.cancel())
    runtime.animations.clear()
    runtime.frames.forEach(frame => window.cancelAnimationFrame(frame))
    runtime.frames.clear()
    runtime.cardObserver?.disconnect()
    runtime.cardObserver = null
    cancelTimelineLoading(root)
    clearRevealState(root)
    removeGeneratedCards(root)
    ensureSentinel(root)
    ensureStatus(root).hidden = true
    runtime.cursor = Math.min(initialCount, runtime.items.length)
    applyViewMode(root, VIEW_MODE.TIMELINE, { persist: true, announce: true })
    resetCardStates(root)
    root.dataset.momentsState = 'idle'
    root.querySelector('.moments-timeline__line')?.style.removeProperty('clip-path')

    const initialItems = Array.from(root.querySelectorAll('.moment-item[data-moment-slug]'))
    const preparedItems = runtime.reduced ? [] : prepareTimelineEntrance(initialItems)
    if (runtime.reduced) initialItems.forEach(showCardImmediately)
    setupLoading(root)
    return preparedItems
  }

  const calculateRestoredScrollPosition = (target, viewportOffset, fallbackScrollY = 0) => {
    const rect = target.getBoundingClientRect()
    const offset = Number(viewportOffset)
    const desiredScrollY = Number.isFinite(offset)
      ? window.scrollY + rect.top - offset
      : Number(fallbackScrollY) || 0
    const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    const finalScrollY = Math.min(Math.max(desiredScrollY, 0), maxScrollY)
    return {
      desiredScrollY,
      finalScrollY,
      maxScrollY,
      wasClamped: Math.abs(finalScrollY - desiredScrollY) > 1
    }
  }

  const scrollToInstantly = top => {
    const documentElement = document.documentElement
    const previousScrollBehavior = documentElement.style.scrollBehavior
    documentElement.style.scrollBehavior = 'auto'
    try {
      window.scrollTo({ top, left: 0, behavior: 'auto' })
    } catch {
      window.scrollTo(0, top)
    } finally {
      if (previousScrollBehavior) documentElement.style.scrollBehavior = previousScrollBehavior
      else documentElement.style.removeProperty('scroll-behavior')
    }
  }

  // Restore positioning and the post-position reveal.
  const restoreTimelinePosition = (root, state, generation) => {
    const target = Array.from(root.querySelectorAll('.moment-item[data-moment-slug]'))
      .find(item => item.dataset.momentSlug === state.slug)

    if (!target) {
      failTimelineRestore(root, state, generation, 'target not found', { loadedCount: state.loadedCount })
      return
    }

    let restoreAttempts = 0
    scheduleTimer(() => {
      if (runtime.generation !== generation || runtime.root !== root || !root.isConnected) return
      try {
        restoreAttempts += 1
        let scrollMetrics = calculateRestoredScrollPosition(target, state.viewportOffset, state.scrollY)
        let wasClamped = scrollMetrics.wasClamped
        scrollToInstantly(scrollMetrics.finalScrollY)

        // One layout correction covers a late image/style measurement without replaying card motion.
        scheduleFrame(() => {
          if (runtime.generation !== generation || runtime.root !== root || !root.isConnected) return
          try {
            const rect = target.getBoundingClientRect()
            if (Math.abs(rect.top - state.viewportOffset) > 8) {
              restoreAttempts += 1
              scrollMetrics = calculateRestoredScrollPosition(target, state.viewportOffset, state.scrollY)
              wasClamped = wasClamped || scrollMetrics.wasClamped
              scrollToInstantly(scrollMetrics.finalScrollY)
            }
            const settledTop = target.getBoundingClientRect().top
            const error = settledTop - state.viewportOffset
            const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
            const atScrollBoundary = Math.abs(window.scrollY - maxScrollY) <= 1
            const acceptedAtScrollBoundary = atScrollBoundary && (
              wasClamped || scrollMetrics.desiredScrollY >= maxScrollY - restorePositionTolerance
            )
            if (Math.abs(error) <= 8 || acceptedAtScrollBoundary) {
              clearRestoreState(Boolean(getHashSlug()))
              revealRestoredView(root, target, generation)
            } else {
              failTimelineRestore(root, state, generation, 'viewport mismatch after correction', {
                expectedViewportTop: state.viewportOffset,
                actualViewportTop: settledTop,
                error,
                desiredScrollY: scrollMetrics.desiredScrollY,
                finalScrollY: window.scrollY,
                wasClamped
              })
            }
          } catch (error) {
            failTimelineRestore(root, state, generation, 'scroll correction failed', {
              message: error instanceof Error ? error.message : String(error)
            })
          }
        })
      } catch (error) {
        failTimelineRestore(root, state, generation, 'scroll restore failed', {
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }, 80)
  }

  const appendNextBatch = () => {
    const root = runtime.root
    if (!root || runtime.viewMode !== VIEW_MODE.TIMELINE || runtime.loading || runtime.cursor >= runtime.items.length) return false

    runtime.loading = true
    const generation = runtime.generation
    const timeline = root.querySelector('.moments-timeline')
    const sentinel = runtime.sentinel || getSentinel(root)
    const status = getStatus(root)
    if (!timeline || !sentinel) {
      runtime.loading = false
      return false
    }

    if (status) status.hidden = false
    const oldHeight = timeline.scrollHeight
    const nextCursor = Math.min(runtime.cursor + batchSize, runtime.items.length)
    const newItems = []
    const fragment = document.createDocumentFragment()
    for (let index = runtime.cursor; index < nextCursor; index += 1) {
      const item = createMomentCard(runtime.items[index], index)
      newItems.push(item)
      fragment.append(item)
    }
    timeline.insertBefore(fragment, sentinel)
    runtime.cursor = nextCursor
    bindHover(root, newItems)
    bindImageFallback(root, newItems)

    const newHeight = timeline.scrollHeight
    animateTimelineExtension(root, oldHeight, newHeight, runtime.reduced, generation)
    observeCards(root, newItems)
    runtime.loading = false

    if (runtime.cursor >= runtime.items.length) {
      runtime.loadObserver?.disconnect()
      runtime.loadObserver = null
      sentinel.remove()
      runtime.sentinel = null
      status?.remove()
      runtime.loading = false
      return true
    }
    finishLoadingState(root, generation)
    return true
  }

  const queueNextBatch = () => {
    if (runtime.viewMode !== VIEW_MODE.TIMELINE || runtime.loading || runtime.cursor >= runtime.items.length) return
    runtime.loading = true
    const generation = runtime.generation
    const loadingEpoch = runtime.loadingEpoch
    scheduleTimer(() => {
      if (runtime.generation !== generation || runtime.loadingEpoch !== loadingEpoch || runtime.viewMode !== VIEW_MODE.TIMELINE || !runtime.root) {
        runtime.loading = false
        return
      }
      runtime.loading = false
      appendNextBatch()
    }, 80)
  }

  const setupLoading = root => {
    if (runtime.viewMode !== VIEW_MODE.TIMELINE) {
      cancelTimelineLoading(root)
      return
    }
    runtime.sentinel = getSentinel(root)
    if (!runtime.sentinel || runtime.cursor >= runtime.items.length) {
      runtime.sentinel?.remove()
      runtime.sentinel = null
      return
    }

    const canObserve = typeof window.IntersectionObserver === 'function'
    if (!canObserve) {
      while (runtime.cursor < runtime.items.length) appendNextBatch()
      return
    }

    try {
      runtime.loadObserver = new window.IntersectionObserver(entries => {
        const entry = entries[0]
        runtime.sentinelIntersecting = Boolean(entry?.isIntersecting)
        if (runtime.sentinelIntersecting && runtime.hasScrolled) queueNextBatch()
      }, { rootMargin: loadRootMargin })
      runtime.loadObserver.observe(runtime.sentinel)
    } catch {
      while (runtime.cursor < runtime.items.length) appendNextBatch()
      return
    }

    runtime.scrollHandler = () => {
      if (window.scrollY <= scrollActivationY) return
      runtime.hasScrolled = true
      if (runtime.sentinelIntersecting) queueNextBatch()
    }
    window.addEventListener('scroll', runtime.scrollHandler, { passive: true })
  }

  // Initialization and PJAX/BFCache lifecycle.
  const readItems = root => {
    const payload = root.querySelector('#memorable-moments-data')?.textContent || '[]'
    try {
      const parsed = JSON.parse(payload)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  const init = () => {
    const root = document.querySelector(rootSelector)
    if (!root) {
      cleanup()
      clearHeroBootClass()
      clearViewBootClass()
      if (!document.querySelector('.memorable-moment-detail')) {
        setRestoreClass(false)
      }
      return false
    }
    if (runtime.root === root && root.dataset.momentsInitialized === 'true') return true

    cleanup({ preserveHeroBootState: true })
    runtime.root = root
    runtime.items = readItems(root)
    runtime.cursor = Math.min(initialCount, runtime.items.length)
    runtime.restoreState = readRestoreRequest(runtime.items)
    const initialViewMode = runtime.restoreState?.viewMode || readStoredViewMode()
    applyViewMode(root, initialViewMode, { persist: true })
    document.documentElement.classList.add('is-memorable-moments-switch-ready')
    clearViewBootClass()
    setRestoreClass(Boolean(runtime.restoreState))
    skipPageMotionForRestore(root)
    if (runtime.restoreState && getHashSlug()) clearRestoreHash()
    if (runtime.restoreState) rememberHistoryRestoreMarker(runtime.restoreState)
    root.dataset.momentsInitialized = 'true'
    root.dataset.momentsState = runtime.restoreState ? 'restoring' : 'idle'
    bindHover(root)
    bindImageFallback(root)

    if (runtime.viewMode === VIEW_MODE.GRID) {
      appendAllGridItems(root, { showImmediately: false })
    } else if (runtime.restoreState) {
      appendItemsTo(runtime.restoreState.loadedCount, { showImmediately: false })
    }

    runtime.motionQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : { matches: false }
    runtime.reduced = runtime.motionQuery.matches
    runtime.motionHandler = () => {
      runtime.reduced = runtime.motionQuery.matches
      if (runtime.reduced) {
        runtime.animations.forEach(animation => animation.cancel())
        runtime.animations.clear()
        clearHeroEntrance()
        clearHeroBootClass()
        root.querySelectorAll('.moment-item').forEach(showCardImmediately)
        root.querySelector('.moments-timeline__line')?.style.removeProperty('clip-path')
      }
    }
    if (runtime.motionQuery.addEventListener) runtime.motionQuery.addEventListener('change', runtime.motionHandler)
    else runtime.motionQuery.addListener?.(runtime.motionHandler)

    const generation = runtime.generation
    const heroTargets = runtime.restoreState || runtime.reduced ? [] : prepareHeroEntrance(root)
    if (!runtime.restoreState) clearHeroBootClass()
    if (runtime.restoreState) armRestoreGuard(root, runtime.restoreState, generation)
    scheduleFrame(() => {
      if (runtime.generation !== generation || runtime.root !== root || !root.isConnected) return
      try {
        const restoreState = runtime.restoreState
        if (restoreState) {
          root.dataset.momentsState = 'ready'
        } else if (runtime.viewMode === VIEW_MODE.GRID) {
          root.dataset.momentsState = 'ready'
          if (runtime.reduced) {
            root.querySelectorAll('.moment-item').forEach(showCardImmediately)
          } else {
            const gridPlan = getGridRevealPlan(root)
            scheduleFrame(() => {
              playHeroEntrance(heroTargets, generation)
              playGridRowReveal(gridPlan, generation)
            })
          }
        } else {
          animateInitialTimeline(root, runtime.reduced)
          if (!runtime.reduced) playHeroEntrance(heroTargets, generation)
          observeCards(root)
        }
        if (runtime.viewMode === VIEW_MODE.TIMELINE) setupLoading(root)
        else cancelTimelineLoading(root)
        if (restoreState) restoreTimelinePosition(root, restoreState, generation)
      } catch (error) {
        if (runtime.restoreState) {
          failTimelineRestore(root, runtime.restoreState, generation, 'timeline initialization failed', {
            message: error instanceof Error ? error.message : String(error)
          })
        } else {
          root.dataset.momentsState = 'ready'
          root.querySelectorAll('.moment-item').forEach(showCardImmediately)
          clearHeroEntrance()
          clearHeroBootClass()
          setRestoreClass(false)
          clearRevealState(root)
        }
      }
    })
    return true
  }

  window.MemorableMoments = { init, cleanup }

  if (!window.memorableMomentsNavigationStateBound) {
    window.memorableMomentsNavigationStateBound = true
    document.addEventListener('click', event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const viewButton = event.target?.closest?.('[data-view-mode]')
      const viewRoot = viewButton?.closest?.(rootSelector)
      if (viewButton && viewRoot?.isConnected) {
        event.preventDefault()
        switchViewMode(viewRoot, viewButton.dataset.viewMode)
        return
      }
      const link = event.target?.closest?.('a.moment-card[href][data-moment-slug]')
      const root = link?.closest(rootSelector)
      if (!link || !root?.isConnected) return
      captureMomentNavigation(link)

      const generatedItem = link.closest('.moment-item[data-moment-generated]')
      if (generatedItem && !event.defaultPrevented && window.pjax?.loadUrl) {
        event.preventDefault()
        window.pjax.loadUrl(link.href)
      }
    }, true)
  }

  init()

  if (!window.memorableMomentsPjaxBound) {
    window.memorableMomentsPjaxBound = true
    document.addEventListener('pjax:send', () => cleanup({ preserveVisualState: true }))
    document.addEventListener('pjax:complete', init)
    document.addEventListener('pjax:error', () => {
      cleanup()
      setRestoreClass(false)
    })
    window.addEventListener('pageshow', event => {
      if (event.persisted) cleanup()
      init()
    })
  }
})()
