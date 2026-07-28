(() => {
  'use strict'

  if (window.__firstVisitLoaderController) {
    document.getElementById('first-visit-loader')?.remove()
    return
  }
  window.__firstVisitLoaderController = true
  const state = window.__siteBootState || window.__firstVisitLoaderState
  if (!state?.active) {
    document.documentElement.classList.remove('first-visit-pending', 'is-site-booting')
    document.getElementById('first-visit-loader')?.remove()
    return
  }
  window.SiteReadiness?.waitInitialReady?.()
})()
