(() => {
  'use strict'

  if (window.StudyJourney) {
    window.StudyJourney.init()
    return
  }

  const rootSelector = '.study-journey'
  const cardSelector = '[data-study-card]'
  const cardAnimation = Object.freeze({
    durationMs: 480,
    staggerMs: 80,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
  })
  const expectedCardCount = 3

  let lifecycle = null
  let activeRoot = null
  let pageGeneration = 0

  const addAnimation = animation => {
    return lifecycle?.addAnimation(animation) || animation
  }

  const scheduleFrame = callback => {
    if (!lifecycle || lifecycle.isDestroyed()) return null
    const frame = window.requestAnimationFrame(() => {
      lifecycle.removeFrame(frame)
      if (lifecycle.isDestroyed()) return
      callback()
    })
    lifecycle.addFrame(frame)
    return frame
  }

  const resetRoot = root => {
    if (!root) return

    root.removeAttribute('data-study-initialized')
    root.removeAttribute('data-study-state')
    root.querySelectorAll(cardSelector).forEach(card => {
      card.style.removeProperty('opacity')
      card.style.removeProperty('transform')
    })
  }

  const cleanup = () => {
    pageGeneration += 1
    const root = activeRoot
    lifecycle?.destroy()
    lifecycle = null
    resetRoot(root)
    activeRoot = null
  }

  const markReady = reason => {
    window.SiteReadiness?.markPageReady({ page: 'study-journey', reason })
  }

  const showStatic = (root, cards) => {
    root.dataset.studyState = 'ready'
    cards.forEach(card => {
      card.style.opacity = '1'
      card.style.transform = 'none'
    })
  }

  const finishStudyJourney = (root, currentGeneration) => {
    if (!isLive(root, currentGeneration)) return
    root.dataset.studyState = 'ready'
  }

  const startCards = (root, cards, currentGeneration) => {
    if (!isLive(root, currentGeneration)) return

    root.dataset.studyState = 'entering'
    const animations = cards.map((card, index) => addAnimation(card.animate([
      { opacity: 0, transform: 'translate3d(0, 14px, 0)' },
      { opacity: 1, transform: 'translate3d(0, 0, 0)' }
    ], {
      duration: cardAnimation.durationMs,
      delay: index * cardAnimation.staggerMs,
      easing: cardAnimation.easing,
      fill: 'both'
    })))

    Promise.allSettled(animations.map(animation => animation.finished))
      .then(() => finishStudyJourney(root, currentGeneration))
  }

  const isLive = (root, currentGeneration) =>
    currentGeneration === pageGeneration
    && activeRoot === root
    && root.isConnected
    && lifecycle
    && !lifecycle.isDestroyed()

  const initializeStudyJourneyPage = () => {
    const root = document.querySelector(rootSelector)
    if (!root) {
      cleanup()
      return false
    }

    if (activeRoot === root && root.dataset.studyInitialized === 'true') return true

    cleanup()
    activeRoot = root
    lifecycle = window.SitePageRuntime?.create?.({ name: 'study-journey' }) || null
    const currentGeneration = pageGeneration
    const cards = Array.from(root.querySelectorAll(cardSelector))

    root.dataset.studyInitialized = 'true'
    if (!lifecycle || cards.length !== expectedCardCount) {
      showStatic(root, cards)
      markReady('cards-layout-ready')
      return true
    }

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const motionHandler = () => {
      cleanup()
      initializeStudyJourneyPage()
    }
    lifecycle.addListener(motionQuery, 'change', motionHandler)

    if (motionQuery.matches) {
      showStatic(root, cards)
      markReady('cards-layout-ready')
      return true
    }

    root.dataset.studyState = 'pending'
    markReady('cards-layout-ready')
    scheduleFrame(() => {
      scheduleFrame(() => {
        scheduleFrame(() => startCards(root, cards, currentGeneration))
      })
    })
    return true
  }

  window.StudyJourney = { init: initializeStudyJourneyPage, cleanup }
  initializeStudyJourneyPage()

  if (!window.studyJourneyPjaxBound) {
    window.studyJourneyPjaxBound = true
    document.addEventListener('pjax:send', cleanup)
    document.addEventListener('pjax:complete', initializeStudyJourneyPage)
    document.addEventListener('pjax:error', cleanup)
    window.addEventListener('pageshow', event => {
      if (event.persisted) cleanup()
      initializeStudyJourneyPage()
    })
  }
})()
