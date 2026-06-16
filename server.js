const express = require('express')
const session = require('express-session')
const Dockerode = require('dockerode')
const net = require('net')
const fs = require('fs')
const path = require('path')

const LOG_FILE = path.join(__dirname, 'data', 'activity.json')

function loadLog() {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
    return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'))
  } catch { return [] }
}

function saveLog() {
  fs.writeFile(LOG_FILE, JSON.stringify(activityLog), err => {
    if (err) console.error('Failed to save log:', err.message)
  })
}

const app = express()
const docker = new Dockerode({ socketPath: '/var/run/docker.sock' })

const SERVERS = {
  mc:       { prefix: process.env.MC_CONTAINER_NAME       || 'mc-',       uuid: process.env.MC_COOLIFY_UUID       || '' },
  skyblock: { prefix: process.env.SKYBLOCK_CONTAINER_NAME || 'skyblock-', uuid: process.env.SKYBLOCK_COOLIFY_UUID || '' },
}

const COOLIFY_API_URL   = process.env.COOLIFY_API_URL   || 'http://10.0.1.1:8000'
const COOLIFY_API_TOKEN = process.env.COOLIFY_API_TOKEN || ''
const PORTS = {
  mc:       parseInt(process.env.MC_PORT)       || 25565,
  skyblock: parseInt(process.env.SKYBLOCK_PORT) || 25566,
}
const AUTO_STOP_MS = (parseInt(process.env.AUTO_STOP_MINUTES) || 30) * 60 * 1000

const AUTH_USER = process.env.AUTH_USER
const AUTH_PASS = process.env.AUTH_PASS
const SESSION_SECRET = process.env.SESSION_SECRET || 'mc-gui-secret'

// --- MC Server List Ping (SLP) ---

function varInt(val) {
  const out = []
  do {
    let b = val & 0x7f
    val >>>= 7
    if (val) b |= 0x80
    out.push(b)
  } while (val)
  return Buffer.from(out)
}

function mcPing(host, port, timeout = 2000) {
  return new Promise(resolve => {
    const sock = new net.Socket()
    sock.setTimeout(timeout)
    let data = Buffer.alloc(0)

    sock.connect(port, host, () => {
      const addrBuf = Buffer.from(host, 'utf8')
      const hs = Buffer.concat([
        varInt(0x00), varInt(760),
        varInt(addrBuf.length), addrBuf,
        Buffer.from([(port >> 8) & 0xff, port & 0xff]),
        varInt(1),
      ])
      sock.write(Buffer.concat([varInt(hs.length), hs]))
      const req = varInt(0x00)
      sock.write(Buffer.concat([varInt(req.length), req]))
    })

    sock.on('data', chunk => {
      data = Buffer.concat([data, chunk])
      try {
        let i = 0
        while (data[i++] & 0x80) {}
        while (data[i++] & 0x80) {}
        let len = 0, shift = 0
        for (;;) {
          const b = data[i++]
          len |= (b & 0x7f) << shift
          if (!(b & 0x80)) break
          shift += 7
        }
        if (data.length < i + len) return
        resolve(JSON.parse(data.slice(i, i + len).toString()))
        sock.destroy()
      } catch {}
    })

    sock.on('timeout', () => { sock.destroy(); resolve(null) })
    sock.on('error',   () => resolve(null))
  })
}

// --- Coolify API helpers ---

async function coolifyAction(uuid, action) {
  const r = await fetch(`${COOLIFY_API_URL}/api/v1/services/${uuid}/${action}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${COOLIFY_API_TOKEN}` },
  })
  if (!r.ok) {
    const d = await r.json().catch(() => ({}))
    throw new Error(d.message || `Coolify API error ${r.status}`)
  }
}

async function getCoolifyRunning(uuid) {
  if (!COOLIFY_API_TOKEN || !uuid) return null
  try {
    const r = await fetch(`${COOLIFY_API_URL}/api/v1/services/${uuid}`, {
      headers: { Authorization: `Bearer ${COOLIFY_API_TOKEN}` },
    })
    if (!r.ok) return null
    const d = await r.json()
    return d.status === 'running'
  } catch {
    return null
  }
}

async function stopServer(serverKey) {
  const { prefix, uuid } = SERVERS[serverKey]
  if (COOLIFY_API_TOKEN && uuid) {
    await coolifyAction(uuid, 'stop')
  } else {
    const result = await getContainer(prefix)
    if (result?.state === 'running') await result.container.stop()
  }
}

async function startServer(serverKey) {
  const { prefix, uuid } = SERVERS[serverKey]
  if (COOLIFY_API_TOKEN && uuid) {
    await coolifyAction(uuid, 'restart')
  } else {
    const result = await getContainer(prefix)
    if (!result) throw new Error('Container not found')
    if (result.state !== 'running') await result.container.start()
  }
}

// --- Auto-stop ---

const autoStopTimers = new Map()

function scheduleAutoStop(serverKey) {
  if (autoStopTimers.has(serverKey)) return
  const scheduledAt = Date.now()
  const timer = setTimeout(async () => {
    autoStopTimers.delete(serverKey)
    try {
      await stopServer(serverKey)
      addLogEntry('stop', serverKey, 'system')
      console.log(`Auto-stopped ${serverKey}`)
    } catch (e) {
      console.error(`Auto-stop failed for ${serverKey}:`, e.message)
    }
  }, AUTO_STOP_MS)
  autoStopTimers.set(serverKey, { timer, scheduledAt })
}

function cancelAutoStop(serverKey) {
  const entry = autoStopTimers.get(serverKey)
  if (entry) { clearTimeout(entry.timer); autoStopTimers.delete(serverKey) }
}

function autoStopRemaining(serverKey) {
  const entry = autoStopTimers.get(serverKey)
  if (!entry) return null
  return Math.max(0, Math.round((entry.scheduledAt + AUTO_STOP_MS - Date.now()) / 1000))
}

// --- Express setup ---

app.set('trust proxy', true)
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
  if (/\.(svg|png|jpg|jpeg|ico|webp|css|js)$/i.test(req.path)) return next()
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

// --- Docker helpers ---

async function getContainer(prefix) {
  const containers = await docker.listContainers({ all: true })
  const info = containers.find(c => c.Names.some(n => n.replace('/', '').startsWith(prefix)))
  if (!info) return null
  const container = docker.getContainer(info.Id)
  let startedAt = null
  if (info.State === 'running') {
    try {
      const details = await container.inspect()
      startedAt = details.State.StartedAt
    } catch {}
  }
  return { container, state: info.State, status: info.Status, startedAt }
}

function resolvePrefix(req, res) {
  const key = req.query.server || 'mc'
  const server = SERVERS[key]
  if (!server) { res.status(400).json({ error: 'Unknown server' }); return null }
  return server.prefix
}

// --- Activity log ---

const activityLog = loadLog()

function addLogEntry(action, server, ip) {
  activityLog.unshift({ time: new Date().toISOString(), action, server, ip: ip || 'system', user: 'system' })
  if (activityLog.length > 1000) activityLog.pop()
  saveLog()
}

function addLog(req, action, server) {
  const ip = req.headers['cf-connecting-ip']
    || req.headers['x-real-ip']
    || req.headers['x-forwarded-for']?.split(',')[0].trim()
    || req.ip
  const user = req.session?.authenticated ? (process.env.AUTH_USER || 'user') : 'anonymous'
  activityLog.unshift({ time: new Date().toISOString(), action, server, ip, user })
  if (activityLog.length > 1000) activityLog.pop()
  saveLog()
}

app.get('/api/log', requireAuth, (req, res) => {
  res.json(activityLog)
})

// --- Routes ---

app.get('/api/status', async (req, res) => {
  const key = req.query.server || 'mc'
  const prefix = resolvePrefix(req, res)
  if (!prefix) return
  try {
    const result = await getContainer(prefix)
    const { uuid } = SERVERS[key]

    if (!result) {
      const coolifyUp = await getCoolifyRunning(uuid)
      const lastStopped = activityLog.find(e => e.server === key && e.action === 'stop')?.time || null
      if (coolifyUp) return res.json({ running: true, status: 'starting', uptime: null, players: null, autoStopIn: null, version: null, lastStopped })
      return res.json({ running: false, status: 'not found', missing: true })
    }

    const { state, status, startedAt } = result
    const dockerRunning = state === 'running' || state === 'restarting'
    const running = dockerRunning || (await getCoolifyRunning(uuid) ?? false)
    let players = null
    let uptime = null
    let ping = null

    if (running) {
      uptime = startedAt ? Math.round((Date.now() - new Date(startedAt)) / 1000) : null
      const pingHost = new URL(COOLIFY_API_URL).hostname
      ping = await mcPing(pingHost, PORTS[key])
      if (ping?.players) players = ping.players
    }

    if (running && players !== null) {
      if (players.online === 0) scheduleAutoStop(key)
      else cancelAutoStop(key)
    } else {
      cancelAutoStop(key)
    }

    const version = running && ping?.version?.name ? ping.version.name : null
    const lastStopped = activityLog.find(e => e.server === key && e.action === 'stop')?.time || null
    res.json({ running, status, uptime, players, autoStopIn: autoStopRemaining(key), version, lastStopped })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/start', async (req, res) => {
  const key = req.query.server || 'mc'
  if (!SERVERS[key]) return res.status(400).json({ error: 'Unknown server' })
  try {
    await startServer(key)
    addLog(req, 'start', key)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/stop', async (req, res) => {
  const key = req.query.server || 'mc'
  if (!SERVERS[key]) return res.status(400).json({ error: 'Unknown server' })
  try {
    await stopServer(key)
    cancelAutoStop(key)
    addLog(req, 'stop', key)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/extend', requireAuth, (req, res) => {
  const key = req.query.server || 'mc'
  if (!SERVERS[key]) return res.status(400).json({ error: 'Unknown server' })
  const entry = autoStopTimers.get(key)
  if (!entry) return res.json({ ok: true, extended: false })
  clearTimeout(entry.timer)
  autoStopTimers.delete(key)
  scheduleAutoStop(key)
  res.json({ ok: true, extended: true })
})

const PORT = process.env.PORT || 3005
app.listen(PORT, () => console.log(`Listening on :${PORT}`))
