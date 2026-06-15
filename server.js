const express = require('express')
const session = require('express-session')
const Dockerode = require('dockerode')

const app = express()
const docker = new Dockerode({ socketPath: '/var/run/docker.sock' })

const SERVERS = {
  mc:       process.env.MC_CONTAINER_NAME       || 'mc-',
  skyblock: process.env.SKYBLOCK_CONTAINER_NAME || 'skyblock-',
}

const AUTH_USER = process.env.AUTH_USER
const AUTH_PASS = process.env.AUTH_PASS
const SESSION_SECRET = process.env.SESSION_SECRET || 'mc-gui-secret'

app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 }
}))

function requireAuth(req, res, next) {
  if (!AUTH_USER || !AUTH_PASS) return next()
  if (req.session.authenticated) return next()
  if (req.path === '/login.html' || req.path === '/login') return next()
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' })
  res.redirect('/login.html')
}

app.post('/login', (req, res) => {
  const { username, password } = req.body
  if (username === AUTH_USER && password === AUTH_PASS) {
    req.session.authenticated = true
    return res.redirect('/')
  }
  res.redirect('/login.html?error=1')
})

app.get('/logout', (req, res) => {
  req.session.destroy()
  res.redirect('/login.html')
})

app.use(requireAuth)
app.use(express.static('public'))

async function getContainer(prefix) {
  const containers = await docker.listContainers({ all: true })
  const info = containers.find(c => c.Names.some(n => n.replace('/', '').startsWith(prefix)))
  if (!info) return null
  return { container: docker.getContainer(info.Id), state: info.State, status: info.Status }
}

function resolvePrefix(req, res) {
  const key = req.query.server || 'mc'
  const prefix = SERVERS[key]
  if (!prefix) { res.status(400).json({ error: 'Unknown server' }); return null }
  return prefix
}

app.get('/api/status', async (req, res) => {
  const prefix = resolvePrefix(req, res)
  if (!prefix) return
  try {
    const result = await getContainer(prefix)
    if (!result) return res.json({ running: false, status: 'not found', missing: true })
    const { state, status } = result
    res.json({ running: state === 'running', status })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/start', async (req, res) => {
  const prefix = resolvePrefix(req, res)
  if (!prefix) return
  try {
    const result = await getContainer(prefix)
    if (!result) return res.json({ ok: false, error: 'Container not found' })
    const { container, state } = result
    if (state !== 'running') await container.start()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/stop', async (req, res) => {
  const prefix = resolvePrefix(req, res)
  if (!prefix) return
  try {
    const result = await getContainer(prefix)
    if (!result) return res.json({ ok: false, error: 'Container not found' })
    const { container, state } = result
    if (state === 'running') await container.stop()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

const PORT = process.env.PORT || 3005
app.listen(PORT, () => console.log(`Listening on :${PORT}`))
