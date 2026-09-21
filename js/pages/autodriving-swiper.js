(() => {
  'use strict'

  if (window.AutoDrivingSwiper) {
    window.AutoDrivingSwiper.init()
    return
  }

  const libraryUrl = 'https://cdn.jsdelivr.net/npm/swiper@11.1.9/swiper-bundle.min.js'
  const instances = new Set()
  let libraryPromise = null

  const loadLibrary = () => {
    if (typeof window.Swiper === 'function') return Promise.resolve(true)
    if (libraryPromise) return libraryPromise

    libraryPromise = new Promise(resolve => {
      const script = document.createElement('script')
      script.src = libraryUrl
      script.async = true
      script.onload = () => resolve(typeof window.Swiper === 'function')
      script.onerror = () => resolve(false)
      document.head.append(script)
    }).then(ready => {
      if (!ready) libraryPromise = null
      return ready
    })
    return libraryPromise
  }

  const init = async () => {
    if (!document.querySelector('.post-content .swiper')) return
    if (!await loadLibrary()) return

    document.querySelectorAll('.post-content .swiper').forEach((element, index) => {
      if (element.swiper && !element.swiper.destroyed) return
      const options = {
        loop: true,
        navigation: {
          nextEl: element.querySelector('.swiper-button-next'),
          prevEl: element.querySelector('.swiper-button-prev')
        },
        pagination: {
          el: element.querySelector('.swiper-pagination'),
          clickable: true
        }
      }
      if (index === 0) options.autoHeight = true
      instances.add(new window.Swiper(element, options))
    })
  }

  const destroy = () => {
    instances.forEach(instance => instance.destroy(true, true))
    instances.clear()
  }

  window.AutoDrivingSwiper = { init, destroy }
  document.addEventListener('pjax:send', destroy)
  document.addEventListener('pjax:complete', init)
  init()
})()
