(() => {
  'use strict'

  if (window.__aboutTabsInitialized) return
  window.__aboutTabsInitialized = true

  const panelIds = new Set(['about-me', 'about-blog'])
  let syncQueued = false

  const getRoot = () => document.querySelector('.about-profile-page')

  const getPanelId = () => {
    const hash = window.location.hash.slice(1)
    return panelIds.has(hash) ? hash : 'about-me'
  }

  const activate = (root, panelId, animate = false) => {
    if (!root || !panelIds.has(panelId)) return

    const tabs = Array.from(root.querySelectorAll('.about-profile-switch__tab'))
    const panels = Array.from(root.querySelectorAll('.about-profile-panel'))
    let activePanel = null

    tabs.forEach(tab => {
      const active = tab.getAttribute('aria-controls') === panelId
      tab.classList.toggle('is-active', active)
      tab.setAttribute('aria-selected', String(active))
      tab.setAttribute('tabindex', active ? '0' : '-1')
    })

    panels.forEach(panel => {
      const active = panel.id === panelId
      panel.hidden = !active
      panel.classList.toggle('is-active', active)
      if (active) activePanel = panel
    })

    if (!animate || !activePanel) return
    window.PageMotion?.replay(activePanel)
  }

  const sync = (animate = false) => activate(getRoot(), getPanelId(), animate)

  const scheduleSync = () => {
    if (syncQueued) return
    syncQueued = true
    window.queueMicrotask(() => {
      syncQueued = false
      sync(true)
    })
  }

  document.addEventListener('click', event => {
    const tab = event.target.closest('.about-profile-switch__tab')
    const root = tab?.closest('.about-profile-page')
    const panelId = tab?.getAttribute('aria-controls')
    if (!tab || !root || !panelIds.has(panelId)) return

    event.preventDefault()
    if (window.location.hash !== `#${panelId}`) {
      window.history.pushState(null, '', `#${panelId}`)
    }
    activate(root, panelId, true)
  })

  document.addEventListener('keydown', event => {
    const tab = event.target.closest('.about-profile-switch__tab')
    const root = tab?.closest('.about-profile-page')
    if (!tab || !root || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return

    const tabs = Array.from(root.querySelectorAll('.about-profile-switch__tab'))
    const currentIndex = tabs.indexOf(tab)
    if (currentIndex < 0) return

    event.preventDefault()
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length

    tabs[nextIndex].focus()
    tabs[nextIndex].click()
  })

  window.addEventListener('popstate', scheduleSync)
  window.addEventListener('hashchange', scheduleSync)
  window.addEventListener('pageshow', () => sync())
  document.addEventListener('pjax:complete', () => sync())

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => sync(), { once: true })
  } else {
    sync()
  }
})()
