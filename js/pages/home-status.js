(() => {
  'use strict'

  const clock = document.getElementById('website-status-clock')
  if (!clock) return

  const pageRuntime = window.SitePageRuntime?.create?.({ name: 'home-status' })
  if (!pageRuntime) return

  const updateClock = () => {
    if (!document.documentElement.contains(clock)) return

    const now = new Date()
    clock.dateTime = now.toISOString()
    clock.textContent = new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(now)
  }

  updateClock()
  const interval = window.setInterval(updateClock, 1000)
  pageRuntime.addCleanup(() => window.clearInterval(interval))
  pageRuntime.addListener(document, 'pjax:send', () => pageRuntime.destroy(), { once: true })
})()
