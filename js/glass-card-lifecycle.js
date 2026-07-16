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
    if (primaryContent?.tagName === 'DIV' && !primaryContent.classList.contains('nc')) {
      cards.add(primaryContent)
    }

    return Array.from(cards)
  }

  const prepare = container => getCards(container)

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

  const ready = container => getCards(container)

  window.GlassCardLifecycle = { getCards, prepare, forceComposite, ready }
})()
