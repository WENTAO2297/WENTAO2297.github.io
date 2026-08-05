(() => {
  'use strict'

  const buttonSelector = '#home-dashboard .personal-social__copy[data-copy-value]'
  const toastId = 'home-social-copy-toast'
  const toastDuration = 1800
  let toastTimer

  const fallbackCopy = value => {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.top = '0'
    textarea.style.left = '-9999px'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    document.body.append(textarea)

    try {
      textarea.focus({ preventScroll: true })
      textarea.select()
      textarea.setSelectionRange(0, textarea.value.length)
      return typeof document.execCommand === 'function' && document.execCommand('copy')
    } finally {
      textarea.remove()
    }
  }

  const copyText = async value => {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(value)
        return true
      } catch (_) {
        // Fall through to the selection-based fallback for denied clipboard access.
      }
    }

    return fallbackCopy(value)
  }

  const getToast = () => {
    let toast = document.getElementById(toastId)
    if (toast) return toast

    toast = document.createElement('div')
    toast.id = toastId
    toast.className = 'home-social-copy-toast'
    toast.setAttribute('aria-live', 'polite')
    toast.setAttribute('role', 'status')
    document.body.append(toast)
    return toast
  }

  const showFeedback = message => {
    if (window.GLOBAL_CONFIG?.Snackbar && typeof btf !== 'undefined' && typeof btf.snackbarShow === 'function') {
      btf.snackbarShow(message, false, toastDuration)
      return
    }

    const toast = getToast()
    window.clearTimeout(toastTimer)
    toast.textContent = message
    toast.classList.add('is-visible')
    toastTimer = window.setTimeout(() => {
      toast.classList.remove('is-visible')
    }, toastDuration)
  }

  const handleCopy = async event => {
    if (!(event.target instanceof Element)) return

    const button = event.target.closest(buttonSelector)
    if (!button || button.dataset.copying === 'true') return

    event.preventDefault()
    button.dataset.copying = 'true'

    let copied = false
    try {
      copied = await copyText(button.dataset.copyValue || '')
    } catch (_) {
      copied = false
    } finally {
      delete button.dataset.copying
    }

    showFeedback(copied ? button.dataset.copyMessage || '已复制' : '复制失败，请手动复制')
  }

  if (!window.homeSocialCopyListenerBound) {
    window.homeSocialCopyListenerBound = true
    document.addEventListener('click', handleCopy)
  }
})()
