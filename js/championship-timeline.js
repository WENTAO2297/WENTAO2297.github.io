(() => {
  'use strict'

  if (window.ChampionshipTimeline) {
    window.ChampionshipTimeline.init({ mode: 'latest' })
    return
  }

  // Page-local state is recreated on every PJAX entry.
  const runtime = {
    controller: null,
    resizeObserver: null,
    scrollFrame: null,
    geometryFrame: null,
    readyObserver: null,
    readyTimer: null,
    timelineShell: null,
    suppressNextClick: false,
    suppressClickTimer: null,
    initialPositionApplied: false,
    currentIndex: null,
    viewportWidth: 0,
    centerBySlug: null,
    restoreBySlug: null,
    restoration: null,
    restorationFrame: null,
    generation: 0
  }

  const destroy = () => {
    runtime.generation += 1
    runtime.controller?.abort()
    runtime.resizeObserver?.disconnect()
    if (runtime.scrollFrame) window.cancelAnimationFrame(runtime.scrollFrame)
    if (runtime.geometryFrame) window.cancelAnimationFrame(runtime.geometryFrame)
    if (runtime.restorationFrame) window.cancelAnimationFrame(runtime.restorationFrame)
    if (runtime.restoration?.viewport) {
      runtime.restoration.viewport.style.scrollSnapType = runtime.restoration.previousSnapType
      runtime.restoration.viewport.style.scrollBehavior = runtime.restoration.previousScrollBehavior
    }
    runtime.readyObserver?.disconnect()
    if (runtime.readyTimer) window.clearTimeout(runtime.readyTimer)
    runtime.timelineShell?.classList.remove('is-initializing', 'is-ready')
    runtime.timelineShell?.removeAttribute('aria-busy')
    if (runtime.suppressClickTimer) window.clearTimeout(runtime.suppressClickTimer)

    runtime.controller = null
    runtime.resizeObserver = null
    runtime.scrollFrame = null
    runtime.geometryFrame = null
    runtime.readyObserver = null
    runtime.readyTimer = null
    runtime.timelineShell = null
    runtime.suppressNextClick = false
    runtime.suppressClickTimer = null
    runtime.initialPositionApplied = false
    runtime.currentIndex = null
    runtime.viewportWidth = 0
    runtime.centerBySlug = null
    runtime.restoreBySlug = null
    runtime.restoration = null
    runtime.restorationFrame = null
  }

  const init = ({ mode = 'latest' } = {}) => {
    destroy()
    const generation = runtime.generation

    const root = document.querySelector('.champions-page')
    const shell = root?.querySelector('.champions-timeline-shell')
    const viewport = shell?.querySelector('.champions-timeline__viewport')
    const events = Array.from(shell?.querySelectorAll('.championship-event') || [])
    if (!root || !shell || !viewport || !events.length) return false
    shell.classList.remove('is-ready')
    shell.classList.add('is-initializing')
    shell.setAttribute('aria-busy', 'true')
    runtime.timelineShell = shell
    const timelineStylesheet = root.querySelector('link[rel="stylesheet"]')

    const previousButton = shell.querySelector('.champions-timeline__arrow--prev')
    const nextButton = shell.querySelector('.champions-timeline__arrow--next')
    const controller = new AbortController()
    const { signal } = controller
    runtime.controller = controller

    const isCurrentPage = () => generation === runtime.generation && shell.isConnected && runtime.timelineShell === shell

    // One exit path owns the interaction state, including fail-safe recovery.
    const finishInitialization = () => {
      if (!isCurrentPage() || !runtime.initialPositionApplied) return

      // Recover the local readiness state if Page Motion finishes late or
      // fails during a PJAX transition.
      const motionWasPending = shell.classList.contains('page-motion-item-pending') || shell.classList.contains('page-motion-item-prerender')
      shell.classList.remove('page-motion-item-pending', 'page-motion-item-prerender')
      if (motionWasPending) shell.classList.add('page-motion-item-visible')
      shell.classList.remove('is-initializing')
      shell.classList.add('is-ready')
      shell.setAttribute('aria-busy', 'false')
      runtime.readyObserver?.disconnect()
      runtime.readyObserver = null
      if (runtime.readyTimer) window.clearTimeout(runtime.readyTimer)
      runtime.readyTimer = null
    }

    // Register the fail-safe before any optional observer/geometry setup that
    // may be unavailable in an older browser or fail during PJAX recovery.
    runtime.readyTimer = window.setTimeout(() => {
      runtime.readyTimer = null
      if (!isCurrentPage() || !runtime.initialPositionApplied) return
      finishInitialization()
    }, 720)

    const checkMotionReady = () => {
      if (!runtime.initialPositionApplied) return
      const motionVisible = shell.classList.contains('page-motion-item-visible')
      const motionPending = shell.classList.contains('page-motion-item-pending') || shell.classList.contains('page-motion-item-prerender')
      if (motionVisible || !motionPending || !runtime.readyTimer) finishInitialization()
    }

    if (window.MutationObserver) {
      runtime.readyObserver = new MutationObserver(checkMotionReady)
      runtime.readyObserver.observe(shell, { attributes: true, attributeFilter: ['class'] })
    }
    checkMotionReady()

    const markInteracted = () => shell.classList.add('is-interacted')

    // Image fallback is local to each cover and does not depend on lazyload.
    const showCoverFallback = image => {
      const cover = image.closest('.championship-card__cover')
      const placeholder = cover?.querySelector('.championship-card__placeholder')
      image.hidden = true
      cover?.classList.add('is-image-failed')
      placeholder?.removeAttribute('hidden')
      placeholder?.removeAttribute('aria-hidden')
    }

    const hideCoverFallback = image => {
      const cover = image.closest('.championship-card__cover')
      const placeholder = cover?.querySelector('.championship-card__placeholder')
      cover?.classList.remove('is-image-failed')
      placeholder?.setAttribute('hidden', '')
      placeholder?.setAttribute('aria-hidden', 'true')
      image.hidden = false
    }

    shell.querySelectorAll('.championship-card__cover img').forEach(image => {
      image.addEventListener('load', () => hideCoverFallback(image), { signal })
      image.addEventListener('error', () => showCoverFallback(image), { signal })
      if (image.complete) {
        if (image.naturalWidth > 0) hideCoverFallback(image)
        else showCoverFallback(image)
      }
    })

    const handleCardClick = event => {
      if (runtime.suppressNextClick) {
        runtime.suppressNextClick = false
        if (runtime.suppressClickTimer) window.clearTimeout(runtime.suppressClickTimer)
        runtime.suppressClickTimer = null
        event.preventDefault()
        event.stopPropagation()
        return
      }

      const card = event.target.closest?.('.championship-card')
      if (!card || !shell.contains(card)) return

      if (!card.matches('[data-championship-detail]')) return
      const eventCards = Array.from(shell.querySelectorAll('.championship-event'))
      const eventIndex = eventCards.indexOf(card.closest('.championship-event'))
      card.dispatchEvent(new CustomEvent('championship:open-detail', {
        bubbles: true,
        detail: {
          trigger: card,
          card,
          slug: card.getAttribute('data-championship-detail'),
          index: eventIndex
        }
      }))
    }

    // Current-node and geometry helpers.
    const getCenteredIndex = () => {
      const viewportRect = viewport.getBoundingClientRect()
      const viewportCenter = viewportRect.left + viewportRect.width / 2
      let closestIndex = 0
      let closestDistance = Number.POSITIVE_INFINITY

      events.forEach((event, index) => {
        const eventRect = event.getBoundingClientRect()
        const distance = Math.abs(eventRect.left + eventRect.width / 2 - viewportCenter)
        if (distance < closestDistance) {
          closestIndex = index
          closestDistance = distance
        }
      })

      return closestIndex
    }

    const setCurrentIndex = nextIndex => {
      const boundedIndex = Math.max(0, Math.min(events.length - 1, nextIndex))
      events.forEach((event, index) => {
        const isCurrent = index === boundedIndex
        event.classList.toggle('is-current', isCurrent)
        if (isCurrent) event.setAttribute('aria-current', 'true')
        else event.removeAttribute('aria-current')
      })

      runtime.currentIndex = boundedIndex

      if (previousButton) previousButton.disabled = boundedIndex === 0
      if (nextButton) nextButton.disabled = boundedIndex === events.length - 1
    }

    const updateCurrent = () => {
      runtime.scrollFrame = null
      if (runtime.restoration) {
        setCurrentIndex(runtime.restoration.index)
        return
      }
      const nextIndex = getCenteredIndex()
      setCurrentIndex(nextIndex)
    }

    const updateGeometry = () => {
      const cardWidth = events[0]?.offsetWidth || 0
      const previousViewportWidth = runtime.viewportWidth
      if (cardWidth) {
        const edgePadding = Math.max(24, (viewport.clientWidth - cardWidth) / 2)
        viewport.style.setProperty('--timeline-edge-padding', `${edgePadding}px`)
      }
      runtime.viewportWidth = viewport.clientWidth

      if (runtime.restoration) return

      if (!runtime.initialPositionApplied) {
        positionInitialCard(mode)
        return
      }

      if (
        runtime.initialPositionApplied &&
        previousViewportWidth > 0 &&
        previousViewportWidth !== runtime.viewportWidth
      ) {
        const stableIndex = Number.isInteger(runtime.currentIndex)
          ? runtime.currentIndex
          : events.length - 1
        scrollToIndex(stableIndex, false, false)
      }

      if (runtime.initialPositionApplied) scheduleCurrentUpdate()
    }

    const scheduleCurrentUpdate = () => {
      if (runtime.restoration) return
      if (runtime.scrollFrame) return
      runtime.scrollFrame = window.requestAnimationFrame(updateCurrent)
    }

    const scrollToIndex = (index, smooth = true, interacted = true) => {
      if (runtime.restoration) return
      const boundedIndex = Math.max(0, Math.min(events.length - 1, index))
      const event = events[boundedIndex]
      const targetLeft = event.offsetLeft - (viewport.clientWidth - event.offsetWidth) / 2
      viewport.scrollTo({
        left: targetLeft,
        behavior: smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto'
      })
      if (interacted) markInteracted()
    }

    const centerBySlug = slug => {
      const requestedIndex = events.findIndex(event => (
        event.querySelector('[data-championship-detail]')?.getAttribute('data-championship-detail') === slug
      ))
      const targetIndex = requestedIndex >= 0 ? requestedIndex : events.length - 1
      const targetEvent = events[targetIndex]
      if (!targetEvent?.offsetWidth || !viewport.clientWidth) return false

      if (runtime.scrollFrame) {
        window.cancelAnimationFrame(runtime.scrollFrame)
        runtime.scrollFrame = null
      }

      const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
      const targetLeft = targetEvent.offsetLeft + targetEvent.offsetWidth / 2 - viewport.clientWidth / 2
      const boundedLeft = Math.max(0, Math.min(maxScrollLeft, targetLeft))
      const previousScrollBehavior = viewport.style.scrollBehavior
      const previousSnapType = viewport.style.scrollSnapType
      viewport.style.scrollBehavior = 'auto'
      viewport.style.scrollSnapType = 'none'
      viewport.scrollLeft = boundedLeft
      void viewport.offsetWidth
      viewport.style.scrollSnapType = previousSnapType
      viewport.style.scrollBehavior = previousScrollBehavior
      updateCurrent()
      return true
    }

    runtime.centerBySlug = centerBySlug

    const resolveEventBySlug = slug => {
      const requestedIndex = events.findIndex(event => (
        event.querySelector('[data-championship-detail]')?.getAttribute('data-championship-detail') === slug
      ))
      const targetIndex = requestedIndex >= 0 ? requestedIndex : events.length - 1
      return { event: events[targetIndex], index: targetIndex }
    }

    const applyInstantCenter = targetEvent => {
      if (!targetEvent?.offsetWidth || !viewport.clientWidth) return false
      const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
      const targetLeft = targetEvent.offsetLeft + targetEvent.offsetWidth / 2 - viewport.clientWidth / 2
      viewport.scrollLeft = Math.max(0, Math.min(maxScrollLeft, targetLeft))
      return true
    }

    const restoreBySlug = (slug, onComplete) => {
      const target = resolveEventBySlug(slug)
      if (!target.event?.offsetWidth || !viewport.clientWidth) {
        return false
      }

      if (runtime.restorationFrame) window.cancelAnimationFrame(runtime.restorationFrame)
      const restorationGeneration = runtime.generation
      const previousScrollBehavior = viewport.style.scrollBehavior
      const previousSnapType = viewport.style.scrollSnapType
      let corrected = false
      runtime.restoration = {
        slug,
        index: target.index,
        viewport,
        previousScrollBehavior,
        previousSnapType,
        onComplete
      }

      const release = () => {
        if (!runtime.restoration || restorationGeneration !== runtime.generation) return
        viewport.style.scrollSnapType = previousSnapType
        viewport.style.scrollBehavior = previousScrollBehavior
        setCurrentIndex(target.index)
        runtime.restoration = null
        runtime.restorationFrame = null
        onComplete?.()
      }

      const confirm = () => {
        if (!runtime.restoration || restorationGeneration !== runtime.generation) return
        const viewportCenter = viewport.clientWidth / 2
        const targetCenter = target.event.offsetLeft + target.event.offsetWidth / 2 - viewport.scrollLeft
        const deviation = Math.abs(targetCenter - viewportCenter)
        if (deviation > 1 && !corrected) {
          corrected = true
          applyInstantCenter(target.event)
          runtime.restorationFrame = window.requestAnimationFrame(confirm)
          return
        }

        // Keep the snap lock for one more frame so a reflow cannot move the
        // track between the final measurement and restoring the CSS snap rule.
        runtime.restorationFrame = window.requestAnimationFrame(() => {
          if (!runtime.restoration || restorationGeneration !== runtime.generation) return
          release()
        })
      }

      viewport.style.scrollBehavior = 'auto'
      viewport.style.scrollSnapType = 'none'
      applyInstantCenter(target.event)
      setCurrentIndex(target.index)
      runtime.restorationFrame = window.requestAnimationFrame(() => {
        runtime.restorationFrame = window.requestAnimationFrame(confirm)
      })
      return true
    }

    runtime.restoreBySlug = restoreBySlug

    const positionInitialCard = initialMode => {
      if (runtime.initialPositionApplied) return true

      const hashId = window.location.hash.slice(1)
      const hashEvent = events.find(event => event.querySelector('[data-championship-detail]')?.getAttribute('data-championship-detail') === hashId)
      const preservedEvent = initialMode === 'preserve'
        ? events.find(event => event.classList.contains('is-current'))
        : null
      const targetEvent = hashEvent || preservedEvent || events[events.length - 1]
      const targetIndex = events.indexOf(targetEvent)
      const cardWidth = events[0]?.offsetWidth || 0
      if (!targetEvent?.offsetWidth || cardWidth < 200 || viewport.clientWidth < 100) return false

      const edgePadding = Math.max(24, (viewport.clientWidth - cardWidth) / 2)
      viewport.style.setProperty('--timeline-edge-padding', `${edgePadding}px`)
      runtime.viewportWidth = viewport.clientWidth

      const previousScrollBehavior = viewport.style.scrollBehavior
      const previousSnapType = viewport.style.scrollSnapType
      viewport.style.scrollBehavior = 'auto'
      viewport.style.scrollSnapType = 'none'
      scrollToIndex(targetIndex, false, false)
      void viewport.offsetWidth
      viewport.style.scrollSnapType = previousSnapType
      viewport.style.scrollBehavior = previousScrollBehavior
      runtime.initialPositionApplied = true
      updateCurrent()
      checkMotionReady()
      return true
    }

    // Interaction bindings are scoped to this page instance and aborted on exit.
    viewport.addEventListener('scroll', scheduleCurrentUpdate, { passive: true, signal })
    viewport.addEventListener('touchstart', markInteracted, { passive: true, signal })
    viewport.addEventListener('wheel', event => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) markInteracted()
    }, { passive: true, signal })

    previousButton?.addEventListener('click', () => {
      scrollToIndex(getCenteredIndex() - 1)
    }, { signal })

    nextButton?.addEventListener('click', () => {
      scrollToIndex(getCenteredIndex() + 1)
    }, { signal })

    viewport.addEventListener('keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return

      event.preventDefault()
      const direction = event.key === 'ArrowRight' ? 1 : -1
      scrollToIndex(getCenteredIndex() + direction)
    }, { signal })

    let pointerId = null
    let pointerType = ''
    let pointerStartX = 0
    let pointerStartY = 0
    let pointerStartScroll = 0
    let isDragCandidate = false
    let isDragging = false

    const resetPointer = () => {
      if (pointerId !== null && viewport.hasPointerCapture(pointerId)) {
        viewport.releasePointerCapture(pointerId)
      }
      viewport.classList.remove('is-dragging')
      pointerId = null
      pointerType = ''
      pointerStartX = 0
      pointerStartY = 0
      pointerStartScroll = 0
      isDragCandidate = false
      isDragging = false
    }

    viewport.addEventListener('pointerdown', event => {
      if (!event.isPrimary || pointerId !== null) return
      if (event.pointerType === 'mouse' && event.button !== 0) return

      pointerId = event.pointerId
      pointerType = event.pointerType
      pointerStartX = event.clientX
      pointerStartY = event.clientY
      pointerStartScroll = viewport.scrollLeft
      isDragCandidate = true
      isDragging = false
    }, { signal })

    viewport.addEventListener('pointermove', event => {
      if (pointerId !== event.pointerId) return
      const deltaX = event.clientX - pointerStartX
      const deltaY = event.clientY - pointerStartY
      const threshold = pointerType === 'touch' ? 10 : pointerType === 'pen' ? 8 : 6

      if (isDragCandidate && !isDragging) {
        const horizontalDistance = Math.abs(deltaX)
        const verticalDistance = Math.abs(deltaY)
        if (verticalDistance > threshold && verticalDistance > horizontalDistance) {
          resetPointer()
          return
        }
        if (horizontalDistance <= threshold || horizontalDistance <= verticalDistance) return

        isDragCandidate = false
        isDragging = true
        markInteracted()
        viewport.classList.add('is-dragging')
        viewport.setPointerCapture(pointerId)
      }

      if (!isDragging) return

      if (event.cancelable) event.preventDefault()
      viewport.scrollLeft = pointerStartScroll - deltaX
    }, { signal })

    const finishPointer = event => {
      if (pointerId !== event.pointerId) return
      const didDrag = isDragging
      resetPointer()

      if (didDrag) {
        runtime.suppressNextClick = true
        if (runtime.suppressClickTimer) window.clearTimeout(runtime.suppressClickTimer)
        runtime.suppressClickTimer = window.setTimeout(() => {
          runtime.suppressNextClick = false
          runtime.suppressClickTimer = null
        }, 0)
        scrollToIndex(getCenteredIndex())
      }
    }

    viewport.addEventListener('pointerup', finishPointer, { signal })
    viewport.addEventListener('pointercancel', finishPointer, { signal })

    // One delegated listener covers every card and remains valid after any
    // timeline data update without creating per-card handlers.
    shell.addEventListener('click', handleCardClick, { signal })

    runtime.resizeObserver = new ResizeObserver(updateGeometry)
    runtime.resizeObserver.observe(viewport)
    events.forEach(event => runtime.resizeObserver.observe(event))

    timelineStylesheet?.addEventListener('load', () => {
      if (positionInitialCard(mode)) updateGeometry()
    }, { signal })

    positionInitialCard(mode)
    runtime.geometryFrame = window.requestAnimationFrame(() => {
      runtime.geometryFrame = null
      if (!isCurrentPage()) return
      positionInitialCard(mode)
      updateGeometry()
    })
    return true
  }

  const centerBySlug = slug => runtime.centerBySlug?.(slug) || false

  window.ChampionshipTimeline = {
    init,
    destroy,
    centerBySlug,
    restoreBySlug: (slug, onComplete) => runtime.restoreBySlug?.(slug, onComplete) || false
  }
  init({ mode: 'latest' })

  if (!window.championshipTimelineLifecycleBound) {
    window.championshipTimelineLifecycleBound = true
    document.addEventListener('pjax:send', destroy)
    document.addEventListener('pjax:error', destroy)
    window.addEventListener('pageshow', event => {
      if (event.persisted && document.querySelector('.champions-page') && !runtime.controller) {
        init({ mode: 'preserve' })
      }
    })
  }
})()
