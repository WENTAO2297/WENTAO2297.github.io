(() => {
  'use strict'

  const pendingClass = 'home-dashboard--pending'
  const readyClass = 'home-dashboard--ready'
  const maxSpotifyWait = 6000

  const activateDashboard = (dashboard) => {
    if (!dashboard.isConnected || !dashboard.classList.contains(pendingClass)) return

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!dashboard.isConnected) return
        dashboard.classList.remove(pendingClass)
        dashboard.classList.add(readyClass)
      })
    })
  }

  const initDashboard = () => {
    const dashboard = document.getElementById('home-dashboard')
    if (!dashboard || dashboard.dataset.readyController === 'true') return

    dashboard.dataset.readyController = 'true'
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

    spotify.addEventListener('load', handleSpotifyReady, { once: true })

    if (spotify.dataset.spotifyReady === 'true') {
      handleSpotifyReady()
      return
    }

    fallbackTimer = window.setTimeout(handleSpotifyReady, maxSpotifyWait)
  }

  initDashboard()

  if (!window.homeDashboardReadyListener) {
    window.homeDashboardReadyListener = true
    document.addEventListener('pjax:complete', initDashboard)
  }
})()
