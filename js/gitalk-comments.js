(() => {
  if (window.BlogGitalk) {
    window.BlogGitalk.init()
    return
  }

  const state = {
    container: null,
    pageId: '',
    generation: 0
  }

  const normalizePathname = value => {
    let pathname = value || '/'

    try {
      pathname = new URL(pathname, window.location.origin).pathname
      pathname = decodeURIComponent(pathname)
    } catch (_) {
      // Keep the original path when malformed escape sequences cannot be decoded.
    }

    pathname = pathname.normalize('NFC').replace(/\\+/g, '/').replace(/\/{2,}/g, '/')
    pathname = pathname.replace(/\/index\.html$/i, '/')
    if (!pathname.startsWith('/')) pathname = `/${pathname}`
    if (pathname !== '/') pathname = `${pathname.replace(/\/+$/, '')}/`
    return pathname
  }

  const fnv1a = (value, seed) => {
    let hash = seed >>> 0
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(16).padStart(8, '0')
  }

  const createPageId = pathname => {
    const normalized = normalizePathname(pathname)
    return `gitalk-${fnv1a(normalized, 0x811c9dc5)}${fnv1a(normalized, 0x9e3779b9)}`
  }

  const isPlaceholder = value => !value || value.startsWith('REPLACE_WITH_') || value.includes('example.workers.dev')

  const parseBoolean = value => value === true || value === 'true'

  const loadStyle = (href, id) => {
    if (!href) return Promise.resolve()
    const existing = document.getElementById(id)
    if (existing) return Promise.resolve()

    return new Promise((resolve, reject) => {
      const link = document.createElement('link')
      link.id = id
      link.rel = 'stylesheet'
      link.href = href
      link.addEventListener('load', resolve, { once: true })
      link.addEventListener('error', () => reject(new Error(`无法加载样式：${href}`)), { once: true })
      document.head.appendChild(link)
    })
  }

  const loadScript = (src, id) => {
    if (typeof window.Gitalk === 'function') return Promise.resolve()

    const existing = document.getElementById(id)
    if (existing) {
      return new Promise((resolve, reject) => {
        existing.addEventListener('load', resolve, { once: true })
        existing.addEventListener('error', () => reject(new Error(`无法加载脚本：${src}`)), { once: true })
      })
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.id = id
      script.src = src
      script.async = true
      script.addEventListener('load', resolve, { once: true })
      script.addEventListener('error', () => reject(new Error(`无法加载脚本：${src}`)), { once: true })
      document.head.appendChild(script)
    })
  }

  const renderStatus = (container, message, type = 'pending') => {
    container.replaceChildren()
    const status = document.createElement('div')
    status.className = `gitalk-status gitalk-status-${type}`
    status.setAttribute('role', type === 'error' ? 'alert' : 'status')
    status.textContent = message
    container.appendChild(status)
  }

  const getConfig = container => {
    const { dataset } = container
    return {
      clientID: dataset.gitalkClientId,
      clientSecret: dataset.gitalkClientSecret || 'server-side-secret',
      repo: dataset.gitalkRepo,
      owner: dataset.gitalkOwner,
      admin: (dataset.gitalkAdmin || '').split(',').map(value => value.trim()).filter(Boolean),
      proxy: dataset.gitalkProxy,
      language: dataset.gitalkLanguage || 'zh-CN',
      perPage: Number.parseInt(dataset.gitalkPerPage, 10) || 10,
      pagerDirection: dataset.gitalkPagerDirection || 'last',
      distractionFreeMode: parseBoolean(dataset.gitalkDistractionFree),
      createIssueManually: parseBoolean(dataset.gitalkCreateManually),
      labels: (dataset.gitalkLabels || '').split(',').map(value => value.trim()).filter(Boolean),
      siteUrl: (dataset.gitalkSiteUrl || '').replace(/\/+$/, ''),
      scriptUrl: dataset.gitalkJs,
      stylesheetUrl: dataset.gitalkCss,
      themeStylesheetUrl: dataset.gitalkThemeCss
    }
  }

  const isConfigured = config => {
    return ![
      config.clientID,
      config.repo,
      config.owner,
      config.admin[0],
      config.proxy
    ].some(isPlaceholder)
  }

  const getPageTitle = () => {
    const pageTitle = document.querySelector('#pjax-page-header')?.dataset.pageTitle
    return pageTitle || document.querySelector('meta[property="og:title"]')?.content || document.title
  }

  const getCanonicalUrl = (siteUrl, pathname) => {
    const base = siteUrl || window.location.origin
    return new URL(normalizePathname(pathname).replace(/^\//, ''), `${base}/`).href
  }

  const updateCommentCount = count => {
    const target = document.querySelector('#post-meta .gitalk-comment-count')
    if (target) target.textContent = count
  }

  const cleanup = () => {
    state.generation += 1
    if (state.container) {
      state.container.replaceChildren()
      delete state.container.dataset.gitalkInitialized
    }
    state.container = null
    state.pageId = ''
  }

  const init = async () => {
    const container = document.getElementById('gitalk-container')
    if (!container) {
      cleanup()
      return
    }

    const pathname = normalizePathname(window.location.pathname)
    const pageId = createPageId(pathname)
    if (state.container === container && state.pageId === pageId && container.dataset.gitalkInitialized === 'true') return

    cleanup()
    state.container = container
    state.pageId = pageId
    container.dataset.gitalkPageId = pageId
    const generation = state.generation
    const config = getConfig(container)

    try {
      if (!isConfigured(config)) {
        await loadStyle(config.themeStylesheetUrl, 'blog-gitalk-theme')
        if (generation !== state.generation || !container.isConnected) return
        container.dataset.gitalkInitialized = 'true'
        renderStatus(container, '评论系统等待站长完成 GitHub OAuth 与服务端代理配置。')
        return
      }

      await loadStyle(config.stylesheetUrl, 'gitalk-upstream-theme')
      await loadStyle(config.themeStylesheetUrl, 'blog-gitalk-theme')
      await loadScript(config.scriptUrl, 'gitalk-upstream-script')
      if (generation !== state.generation || !container.isConnected) return

      const canonicalUrl = getCanonicalUrl(config.siteUrl, pathname)
      const gitalk = new window.Gitalk({
        clientID: config.clientID,
        clientSecret: 'server-side-secret',
        repo: config.repo,
        owner: config.owner,
        admin: config.admin,
        proxy: config.proxy,
        language: config.language,
        perPage: config.perPage,
        pagerDirection: config.pagerDirection,
        distractionFreeMode: config.distractionFreeMode,
        createIssueManually: config.createIssueManually,
        labels: config.labels,
        id: pageId,
        title: getPageTitle(),
        body: `页面：${canonicalUrl}`,
        updateCountCallback: updateCommentCount
      })

      container.replaceChildren()
      gitalk.render(container)
      container.dataset.gitalkInitialized = 'true'
    } catch (error) {
      if (generation !== state.generation || !container.isConnected) return
      renderStatus(container, '评论组件加载失败，请稍后重试。', 'error')
      console.error('[Gitalk] initialization failed:', error)
    }
  }

  window.BlogGitalk = {
    init,
    cleanup,
    normalizePathname,
    createPageId
  }

  if (!window.blogGitalkPjaxBound) {
    window.blogGitalkPjaxBound = true
    document.addEventListener('pjax:send', cleanup)
    document.addEventListener('pjax:complete', init)
    document.addEventListener('pjax:error', cleanup)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true })
  } else {
    init()
  }
})()
