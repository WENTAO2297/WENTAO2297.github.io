(() => {
  'use strict'

  if (window.homeStatusClockTimer) {
    window.clearInterval(window.homeStatusClockTimer)
    window.homeStatusClockTimer = null
  }

  const clock = document.getElementById('website-status-clock')
  if (!clock) return

  const updateClock = () => {
    if (!document.documentElement.contains(clock)) {
      window.clearInterval(window.homeStatusClockTimer)
      window.homeStatusClockTimer = null
      return
    }

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
  window.homeStatusClockTimer = window.setInterval(updateClock, 1000)

  if (!window.homeStatusPjaxCleanupBound) {
    window.homeStatusPjaxCleanupBound = true
    document.addEventListener('pjax:send', () => {
      if (!window.homeStatusClockTimer) return
      window.clearInterval(window.homeStatusClockTimer)
      window.homeStatusClockTimer = null
    })
  }
})()
