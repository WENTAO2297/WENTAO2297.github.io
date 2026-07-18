(() => {
  'use strict'

  if (window.ChampionshipTimeline) {
    window.ChampionshipTimeline.init()
    return
  }

  const runtime = {
    controller: null,
    resizeObserver: null,
    scrollFrame: null,
    geometryFrame: null,
    noticeTimer: null,
    suppressClickUntil: 0
  }

  const destroy = () => {
    runtime.controller?.abort()
    runtime.resizeObserver?.disconnect()
    if (runtime.scrollFrame) window.cancelAnimationFrame(runtime.scrollFrame)
    if (runtime.geometryFrame) window.cancelAnimationFrame(runtime.geometryFrame)
    if (runtime.noticeTimer) window.clearTimeout(runtime.noticeTimer)

    runtime.controller = null
    runtime.resizeObserver = null
    runtime.scrollFrame = null
    runtime.geometryFrame = null
    runtime.noticeTimer = null
    runtime.suppressClickUntil = 0
  }

  const init = () => {
    destroy()

    const root = document.querySelector('.champions-page')
    const shell = root?.querySelector('.champions-timeline-shell')
    const viewport = shell?.querySelector('.champions-timeline__viewport')
    const events = Array.from(shell?.querySelectorAll('.championship-event') || [])
    if (!root || !shell || !viewport || !events.length) return false

    const previousButton = shell.querySelector('.champions-timeline__arrow--prev')
    const nextButton = shell.querySelector('.champions-timeline__arrow--next')
    const notice = shell.querySelector('.champions-timeline__notice')
    const controller = new AbortController()
    const { signal } = controller
    runtime.controller = controller

    const markInteracted = () => shell.classList.add('is-interacted')

    const showPendingNotice = () => {
      if (!notice) return
      notice.textContent = '赛事详情整理中'
      notice.classList.add('is-visible')
      if (runtime.noticeTimer) window.clearTimeout(runtime.noticeTimer)
      runtime.noticeTimer = window.setTimeout(() => {
        notice.classList.remove('is-visible')
      }, 1800)
    }

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

    const updateCurrent = () => {
      runtime.scrollFrame = null
      const nextIndex = getCenteredIndex()

      events.forEach((event, index) => {
        const isCurrent = index === nextIndex
        event.classList.toggle('is-current', isCurrent)
        if (isCurrent) event.setAttribute('aria-current', 'true')
        else event.removeAttribute('aria-current')
      })

      if (previousButton) previousButton.disabled = nextIndex === 0
      if (nextButton) nextButton.disabled = nextIndex === events.length - 1
    }

    const updateGeometry = () => {
      const cardWidth = events[0]?.offsetWidth || 0
      if (cardWidth) {
        const edgePadding = Math.max(24, (viewport.clientWidth - cardWidth) / 2)
        viewport.style.setProperty('--timeline-edge-padding', `${edgePadding}px`)
      }
      scheduleCurrentUpdate()
    }

    const scheduleCurrentUpdate = () => {
      if (runtime.scrollFrame) return
      runtime.scrollFrame = window.requestAnimationFrame(updateCurrent)
    }

    const scrollToIndex = (index, smooth = true) => {
      const boundedIndex = Math.max(0, Math.min(events.length - 1, index))
      const event = events[boundedIndex]
      const targetLeft = event.offsetLeft - (viewport.clientWidth - event.offsetWidth) / 2
      viewport.scrollTo({
        left: targetLeft,
        behavior: smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto'
      })
      markInteracted()
    }

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
    let pointerStartX = 0
    let pointerStartScroll = 0
    let pointerMoved = false

    viewport.addEventListener('pointerdown', event => {
      markInteracted()
      if (event.pointerType !== 'mouse' || event.button !== 0) return

      pointerId = event.pointerId
      pointerStartX = event.clientX
      pointerStartScroll = viewport.scrollLeft
      pointerMoved = false
      viewport.setPointerCapture(pointerId)
      viewport.classList.add('is-dragging')
    }, { signal })

    viewport.addEventListener('pointermove', event => {
      if (pointerId !== event.pointerId) return
      const distance = event.clientX - pointerStartX
      if (Math.abs(distance) > 5) pointerMoved = true
      if (!pointerMoved) return

      event.preventDefault()
      viewport.scrollLeft = pointerStartScroll - distance
    }, { signal })

    const finishPointer = event => {
      if (pointerId !== event.pointerId) return
      if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId)
      viewport.classList.remove('is-dragging')
      pointerId = null

      if (pointerMoved) {
        runtime.suppressClickUntil = Date.now() + 260
        scrollToIndex(getCenteredIndex())
      }
    }

    viewport.addEventListener('pointerup', finishPointer, { signal })
    viewport.addEventListener('pointercancel', finishPointer, { signal })

    shell.querySelectorAll('[data-pending-detail]').forEach(card => {
      card.addEventListener('click', event => {
        if (Date.now() < runtime.suppressClickUntil) {
          event.preventDefault()
          return
        }
        showPendingNotice()
      }, { signal })
    })

    runtime.resizeObserver = new ResizeObserver(updateGeometry)
    runtime.resizeObserver.observe(viewport)
    events.forEach(event => runtime.resizeObserver.observe(event))

    runtime.geometryFrame = window.requestAnimationFrame(() => {
      runtime.geometryFrame = null
      updateGeometry()
    })
    return true
  }

  window.ChampionshipTimeline = { init, destroy }
  init()

  if (!window.championshipTimelineLifecycleBound) {
    window.championshipTimelineLifecycleBound = true
    document.addEventListener('pjax:send', destroy)
    document.addEventListener('pjax:complete', init)
    document.addEventListener('pjax:error', destroy)
    window.addEventListener('pageshow', init)
  }
})()
