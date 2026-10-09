(() => {
  'use strict'

  const pendingClass = 'home-dashboard--pending'
  const readyClass = 'home-dashboard--ready'
  let frozenElements = []

  const restoreTransforms = () => {
    frozenElements.forEach(({ element, styles }) => {
      styles.forEach(({ name, value, priority }) => {
        if (value) element.style.setProperty(name, value, priority)
        else element.style.removeProperty(name)
      })
    })
    frozenElements = []
  }

  const freezeDepartingTransforms = () => {
    if (frozenElements.length) return
    // Hold the painted angle before the outgoing page loses pointer events.
    // Otherwise :hover disappears and the spin reverses during the fade-out.
    document.querySelectorAll('#home-dashboard .personal-profile__avatar, #home-dashboard .personal-social__item > a, #home-dashboard .personal-social__item > button').forEach(element => {
      const transform = getComputedStyle(element).transform
      const styles = ['transition', 'transform'].map(name => ({
        name,
        value: element.style.getPropertyValue(name),
        priority: element.style.getPropertyPriority(name)
      }))
      frozenElements.push({ element, styles })
      element.style.setProperty('transition', 'none')
      element.style.setProperty('transform', transform)
    })
  }

  const activateDashboard = (dashboard) => {
    if (!dashboard.isConnected || !dashboard.classList.contains(pendingClass)) return

    window.requestAnimationFrame(() => {
      window.GlassCardLifecycle?.forceComposite(dashboard)
      window.requestAnimationFrame(() => {
        if (!dashboard.isConnected) return
        window.GlassCardLifecycle?.ready(dashboard)
        dashboard.classList.remove(pendingClass)
        dashboard.classList.add(readyClass)
      })
    })
  }

  const initDashboard = () => {
    const dashboard = document.getElementById('home-dashboard')
    if (!dashboard || dashboard.dataset.readyController === 'true') return

    dashboard.dataset.readyController = 'true'
    window.GlassCardLifecycle?.prepare(dashboard)
    activateDashboard(dashboard)
  }

  initDashboard()

  if (!window.homeDashboardReadyListener) {
    window.homeDashboardReadyListener = true
    // Capture precedes the persistent shell's bubble-phase leaving handler.
    document.addEventListener('pjax:send', freezeDepartingTransforms, true)
    document.addEventListener('pjax:complete', () => {
      restoreTransforms()
      initDashboard()
    })
    document.addEventListener('pjax:error', restoreTransforms)
    window.addEventListener('pageshow', restoreTransforms)
  }
})()
