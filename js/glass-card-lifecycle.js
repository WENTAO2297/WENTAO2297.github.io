(() => {
  'use strict'

  if (window.GlassCardLifecycle) return

  const selectors = [
    '.home-dashboard .dashboard-search-shell',
    '.home-dashboard .dashboard-card',
    '.home-dashboard .spotify-embed-slot',
    '#recent-posts .recent-post-item',
    '#aside-content .card-widget'
  ]

  const getCards = (container = document.getElementById('content-inner')) => {
    if (!container) return []

    const cards = new Set()
    selectors.forEach(selector => container.querySelectorAll(selector).forEach(card => cards.add(card)))

    const primaryContent = container.firstElementChild
    const isEcustPage = Boolean(container.querySelector('.ecust-page-enter'))
    if (!isEcustPage && primaryContent?.tagName === 'DIV' && !primaryContent.classList.contains('nc')) {
      cards.add(primaryContent)
    }

    return Array.from(cards)
  }

  const prepare = (container) => {
    const cards = getCards(container)
    cards.forEach(card => {
      card.classList.remove('card-ready')
      card.classList.add('glass-card-prepare')
    })
    return cards
  }

  const forceComposite = (container) => {
    const cards = getCards(container)
    cards.forEach(card => {
      void card.offsetWidth
      const style = window.getComputedStyle(card)
      void style.backgroundColor
      void style.backdropFilter
      void style.webkitBackdropFilter
    })
    return cards
  }

  const ready = (container) => {
    const cards = getCards(container)
    cards.forEach(card => card.classList.add('card-ready'))
    return cards
  }

  const reset = (container) => {
    getCards(container).forEach(card => card.classList.remove('glass-card-prepare', 'card-ready'))
  }

  window.GlassCardLifecycle = { getCards, prepare, forceComposite, ready, reset }
})()
