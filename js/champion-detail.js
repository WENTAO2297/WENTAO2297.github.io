/**
 * @typedef {{slug: string, index: number, card: HTMLElement, timelineScrollY: number}} DetailOpenContext
 * @typedef {{targetY: number, corrected: boolean, previousDocumentBehavior: string, previousBodyBehavior: string}} TimelineScrollRestore
 */
(() => {
  'use strict'

  const MOVE_DURATION_MS = 560
  const FLIP_DURATION_MS = 460
  const FLIP_DELAY_MS = 130
  const FINAL_MOVE_DURATION_MS = 400
  const MATCHES_REVEAL_DELAY_MS = 190
  const RETURN_TRANSITION_DURATION_MS = 320
  const TRANSITION_FALLBACK_BUFFER_MS = 140
  const MVP_PREPARE_TIMEOUT_MS = 1800
  const MATCH_CARD_GAP_PX = 18
  const MATCH_DRAG_THRESHOLD_PX = 6
  const ROOT_STATE_CLASSES = [
    'is-detail',
    'is-detail-layout',
    'is-detail-opening',
    'is-detail-closing',
    'is-return-positioning',
    'is-restoring-timeline-view',
    'is-detail-card-visible',
    'is-detail-content-visible',
    'is-detail-copy-visible',
    'is-detail-matches-visible'
  ]

  if (window.ChampionDetail) {
    window.ChampionDetail.init()
    return
  }

  const runtime = {
    lifecycle: null,
    transitionRuntime: null,
    root: null,
    viewport: null,
    timelineView: null,
    panels: new Map(),
    heroDetails: new Map(),
    detailId: null,
    panel: null,
    transitionSlot: null,
    cardSlot: null,
    flipCard: null,
    matchViewport: null,
    heroTimeline: null,
    heroDetail: null,
    originCard: null,
    originSlug: null,
    originIndex: null,
    openContext: null,
    previousScrollRestoration: null,
    isManagingScrollRestoration: false,
    /** @type {TimelineScrollRestore|null} */
    timelineScrollRestore: null,
    transitionCard: null,
    state: 'timeline',
    pageGeneration: 0,
    pendingDetailOpen: null,
    pagePath: '',
    pageSearch: ''
  }

  const addListener = (target, event, handler, options) => {
    return runtime.lifecycle?.addListener(target, event, handler, options)
  }

  const getTransitionRuntime = () => {
    if (runtime.transitionRuntime && !runtime.transitionRuntime.isDestroyed()) return runtime.transitionRuntime
    runtime.transitionRuntime = window.SitePageRuntime?.create?.({ name: 'champions-detail-transition' }) || null
    return runtime.transitionRuntime
  }

  const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const getTriggerId = trigger => trigger?.getAttribute('data-championship-detail') || ''
  const getDetailTrigger = (root, id) => root?.querySelector(`[data-championship-detail="${CSS.escape(id)}"]`)
  const getHashDetailId = () => window.location.hash.slice(1)
  const isKnownDetailId = id => Boolean(id && runtime.panels.has(id) && runtime.heroDetails.has(id))

  const queueFrame = callback => {
    const transitionRuntime = getTransitionRuntime()
    if (!transitionRuntime) return null
    let frame
    frame = window.requestAnimationFrame(() => {
      transitionRuntime.removeFrame(frame)
      callback()
    })
    return transitionRuntime.addFrame(frame)
  }

  const queueTimer = (callback, delay) => {
    const transitionRuntime = getTransitionRuntime()
    if (!transitionRuntime) return null
    let timer
    timer = window.setTimeout(() => {
      transitionRuntime.removeTimer(timer)
      callback()
    }, delay)
    return transitionRuntime.addTimer(timer)
  }

  const cancelTimer = timer => {
    if (timer == null) return
    window.clearTimeout(timer)
    runtime.transitionRuntime?.removeTimer(timer)
  }

  const clearAsyncWork = () => {
    runtime.transitionRuntime?.destroy()
    runtime.transitionRuntime = null
    runtime.root?.classList.remove('is-returning-to-timeline', 'is-returning-to-timeline-play')
  }

  const getPageScrollY = () => {
    const scrollY = Number(window.scrollY)
    if (Number.isFinite(scrollY)) return scrollY
    return Number(document.documentElement?.scrollTop || document.body?.scrollTop || 0)
  }

  const getPageScrollX = () => {
    const scrollX = Number(window.scrollX)
    if (Number.isFinite(scrollX)) return scrollX
    return Number(document.documentElement?.scrollLeft || document.body?.scrollLeft || 0)
  }

  const setPageScrollY = scrollY => {
    const targetY = Math.max(0, Number(scrollY) || 0)
    window.scrollTo(getPageScrollX(), targetY)
  }

  const takeOverScrollRestoration = () => {
    if (runtime.isManagingScrollRestoration) return
    try {
      runtime.previousScrollRestoration = window.history.scrollRestoration
      window.history.scrollRestoration = 'manual'
      runtime.isManagingScrollRestoration = true
    } catch {
      runtime.previousScrollRestoration = null
      runtime.isManagingScrollRestoration = false
    }
  }

  const restoreScrollRestoration = () => {
    if (!runtime.isManagingScrollRestoration) return
    try {
      window.history.scrollRestoration = runtime.previousScrollRestoration || 'auto'
    } catch {
      // Ignore browsers that expose a read-only scrollRestoration property.
    }
    runtime.previousScrollRestoration = null
    runtime.isManagingScrollRestoration = false
  }

  const beginTimelineScrollRestore = () => {
    const targetY = Number.isFinite(runtime.openContext?.timelineScrollY)
      ? Math.max(0, runtime.openContext.timelineScrollY)
      : 0
    const documentElement = document.documentElement
    const body = document.body
    runtime.timelineScrollRestore = {
      targetY,
      corrected: false,
      previousDocumentBehavior: documentElement?.style.scrollBehavior || '',
      previousBodyBehavior: body?.style.scrollBehavior || ''
    }
    if (documentElement) documentElement.style.scrollBehavior = 'auto'
    if (body) body.style.scrollBehavior = 'auto'
    setPageScrollY(targetY)
  }

  const settleTimelineScrollRestore = (generation, callback) => {
    const restore = runtime.timelineScrollRestore
    if (!restore) {
      callback?.()
      return
    }

    const finish = () => {
      if (generation !== runtime.pageGeneration) return
      callback?.()
    }

    const confirm = () => {
      if (generation !== runtime.pageGeneration || runtime.timelineScrollRestore !== restore) return
      const deviation = Math.abs(getPageScrollY() - restore.targetY)
      if (deviation > 1 && !restore.corrected) {
        restore.corrected = true
        setPageScrollY(restore.targetY)
        queueFrame(finish)
        return
      }
      finish()
    }

    queueFrame(() => queueFrame(confirm))
  }

  const restoreTimelineScrollControls = () => {
    const restore = runtime.timelineScrollRestore
    if (!restore) return
    const documentElement = document.documentElement
    const body = document.body
    if (documentElement) documentElement.style.scrollBehavior = restore.previousDocumentBehavior
    if (body) body.style.scrollBehavior = restore.previousBodyBehavior
    runtime.timelineScrollRestore = null
  }

  const clearRootState = () => {
    runtime.root?.classList.remove(...ROOT_STATE_CLASSES)
    runtime.root?.removeAttribute('aria-busy')
  }

  const showDetailHero = visible => {
    runtime.heroTimeline?.setAttribute('aria-hidden', visible ? 'true' : 'false')
    runtime.heroDetails.forEach(hero => {
      hero.setAttribute('aria-hidden', hero === runtime.heroDetail && visible ? 'false' : 'true')
    })
  }

  const hideAllPanels = () => {
    runtime.panels.forEach(panel => {
      panel.hidden = true
      panel.classList.remove('is-active')
      panel.setAttribute('aria-hidden', 'true')
    })
    runtime.heroDetails.forEach(hero => hero.classList.remove('is-active'))
  }

  const prepareMvpVisual = source => new Promise(resolve => {
    if (!source) {
      resolve({ ready: true, reason: 'no-image' })
      return
    }

    const image = new Image()
    let settled = false
    let timeoutId = null
    const finish = reason => {
      if (settled) return
      settled = true
      window.clearTimeout(timeoutId)
      image.onload = null
      image.onerror = null
      resolve({ ready: reason === 'decoded', reason })
    }

    timeoutId = window.setTimeout(() => finish('timeout'), MVP_PREPARE_TIMEOUT_MS)
    image.decoding = 'async'
    image.onload = () => {
      Promise.resolve(typeof image.decode === 'function' ? image.decode() : undefined)
        .catch(() => {})
        .then(() => finish('decoded'))
    }
    image.onerror = () => finish('error')
    image.src = source
    if (image.complete) {
      if (image.naturalWidth > 0) image.onload()
      else image.onerror()
    }
  })

  const clearPendingDetailOpen = transaction => {
    if (!transaction || runtime.pendingDetailOpen !== transaction) return
    transaction.trigger.disabled = false
    transaction.trigger.removeAttribute('aria-busy')
    transaction.trigger.removeAttribute('data-detail-pending')
    runtime.pendingDetailOpen = null
  }

  const requestDetailOpen = (trigger, context = {}) => {
    const id = context.slug || getTriggerId(trigger)
    const panel = runtime.panels.get(id)
    const visual = panel?.querySelector('.championship-detail__visual-image')
    if (!trigger || runtime.state !== 'timeline' || !isKnownDetailId(id) || runtime.pendingDetailOpen) return

    const transaction = { trigger, id, context, root: runtime.root }
    runtime.pendingDetailOpen = transaction
    trigger.disabled = true
    trigger.setAttribute('aria-busy', 'true')
    trigger.setAttribute('data-detail-pending', 'true')

    prepareMvpVisual(visual?.currentSrc || visual?.src || '').then(() => {
      if (runtime.pendingDetailOpen !== transaction || runtime.root !== transaction.root || !transaction.root?.isConnected || runtime.state !== 'timeline') return
      clearPendingDetailOpen(transaction)
      openDetail(trigger, context)
    })
  }

  const selectDetail = id => {
    if (!isKnownDetailId(id)) return false
    const panel = runtime.panels.get(id)
    const hero = runtime.heroDetails.get(id)
    const transitionSlot = panel.querySelector('[data-detail-transition-slot]')
    const cardSlot = panel.querySelector('.championship-detail__card-slot')
    const flipCard = panel.querySelector('[data-detail-flip]')
    if (!transitionSlot || !cardSlot || !flipCard) return false

    hideAllPanels()
    panel.hidden = false
    panel.classList.add('is-active')
    panel.setAttribute('aria-hidden', 'false')
    hero.classList.add('is-active')

    // requestDetailOpen prepares the selected MVP (decode/timeout) before showing its panel.
    // Promote the displayed DOM image to eager/high priority; other panels stay unchanged.
    const visual = panel.querySelector('.championship-detail__visual-image')
    if (visual) {
      visual.loading = 'eager'
      visual.fetchPriority = 'high'
    }

    runtime.detailId = id
    runtime.panel = panel
    runtime.heroDetail = hero
    runtime.transitionSlot = transitionSlot
    runtime.cardSlot = cardSlot
    runtime.flipCard = flipCard
    runtime.matchViewport = panel.querySelector('.championship-detail__match-viewport')
    return true
  }

  const setOriginHidden = hidden => {
    runtime.originCard?.classList.toggle('is-detail-origin-hidden', hidden)
  }

  const rememberOrigin = (trigger, context = {}) => {
    if (runtime.openContext) return
    takeOverScrollRestoration()
    const events = Array.from(runtime.root?.querySelectorAll('.championship-event') || [])
    const originEvent = trigger?.closest('.championship-event')
    const slug = context.slug || getTriggerId(trigger)
    const index = Number.isInteger(context.index) && context.index >= 0
      ? context.index
      : originEvent ? events.indexOf(originEvent) : -1
    runtime.openContext = Object.freeze({
      slug,
      index,
      card: trigger,
      timelineScrollY: Number.isFinite(context.timelineScrollY)
        ? context.timelineScrollY
        : getPageScrollY()
    })
    runtime.originCard = trigger
    runtime.originSlug = slug
    runtime.originIndex = index
  }

  const positionOriginCard = () => {
    const openContext = runtime.openContext
    const originSlug = openContext?.slug || runtime.originSlug
    const originIndex = Number.isInteger(openContext?.index)
      ? openContext.index
      : runtime.originIndex
    if (window.ChampionshipTimeline?.centerBySlug?.(originSlug)) return true

    const events = Array.from(runtime.root?.querySelectorAll('.championship-event') || [])
    if (!runtime.viewport || !events.length) return false
    const slugEvent = events.find(event => (
      event.querySelector('[data-championship-detail]')?.getAttribute('data-championship-detail') === originSlug
    ))
    const indexedEvent = Number.isInteger(originIndex) && originIndex >= 0 && events[originIndex] === slugEvent
      ? events[originIndex]
      : null
    const targetEvent = slugEvent || indexedEvent
    if (!targetEvent?.offsetWidth || !runtime.viewport.clientWidth) return false

    const maxScrollLeft = Math.max(0, runtime.viewport.scrollWidth - runtime.viewport.clientWidth)
    const targetLeft = targetEvent.offsetLeft + targetEvent.offsetWidth / 2 - runtime.viewport.clientWidth / 2
    const previousScrollBehavior = runtime.viewport.style.scrollBehavior
    const previousSnapType = runtime.viewport.style.scrollSnapType
    runtime.viewport.style.scrollBehavior = 'auto'
    runtime.viewport.style.scrollSnapType = 'none'
    runtime.viewport.scrollLeft = Math.max(0, Math.min(maxScrollLeft, targetLeft))
    void runtime.viewport.offsetWidth
    runtime.viewport.style.scrollSnapType = previousSnapType
    runtime.viewport.style.scrollBehavior = previousScrollBehavior
    events.forEach(event => {
      const isCurrent = event === targetEvent
      event.classList.toggle('is-current', isCurrent)
      if (isCurrent) event.setAttribute('aria-current', 'true')
      else event.removeAttribute('aria-current')
    })
    return true
  }

  const positionMatchesAtLatest = () => {
    const viewport = runtime.matchViewport
    if (!viewport || viewport.scrollWidth <= viewport.clientWidth) return
    const previousBehavior = viewport.style.scrollBehavior
    const previousSnap = viewport.style.scrollSnapType
    viewport.style.scrollBehavior = 'auto'
    viewport.style.scrollSnapType = 'none'
    viewport.scrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
    void viewport.offsetWidth
    viewport.style.scrollSnapType = previousSnap
    viewport.style.scrollBehavior = previousBehavior
  }

  const removeTransitionCard = () => {
    runtime.transitionCard?.remove()
    runtime.transitionCard = null
  }

  const isValidRect = rect => rect && rect.width > 0 && rect.height > 0

  const applyRect = (element, rect) => {
    element.style.left = `${rect.left}px`
    element.style.top = `${rect.top}px`
    element.style.width = `${rect.width}px`
    element.style.height = `${rect.height}px`
  }

  const waitForTransition = (element, propertyNames, durationMs, generation, callback) => {
    const transitionRuntime = getTransitionRuntime()
    if (!transitionRuntime) return
    const expectedProperties = Array.isArray(propertyNames) ? propertyNames : [propertyNames]
    let finished = false
    let cleaned = false
    let fallback = null

    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      removeListener?.()
      cancelTimer(fallback)
      fallback = null
    }
    const finish = () => {
      if (finished) return
      finished = true
      cleanup()
      if (generation === runtime.pageGeneration) callback()
    }
    const handleTransitionEnd = event => {
      if (event.target === element && expectedProperties.includes(event.propertyName)) finish()
    }

    const removeListener = transitionRuntime.addListener(element, 'transitionend', handleTransitionEnd)
    transitionRuntime.addCleanup(cleanup)
    fallback = queueTimer(finish, durationMs + TRANSITION_FALLBACK_BUFFER_MS)
  }

  const createTransitionCard = rect => {
    if (!runtime.flipCard || !isValidRect(rect)) return null
    removeTransitionCard()
    const clone = runtime.flipCard.cloneNode(true)
    clone.removeAttribute('data-detail-flip')
    clone.classList.add('championship-detail__transition-card')
    clone.setAttribute('aria-hidden', 'true')
    clone.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'))
    applyRect(clone, rect)
    document.body.appendChild(clone)
    void clone.offsetWidth
    runtime.transitionCard = clone
    return clone
  }

  const moveTransitionCard = (clone, sourceRect, targetRect, generation, callback, durationMs = MOVE_DURATION_MS) => {
    if (!clone || !isValidRect(sourceRect) || !isValidRect(targetRect)) {
      callback()
      return
    }
    queueFrame(() => {
      if (generation !== runtime.pageGeneration || clone !== runtime.transitionCard) return
      const translateX = targetRect.left - sourceRect.left
      const translateY = targetRect.top - sourceRect.top
      const scaleX = targetRect.width / sourceRect.width
      const scaleY = targetRect.height / sourceRect.height
      waitForTransition(clone, 'transform', durationMs, generation, callback)
      clone.style.setProperty('--detail-move-duration', `${durationMs}ms`)
      clone.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${scaleX}, ${scaleY})`
    })
  }

  const flipTransitionCard = (clone, generation, callback) => {
    const inner = clone?.querySelector('.championship-detail__flip-inner')
    if (!inner) {
      callback()
      return
    }
    queueFrame(() => {
      if (generation !== runtime.pageGeneration || clone !== runtime.transitionCard) return
      waitForTransition(inner, 'transform', FLIP_DURATION_MS, generation, callback)
      clone.classList.add('is-flipped')
    })
  }

  const resetSelection = () => {
    hideAllPanels()
    runtime.detailId = null
    runtime.panel = null
    runtime.transitionSlot = null
    runtime.cardSlot = null
    runtime.flipCard = null
    runtime.matchViewport = null
    runtime.heroDetail = null
  }

  const restoreTimeline = ({ position = true, preserveReturnAnimation = false } = {}) => {
    removeTransitionCard()
    if (position) positionOriginCard()
    restoreTimelineScrollControls()
    restoreScrollRestoration()
    runtime.originCard?.setAttribute('aria-expanded', 'false')
    setOriginHidden(false)
    runtime.originCard = null
    clearRootState()
    if (!preserveReturnAnimation) {
      runtime.root?.classList.remove('is-returning-to-timeline', 'is-returning-to-timeline-play')
    }
    showDetailHero(false)
    resetSelection()
    runtime.originSlug = null
    runtime.originIndex = null
    runtime.openContext = null
    runtime.state = 'timeline'
  }

  const removeDetailHash = () => {
    if (!isKnownDetailId(getHashDetailId())) return
    const state = window.history.state && typeof window.history.state === 'object'
      ? { ...window.history.state }
      : {}
    delete state.championDetail
    state.url = new URL(`${window.location.pathname}${window.location.search}`, window.location.href).href
    state.title = document.title
    window.history.replaceState(state, document.title, `${window.location.pathname}${window.location.search}`)
  }

  const abortToTimeline = ({ clearHash = false } = {}) => {
    runtime.pageGeneration += 1
    clearAsyncWork()
    if (clearHash) removeDetailHash()
    restoreTimeline()
  }

  const destroy = () => {
    clearPendingDetailOpen(runtime.pendingDetailOpen)
    runtime.pageGeneration += 1
    clearAsyncWork()
    restoreTimeline({ position: false })
    runtime.lifecycle?.destroy()
    runtime.lifecycle = null
    runtime.root = null
    runtime.viewport = null
    runtime.timelineView = null
    runtime.panels = new Map()
    runtime.heroDetails = new Map()
    runtime.heroTimeline = null
    runtime.pagePath = ''
    runtime.pageSearch = ''
  }

  const setHistoryDetail = id => {
    const state = window.history.state && typeof window.history.state === 'object'
      ? { ...window.history.state }
      : {}
    const targetPath = `${window.location.pathname}${window.location.search}#${id}`
    const fallbackScrollPosition = [
      window.scrollX || document.documentElement.scrollLeft || 0,
      window.scrollY || document.documentElement.scrollTop || 0
    ]
    window.history.pushState({
      ...state,
      url: new URL(targetPath, window.location.href).href,
      title: document.title,
      uid: `pjax${Date.now()}_champion-detail`,
      scrollPos: Array.isArray(state.scrollPos) ? state.scrollPos : fallbackScrollPosition,
      championDetail: id
    }, document.title, targetPath)
  }

  const finishOpen = generation => {
    if (generation !== runtime.pageGeneration) return
    clearRootState()
    runtime.root?.classList.add(
      'is-detail',
      'is-detail-layout',
      'is-detail-card-visible',
      'is-detail-content-visible',
      'is-detail-copy-visible',
      'is-detail-matches-visible'
    )
    showDetailHero(true)
    runtime.state = 'detail'
  }

  const startFinalCardPlacement = (clone, sourceRect, finalRect, generation) => {
    if (generation !== runtime.pageGeneration) return
    runtime.root?.classList.add('is-detail-content-visible', 'is-detail-copy-visible')
    showDetailHero(true)
    queueTimer(() => {
      if (generation === runtime.pageGeneration) runtime.root?.classList.add('is-detail-matches-visible')
    }, MATCHES_REVEAL_DELAY_MS)
    moveTransitionCard(clone, sourceRect, finalRect, generation, () => {
      if (generation !== runtime.pageGeneration) return
      removeTransitionCard()
      runtime.root?.classList.add('is-detail-card-visible', 'is-detail-matches-visible')
      finishOpen(generation)
    }, FINAL_MOVE_DURATION_MS)
  }

  const startSharedCardTransition = (clone, sourceRect, transitionRect, finalRect, generation) => {
    let moveComplete = false
    let flipComplete = false
    const finishSharedCard = () => {
      if (!moveComplete || !flipComplete || generation !== runtime.pageGeneration) return
      startFinalCardPlacement(clone, sourceRect, finalRect, generation)
    }
    moveTransitionCard(clone, sourceRect, transitionRect, generation, () => {
      moveComplete = true
      finishSharedCard()
    })
    queueTimer(() => {
      if (generation !== runtime.pageGeneration || clone !== runtime.transitionCard) return
      flipTransitionCard(clone, generation, () => {
        flipComplete = true
        finishSharedCard()
      })
    }, FLIP_DELAY_MS)
  }

  const showDetailImmediately = (trigger, id, updateHistory = false, context = {}) => {
    const timelineScrollY = getPageScrollY()
    if (!trigger || runtime.state !== 'timeline' || !selectDetail(id)) return
    clearAsyncWork()
    runtime.pageGeneration += 1
    rememberOrigin(trigger, { ...context, timelineScrollY })
    positionOriginCard()
    trigger.setAttribute('aria-expanded', 'true')
    setOriginHidden(true)
    positionMatchesAtLatest()
    clearRootState()
    runtime.root?.classList.add(
      'is-detail',
      'is-detail-layout',
      'is-detail-card-visible',
      'is-detail-content-visible',
      'is-detail-copy-visible',
      'is-detail-matches-visible'
    )
    showDetailHero(true)
    runtime.state = 'detail'
    if (updateHistory) setHistoryDetail(id)
  }

  const openDetail = (trigger, context = {}) => {
    const id = context.slug || getTriggerId(trigger)
    const timelineScrollY = getPageScrollY()
    if (context.slug && context.slug !== getTriggerId(trigger)) return
    if (!trigger || runtime.state !== 'timeline' || !selectDetail(id)) return
    if (prefersReducedMotion()) {
      showDetailImmediately(trigger, id, true, context)
      return
    }

    clearAsyncWork()
    runtime.pageGeneration += 1
    const generation = runtime.pageGeneration
    const sourceRect = trigger.getBoundingClientRect()
    if (!isValidRect(sourceRect)) {
      resetSelection()
      return
    }

    runtime.state = 'transitioning-to-detail'
    rememberOrigin(trigger, { ...context, timelineScrollY })
    trigger.setAttribute('aria-expanded', 'true')
    positionMatchesAtLatest()
    clearRootState()
    runtime.root?.classList.add('is-detail-layout', 'is-detail-opening')
    runtime.root?.setAttribute('aria-busy', 'true')
    setHistoryDetail(id)

    queueFrame(() => queueFrame(() => {
      if (generation !== runtime.pageGeneration) return
      const transitionRect = runtime.transitionSlot?.getBoundingClientRect()
      const finalRect = runtime.cardSlot?.getBoundingClientRect()
      if (!isValidRect(transitionRect) || !isValidRect(finalRect)) {
        abortToTimeline({ clearHash: true })
        return
      }
      const clone = createTransitionCard(sourceRect)
      if (!clone) {
        abortToTimeline({ clearHash: true })
        return
      }
      setOriginHidden(true)
      startSharedCardTransition(clone, sourceRect, transitionRect, finalRect, generation)
    }))
  }

  const startReturnAnimation = generation => {
    if (generation !== runtime.pageGeneration) return

    const root = runtime.root
    const timelineView = runtime.timelineView
    const focusTarget = runtime.originCard
    if (!root || !timelineView) {
      restoreTimeline({ position: false })
      return
    }

    root.classList.add('is-returning-to-timeline')
    restoreTimeline({ position: false, preserveReturnAnimation: true })

    let fallbackTimer = null
    const finish = () => {
      if (generation !== runtime.pageGeneration) return
      cleanup()
      root.classList.remove('is-returning-to-timeline', 'is-returning-to-timeline-play')
      focusTarget?.focus({ preventScroll: true })
    }
    const handleTransitionEnd = event => {
      if (event.target === timelineView && event.propertyName === 'opacity') finish()
    }
    const cleanup = () => {
      removeTransitionListener?.()
      cancelTimer(fallbackTimer)
      fallbackTimer = null
    }

    if (prefersReducedMotion()) {
      restoreTimeline({ position: false })
      focusTarget?.focus({ preventScroll: true })
      return
    }

    const transitionRuntime = getTransitionRuntime()
    if (!transitionRuntime) {
      restoreTimeline({ position: false })
      focusTarget?.focus({ preventScroll: true })
      return
    }
    const removeTransitionListener = transitionRuntime.addListener(timelineView, 'transitionend', handleTransitionEnd)
    transitionRuntime.addCleanup(cleanup)
    void timelineView.offsetWidth
    queueFrame(() => {
      if (generation !== runtime.pageGeneration) return
      queueFrame(() => {
        if (generation !== runtime.pageGeneration) return
        root.classList.add('is-returning-to-timeline-play')
        fallbackTimer = queueTimer(finish, RETURN_TRANSITION_DURATION_MS + 80)
      })
    })
  }

  const completeReturnPosition = (generation, callback) => {
    if (generation !== runtime.pageGeneration) return
    const completed = window.ChampionshipTimeline?.completeOriginRestore?.(() => {
      if (generation === runtime.pageGeneration) callback?.()
    })
    if (!completed) callback?.()
  }

  const prepareReturnPosition = (generation, callback) => {
    runtime.root?.classList.add('is-return-positioning', 'is-restoring-timeline-view')
    beginTimelineScrollRestore()
    let verticalComplete = false
    let horizontalComplete = false
    const finishPositioning = () => {
      if (generation !== runtime.pageGeneration) return
      if (!verticalComplete || !horizontalComplete) return
      runtime.root?.classList.remove('is-return-positioning')
      callback?.()
    }

    settleTimelineScrollRestore(generation, () => {
      verticalComplete = true
      finishPositioning()
    })

    const markHorizontalComplete = () => {
      horizontalComplete = true
      finishPositioning()
    }
    const restored = window.ChampionshipTimeline?.restoreBySlug?.(runtime.openContext?.slug, markHorizontalComplete)
    if (restored) return

    queueFrame(() => queueFrame(() => {
      if (generation !== runtime.pageGeneration) return
      positionOriginCard()
      markHorizontalComplete()
    }))
  }

  const prepareTimelineForReturn = () => {
    removeTransitionCard()
    if (!runtime.originCard) return
    runtime.originCard.classList.remove('is-detail-origin-hidden')
    ;['opacity', 'visibility', 'transform', 'translate', 'transition'].forEach(property => {
      runtime.originCard.style.removeProperty(property)
    })
    runtime.originCard.setAttribute('aria-expanded', 'false')
  }

  const closeDetail = animate => {
    if (!runtime.panel || runtime.state === 'timeline' || runtime.state === 'transitioning-to-timeline') return
    if (runtime.state === 'transitioning-to-detail') {
      abortToTimeline()
      return
    }
    if (!animate || prefersReducedMotion()) {
      runtime.pageGeneration += 1
      clearAsyncWork()
      const generation = runtime.pageGeneration
      prepareReturnPosition(generation, () => {
        completeReturnPosition(generation, () => startReturnAnimation(generation))
      })
      return
    }

    clearAsyncWork()
    runtime.pageGeneration += 1
    const generation = runtime.pageGeneration
    runtime.state = 'transitioning-to-timeline'
    prepareTimelineForReturn()
    clearRootState()
    runtime.root?.classList.add(
      'is-detail-layout',
      'is-detail-closing',
      'is-detail-card-visible',
      'is-return-positioning',
      'is-restoring-timeline-view'
    )
    runtime.root?.setAttribute('aria-busy', 'true')
    prepareReturnPosition(generation, () => {
      completeReturnPosition(generation, () => startReturnAnimation(generation))
    })
  }

  const requestClose = () => {
    if (runtime.state === 'timeline' || runtime.state === 'transitioning-to-timeline') return
    const id = runtime.detailId
    if (runtime.state === 'transitioning-to-detail') {
      removeDetailHash()
      abortToTimeline()
      return
    }
    if (window.location.hash === `#${id}` && window.history.state?.championDetail === id) {
      window.history.back()
      return
    }
    if (window.location.hash === `#${id}`) removeDetailHash()
    closeDetail(true)
  }

  const syncFromUrl = () => {
    const requestedId = getHashDetailId()
    const wantsDetail = isKnownDetailId(requestedId)
    if (wantsDetail && runtime.state === 'timeline') {
      showDetailImmediately(getDetailTrigger(runtime.root, requestedId), requestedId)
      return
    }
    if (wantsDetail && runtime.detailId !== requestedId) {
      abortToTimeline()
      showDetailImmediately(getDetailTrigger(runtime.root, requestedId), requestedId)
      return
    }
    if (!wantsDetail && runtime.state === 'detail') closeDetail(true)
    else if (!wantsDetail && runtime.state === 'transitioning-to-detail') abortToTimeline()
  }

  const bindMatchTrack = viewport => {
    const drag = { pointerId: null, startX: 0, startScrollLeft: 0, isDragging: false }
    const resetDrag = () => {
      if (drag.pointerId !== null && viewport.hasPointerCapture?.(drag.pointerId)) viewport.releasePointerCapture(drag.pointerId)
      viewport.classList.remove('is-dragging')
      drag.pointerId = null
      drag.startX = 0
      drag.startScrollLeft = 0
      drag.isDragging = false
    }
    const scrollMatches = direction => {
      const firstCard = viewport.querySelector('.championship-match-card')
      const list = viewport.querySelector('.championship-detail__match-list')
      if (!firstCard || !list) return
      const gap = Number.parseFloat(getComputedStyle(list).columnGap) || MATCH_CARD_GAP_PX
      viewport.scrollTo({
        left: viewport.scrollLeft + direction * (firstCard.getBoundingClientRect().width + gap),
        behavior: prefersReducedMotion() ? 'auto' : 'smooth'
      })
    }
    addListener(viewport, 'pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      drag.pointerId = event.pointerId
      drag.startX = event.clientX
      drag.startScrollLeft = viewport.scrollLeft
      drag.isDragging = false
    })
    addListener(viewport, 'pointermove', event => {
      if (drag.pointerId !== event.pointerId) return
      const delta = event.clientX - drag.startX
      if (!drag.isDragging && Math.abs(delta) < MATCH_DRAG_THRESHOLD_PX) return
      if (!drag.isDragging) {
        drag.isDragging = true
        viewport.classList.add('is-dragging')
        viewport.setPointerCapture?.(event.pointerId)
      }
      event.preventDefault()
      viewport.scrollLeft = drag.startScrollLeft - delta
    })
    addListener(viewport, 'pointerup', resetDrag)
    addListener(viewport, 'pointercancel', resetDrag)
    addListener(viewport, 'keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      scrollMatches(event.key === 'ArrowLeft' ? -1 : 1)
    })
  }

  const bindImageFallbacks = root => {
    root.querySelectorAll('.championship-detail img').forEach(image => {
      const team = image.closest('[data-match-team]')
      const fallback = team?.querySelector('[data-match-logo-fallback]')
      const showImage = () => {
        image.hidden = false
        fallback?.setAttribute('hidden', '')
        fallback?.setAttribute('aria-hidden', 'true')
      }
      const showFallback = () => {
        image.hidden = true
        if (team) {
          fallback?.removeAttribute('hidden')
          fallback?.setAttribute('aria-hidden', 'false')
        } else {
          image.closest('.championship-detail__visual-media')?.classList.add('is-image-failed')
        }
      }

      addListener(image, 'load', showImage)
      addListener(image, 'error', showFallback)
      if (image.complete) {
        if (image.naturalWidth > 0) showImage()
        else showFallback()
      }
    })
  }

  const initializeChampionDetailPage = () => {
    destroy()
    const root = document.querySelector('.champions-page')
    const timelineView = root?.querySelector('[data-champions-timeline-view]')
    const shell = root?.querySelector('.champions-timeline-shell')
    const viewport = shell?.querySelector('.champions-timeline__viewport')
    if (!root || !timelineView || !shell || !viewport) return false
    const lifecycle = window.SitePageRuntime?.create?.({ name: 'champions-detail' })
    if (!lifecycle) return false
    runtime.lifecycle = lifecycle

    const panels = new Map(Array.from(root.querySelectorAll('[data-championship-detail-panel]')).map(panel => [panel.getAttribute('data-championship-detail-panel'), panel]))
    const heroDetails = new Map(Array.from(root.querySelectorAll('[data-champions-hero-detail]')).map(hero => [hero.getAttribute('data-champions-hero-detail'), hero]))
    const validIds = new Set(Array.from(root.querySelectorAll('[data-championship-detail]')).map(trigger => getTriggerId(trigger)))
    for (const id of panels.keys()) {
      if (!validIds.has(id) || !heroDetails.has(id)) panels.delete(id)
    }
    if (!panels.size) return false

    runtime.root = root
    runtime.viewport = viewport
    runtime.timelineView = timelineView
    runtime.panels = panels
    runtime.heroDetails = heroDetails
    runtime.heroTimeline = root.querySelector('[data-champions-hero-timeline]')
    runtime.pagePath = window.location.pathname
    runtime.pageSearch = window.location.search
    root.querySelectorAll('[data-championship-detail]').forEach(trigger => trigger.setAttribute('aria-expanded', 'false'))
    hideAllPanels()
    showDetailHero(false)

    addListener(root, 'championship:open-detail', event => {
      const trigger = event.detail?.card || event.detail?.trigger
      if (!trigger || !root.contains(trigger)) return
      requestDetailOpen(trigger, {
        slug: event.detail?.slug || getTriggerId(trigger),
        index: event.detail?.index
      })
    })

    const handleHistoryChange = event => {
      const samePage = window.location.pathname === runtime.pagePath && window.location.search === runtime.pageSearch
      if (!samePage) return
      const wantsDetail = isKnownDetailId(getHashDetailId())
      if (event.type === 'popstate' && (wantsDetail || runtime.state !== 'timeline')) event.stopImmediatePropagation()
      syncFromUrl()
    }

    addListener(window, 'popstate', handleHistoryChange, { capture: true })
    addListener(window, 'championship:history-popstate', syncFromUrl)
    addListener(window, 'hashchange', handleHistoryChange)
    addListener(document, 'keydown', event => {
      if (event.key === 'Escape') requestClose()
    })
    addListener(window, 'resize', () => {
      if (runtime.state.startsWith('transitioning')) abortToTimeline({ clearHash: true })
    })

    root.querySelectorAll('.championship-detail__match-viewport').forEach(matchViewport => bindMatchTrack(matchViewport))
    bindImageFallbacks(root)
    syncFromUrl()
    return true
  }

  const shouldHandleHistory = event => {
    if (!runtime.root) return false
    const samePage = window.location.pathname === runtime.pagePath && window.location.search === runtime.pageSearch
    return samePage && (Boolean(event?.state?.championDetail) || runtime.state !== 'timeline')
  }

  window.ChampionDetail = { init: initializeChampionDetailPage, destroy, shouldHandleHistory }
  initializeChampionDetailPage()

  if (!window.championDetailLifecycleBound) {
    window.championDetailLifecycleBound = true
    document.addEventListener('pjax:send', destroy)
    document.addEventListener('pjax:error', destroy)
    window.addEventListener('pageshow', event => {
      if (!event.persisted || !document.querySelector('.champions-page')) return
      const hasDetailHash = isKnownDetailId(getHashDetailId())
      if (!hasDetailHash && runtime.root?.classList.contains('is-restoring-timeline-view')) {
        runtime.pageGeneration += 1
        clearAsyncWork()
        restoreTimeline()
      }
      if (!hasDetailHash && runtime.root?.classList.contains('is-returning-to-timeline')) {
        runtime.pageGeneration += 1
        clearAsyncWork()
        restoreTimeline()
      }
      if (!runtime.lifecycle) initializeChampionDetailPage()
    })
  }
})()
