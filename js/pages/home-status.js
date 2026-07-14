(() => {
  'use strict'

  const clock = document.getElementById('website-status-clock')
  if (!clock) return

  let timer

  const updateClock = () => {
    if (!document.documentElement.contains(clock)) {
      window.clearInterval(timer)
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
  timer = window.setInterval(updateClock, 1000)
})()
