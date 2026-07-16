(() => {
  'use strict'

  const pendingClass = 'home-dashboard--pending'
  const readyClass = 'home-dashboard--ready'
  const maxSpotifyWait = 6000

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

    window.homeDashboardReadyCleanup?.()
    dashboard.dataset.readyController = 'true'
    window.GlassCardLifecycle?.prepare(dashboard)
    const spotify = dashboard.querySelector('.spotify-embed')

    if (!spotify) {
      activateDashboard(dashboard)
      return
    }

    let finished = false
    let fallbackTimer

    const handleSpotifyReady = () => {
      if (finished) return
      finished = true
      window.clearTimeout(fallbackTimer)
      activateDashboard(dashboard)
    }

    window.homeDashboardReadyCleanup = () => {
      finished = true
      window.clearTimeout(fallbackTimer)
      spotify.removeEventListener('load', handleSpotifyReady)
    }

    spotify.addEventListener('load', handleSpotifyReady, { once: true })

    if (spotify.dataset.spotifyReady === 'true') {
      handleSpotifyReady()
      return
    }

    fallbackTimer = window.setTimeout(handleSpotifyReady, maxSpotifyWait)
  }

  initDashboard()

  if (!window.homeDashboardReadyCleanupBound) {
    window.homeDashboardReadyCleanupBound = true
    document.addEventListener('pjax:send', () => window.homeDashboardReadyCleanup?.())
  }

  if (!window.homeDashboardReadyListener) {
    window.homeDashboardReadyListener = true
    document.addEventListener('pjax:complete', initDashboard)
  }
})()
