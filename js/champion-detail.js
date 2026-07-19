(() => {
  'use strict'

  const MOVE_DURATION = 560
  const FLIP_DURATION = 460
  const FLIP_DELAY = 130
  const FINAL_MOVE_DURATION = 400
  const MATCHES_REVEAL_DELAY = 190
  const RETURN_TRANSITION_DURATION = 300
  const ROOT_STATE_CLASSES = [
    'is-detail',
    'is-detail-layout',
    'is-detail-opening',
    'is-detail-closing',
    'is-return-positioning',
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
    controller: null,
    root: null,
    viewport: null,
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
    transitionCard: null,
    state: 'timeline',
    generation: 0,
    frames: new Set(),
    timers: new Set(),
    transitionCleanups: new Set(),
    pagePath: '',
    pageSearch: ''
  }

  const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const getTriggerId = trigger => trigger?.getAttribute('data-championship-detail') || ''
  const getDetailTrigger = (root, id) => root?.querySelector(`[data-championship-detail="${CSS.escape(id)}"]`)
  const getHashDetailId = () => window.location.hash.slice(1)
  const isKnownDetailId = id => Boolean(id && runtime.panels.has(id) && runtime.heroDetails.has(id))

  const queueFrame = callback => {
    const frame = window.requestAnimationFrame(() => {
      runtime.frames.delete(frame)
      callback()
    })
    runtime.frames.add(frame)
    return frame
  }

  const queueTimer = (callback, delay) => {
    const timer = window.setTimeout(() => {
      runtime.timers.delete(timer)
      callback()
    }, delay)
    runtime.timers.add(timer)
    return timer
  }

  const clearAsyncWork = () => {
    runtime.frames.forEach(frame => window.cancelAnimationFrame(frame))
    runtime.timers.forEach(timer => window.clearTimeout(timer))
    runtime.transitionCleanups.forEach(cleanup => cleanup())
    runtime.frames.clear()
    runtime.timers.clear()
    runtime.transitionCleanups.clear()
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
    const events = Array.from(runtime.root?.querySelectorAll('.championship-event') || [])
    const originEvent = trigger?.closest('.championship-event')
    const slug = context.slug || getTriggerId(trigger)
    const index = Number.isInteger(context.index) && context.index >= 0
      ? context.index
      : originEvent ? events.indexOf(originEvent) : -1
    runtime.openContext = Object.freeze({
      slug,
      index,
      card: trigger
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
    const indexedEvent = Number.isInteger(originIndex) && originIndex >= 0
      ? events[originIndex]
      : null
    const targetEvent = slugEvent || indexedEvent || events[events.length - 1]
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

  const waitForTransition = (element, propertyNames, duration, generation, callback) => {
    const expectedProperties = Array.isArray(propertyNames) ? propertyNames : [propertyNames]
    let finished = false
    let fallback = null

    const cleanup = () => {
      element?.removeEventListener('transitionend', handleTransitionEnd)
      if (fallback) window.clearTimeout(fallback)
      runtime.transitionCleanups.delete(cleanup)
    }
    const finish = () => {
      if (finished) return
      finished = true
      cleanup()
      if (generation === runtime.generation) callback()
    }
    const handleTransitionEnd = event => {
      if (event.target === element && expectedProperties.includes(event.propertyName)) finish()
    }

    element.addEventListener('transitionend', handleTransitionEnd)
    fallback = window.setTimeout(finish, duration + 140)
    runtime.transitionCleanups.add(cleanup)
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

  const moveTransitionCard = (clone, sourceRect, targetRect, generation, callback, duration = MOVE_DURATION) => {
    if (!clone || !isValidRect(sourceRect) || !isValidRect(targetRect)) {
      callback()
      return
    }
    queueFrame(() => {
      if (generation !== runtime.generation || clone !== runtime.transitionCard) return
      const translateX = targetRect.left - sourceRect.left
      const translateY = targetRect.top - sourceRect.top
      const scaleX = targetRect.width / sourceRect.width
      const scaleY = targetRect.height / sourceRect.height
      waitForTransition(clone, 'transform', duration, generation, callback)
      clone.style.setProperty('--detail-move-duration', `${duration}ms`)
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
      if (generation !== runtime.generation || clone !== runtime.transitionCard) return
      waitForTransition(inner, 'transform', FLIP_DURATION, generation, callback)
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

  const restoreTimeline = ({ position = true } = {}) => {
    removeTransitionCard()
    if (position) positionOriginCard()
    runtime.originCard?.setAttribute('aria-expanded', 'false')
    setOriginHidden(false)
    runtime.originCard = null
    clearRootState()
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
    runtime.generation += 1
    clearAsyncWork()
    if (clearHash) removeDetailHash()
    restoreTimeline()
  }

  const destroy = () => {
    runtime.controller?.abort()
    runtime.generation += 1
    clearAsyncWork()
    restoreTimeline({ position: false })
    runtime.controller = null
    runtime.root = null
    runtime.viewport = null
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
    if (generation !== runtime.generation) return
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
    if (generation !== runtime.generation) return
    runtime.root?.classList.add('is-detail-content-visible', 'is-detail-copy-visible')
    showDetailHero(true)
    queueTimer(() => {
      if (generation === runtime.generation) runtime.root?.classList.add('is-detail-matches-visible')
    }, MATCHES_REVEAL_DELAY)
    moveTransitionCard(clone, sourceRect, finalRect, generation, () => {
      if (generation !== runtime.generation) return
      removeTransitionCard()
      runtime.root?.classList.add('is-detail-card-visible', 'is-detail-matches-visible')
      finishOpen(generation)
    }, FINAL_MOVE_DURATION)
  }

  const startSharedCardTransition = (clone, sourceRect, transitionRect, finalRect, generation) => {
    let moveComplete = false
    let flipComplete = false
    const finishSharedCard = () => {
      if (!moveComplete || !flipComplete || generation !== runtime.generation) return
      startFinalCardPlacement(clone, sourceRect, finalRect, generation)
    }
    moveTransitionCard(clone, sourceRect, transitionRect, generation, () => {
      moveComplete = true
      finishSharedCard()
    })
    queueTimer(() => {
      if (generation !== runtime.generation || clone !== runtime.transitionCard) return
      flipTransitionCard(clone, generation, () => {
        flipComplete = true
        finishSharedCard()
      })
    }, FLIP_DELAY)
  }

  const showDetailImmediately = (trigger, id, updateHistory = false, context = {}) => {
    if (!trigger || runtime.state !== 'timeline' || !selectDetail(id)) return
    clearAsyncWork()
    runtime.generation += 1
    rememberOrigin(trigger, context)
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
    if (context.slug && context.slug !== getTriggerId(trigger)) return
    if (!trigger || runtime.state !== 'timeline' || !selectDetail(id)) return
    if (prefersReducedMotion()) {
      showDetailImmediately(trigger, id, true, context)
      return
    }

    clearAsyncWork()
    runtime.generation += 1
    const generation = runtime.generation
    const sourceRect = trigger.getBoundingClientRect()
    if (!isValidRect(sourceRect)) {
      resetSelection()
      return
    }

    runtime.state = 'transitioning-to-detail'
    rememberOrigin(trigger, context)
    trigger.setAttribute('aria-expanded', 'true')
    positionMatchesAtLatest()
    clearRootState()
    runtime.root?.classList.add('is-detail-layout', 'is-detail-opening')
    runtime.root?.setAttribute('aria-busy', 'true')
    setHistoryDetail(id)

    queueFrame(() => queueFrame(() => {
      if (generation !== runtime.generation) return
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

  const finishClose = generation => {
    if (generation !== runtime.generation) return
    const focusTarget = runtime.originCard
    restoreTimeline({ position: false })
    focusTarget?.focus({ preventScroll: true })
  }

  const prepareReturnPosition = (generation, callback) => {
    runtime.root?.classList.add('is-return-positioning')
    const finishPositioning = () => {
      if (generation !== runtime.generation) return
      runtime.root?.classList.remove('is-return-positioning')
      callback?.()
    }
    const restored = window.ChampionshipTimeline?.restoreBySlug?.(runtime.openContext?.slug, finishPositioning)
    if (restored) return

    queueFrame(() => queueFrame(() => {
      if (generation !== runtime.generation) return
      positionOriginCard()
      finishPositioning()
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
      runtime.generation += 1
      clearAsyncWork()
      const generation = runtime.generation
      prepareReturnPosition(generation, () => finishClose(generation))
      return
    }

    clearAsyncWork()
    runtime.generation += 1
    const generation = runtime.generation
    runtime.state = 'transitioning-to-timeline'
    prepareTimelineForReturn()
    waitForTransition(runtime.heroTimeline || runtime.panel, 'opacity', RETURN_TRANSITION_DURATION, generation, () => finishClose(generation))
    clearRootState()
    runtime.root?.classList.add(
      'is-detail-layout',
      'is-detail-closing',
      'is-detail-card-visible',
      'is-return-positioning'
    )
    runtime.root?.setAttribute('aria-busy', 'true')
    prepareReturnPosition(generation)
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

  const bindMatchTrack = (viewport, signal) => {
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
      const gap = Number.parseFloat(getComputedStyle(list).columnGap) || 18
      viewport.scrollTo({
        left: viewport.scrollLeft + direction * (firstCard.getBoundingClientRect().width + gap),
        behavior: prefersReducedMotion() ? 'auto' : 'smooth'
      })
    }
    viewport.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      drag.pointerId = event.pointerId
      drag.startX = event.clientX
      drag.startScrollLeft = viewport.scrollLeft
      drag.isDragging = false
    }, { signal })
    viewport.addEventListener('pointermove', event => {
      if (drag.pointerId !== event.pointerId) return
      const delta = event.clientX - drag.startX
      if (!drag.isDragging && Math.abs(delta) < 6) return
      if (!drag.isDragging) {
        drag.isDragging = true
        viewport.classList.add('is-dragging')
        viewport.setPointerCapture?.(event.pointerId)
      }
      event.preventDefault()
      viewport.scrollLeft = drag.startScrollLeft - delta
    }, { signal })
    viewport.addEventListener('pointerup', resetDrag, { signal })
    viewport.addEventListener('pointercancel', resetDrag, { signal })
    viewport.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      scrollMatches(event.key === 'ArrowLeft' ? -1 : 1)
    }, { signal })
  }

  const bindImageFallbacks = (root, signal) => {
    root.querySelectorAll('.championship-detail img').forEach(image => {
      image.addEventListener('error', () => {
        image.hidden = true
        const team = image.closest('[data-match-team]')
        if (team) {
          const fallback = team.querySelector('[data-match-logo-fallback]')
          fallback?.removeAttribute('hidden')
          fallback?.setAttribute('aria-hidden', 'false')
        } else {
          image.closest('.championship-detail__visual-media')?.classList.add('is-image-failed')
        }
      }, { signal })
    })
  }

  const init = () => {
    destroy()
    const root = document.querySelector('.champions-page')
    const shell = root?.querySelector('.champions-timeline-shell')
    const viewport = shell?.querySelector('.champions-timeline__viewport')
    if (!root || !shell || !viewport) return false

    const panels = new Map(Array.from(root.querySelectorAll('[data-championship-detail-panel]')).map(panel => [panel.getAttribute('data-championship-detail-panel'), panel]))
    const heroDetails = new Map(Array.from(root.querySelectorAll('[data-champions-hero-detail]')).map(hero => [hero.getAttribute('data-champions-hero-detail'), hero]))
    const validIds = new Set(Array.from(root.querySelectorAll('[data-championship-detail]')).map(trigger => getTriggerId(trigger)))
    for (const id of panels.keys()) {
      if (!validIds.has(id) || !heroDetails.has(id)) panels.delete(id)
    }
    if (!panels.size) return false

    const controller = new AbortController()
    const { signal } = controller
    runtime.controller = controller
    runtime.root = root
    runtime.viewport = viewport
    runtime.panels = panels
    runtime.heroDetails = heroDetails
    runtime.heroTimeline = root.querySelector('[data-champions-hero-timeline]')
    runtime.pagePath = window.location.pathname
    runtime.pageSearch = window.location.search
    root.querySelectorAll('[data-championship-detail]').forEach(trigger => trigger.setAttribute('aria-expanded', 'false'))
    hideAllPanels()
    showDetailHero(false)

    root.addEventListener('championship:open-detail', event => {
      const trigger = event.detail?.card || event.detail?.trigger
      if (!trigger || !root.contains(trigger)) return
      openDetail(trigger, {
        slug: event.detail?.slug || getTriggerId(trigger),
        index: event.detail?.index
      })
    }, { signal })

    const handleHistoryChange = event => {
      const samePage = window.location.pathname === runtime.pagePath && window.location.search === runtime.pageSearch
      if (!samePage) return
      const wantsDetail = isKnownDetailId(getHashDetailId())
      if (event.type === 'popstate' && (wantsDetail || runtime.state !== 'timeline')) event.stopImmediatePropagation()
      syncFromUrl()
    }

    window.addEventListener('popstate', handleHistoryChange, { capture: true, signal })
    window.addEventListener('championship:history-popstate', syncFromUrl, { signal })
    window.addEventListener('hashchange', handleHistoryChange, { signal })
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') requestClose()
    }, { signal })
    window.addEventListener('resize', () => {
      if (runtime.state.startsWith('transitioning')) abortToTimeline({ clearHash: true })
    }, { signal })

    root.querySelectorAll('.championship-detail__match-viewport').forEach(matchViewport => bindMatchTrack(matchViewport, signal))
    bindImageFallbacks(root, signal)
    syncFromUrl()
    return true
  }

  window.ChampionDetail = { init, destroy }
  init()

  if (!window.championDetailLifecycleBound) {
    window.championDetailLifecycleBound = true
    document.addEventListener('pjax:send', destroy)
    document.addEventListener('pjax:error', destroy)
    window.addEventListener('pageshow', event => {
      if (event.persisted && document.querySelector('.champions-page') && !runtime.controller) init()
    })
  }
})()
