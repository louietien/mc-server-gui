// Shared light/dark theme handling. Loaded synchronously in <head> so the
// theme is set before first paint. Follows the OS setting until the user
// picks one with the toggle; the choice is then remembered.
(function () {
  var KEY = 'mc-theme'
  var root = document.documentElement
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null

  function stored() {
    try {
      var v = localStorage.getItem(KEY)
      return v === 'light' || v === 'dark' ? v : null
    } catch (e) { return null }
  }

  function system() { return mq && mq.matches ? 'light' : 'dark' }

  function apply(theme) {
    root.setAttribute('data-theme', theme)
    var meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', theme === 'light' ? '#e6eee6' : '#0b100f')
    var btn = document.getElementById('theme-toggle')
    if (btn) {
      var label = 'Switch to ' + (theme === 'light' ? 'dark' : 'light') + ' theme'
      btn.setAttribute('aria-label', label)
      btn.setAttribute('title', label)
    }
  }

  apply(stored() || system())

  if (mq && mq.addEventListener) {
    mq.addEventListener('change', function () { if (!stored()) apply(system()) })
  }

  document.addEventListener('DOMContentLoaded', function () {
    apply(root.getAttribute('data-theme'))
    var btn = document.getElementById('theme-toggle')
    if (!btn) return
    btn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light'
      try { localStorage.setItem(KEY, next) } catch (e) {}
      apply(next)
    })
  })
})()
