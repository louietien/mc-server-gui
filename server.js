const express = require('express')
const session = require('express-session')
const Dockerode = require('dockerode')

const app = express()
const docker = new Dockerode({ socketPath: '/var/run/docker.sock' })
const CONTAINER_NAME = process.env.MC_CONTAINER_NAME || 'mc-'

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
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' })
  res.redirect('/login.html')
}

app.get('/login.html', (req, res, next) => {
  if (req.session.authenticated) return res.redirect('/')
  next()
})

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

async function getContainer() {
  const containers = await docker.listContainers({ all: true })
  const info = containers.find(c => c.Names.some(n => n.replace('/', '').startsWith(CONTAINER_NAME)))
  if (!info) return null
  return { container: docker.getContainer(info.Id), state: info.State, status: info.Status }
}

app.get('/api/status', async (req, res) => {
  try {
    const result = await getContainer()
    if (!result) return res.json({ running: false, status: 'not found', missing: true })
    const { state, status } = result
    res.json({ running: state === 'running', status })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/start', async (req, res) => {
  try {
    const result = await getContainer()
    if (!result) return res.json({ ok: false, error: 'Minecraft container not found' })
    const { container, state } = result
    if (state !== 'running') await container.start()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/stop', async (req, res) => {
  try {
    const result = await getContainer()
    if (!result) return res.json({ ok: false, error: 'Minecraft container not found' })
    const { container, state } = result
    if (state === 'running') await container.stop()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

const PORT = process.env.PORT || 3005
app.listen(PORT, () => console.log(`Listening on :${PORT}`))
