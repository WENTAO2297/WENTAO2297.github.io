(() => {
  'use strict'

  const pendingClass = 'home-dashboard--pending'
  const readyClass = 'home-dashboard--ready'

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
    document.addEventListener('pjax:complete', initDashboard)
  }
})()
