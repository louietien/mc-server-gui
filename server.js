const express = require('express')
const Dockerode = require('dockerode')

const app = express()
const docker = new Dockerode({ socketPath: '/var/run/docker.sock' })
const CONTAINER_NAME = process.env.MC_CONTAINER_NAME || 'mc-'

const AUTH_USER = process.env.AUTH_USER
const AUTH_PASS = process.env.AUTH_PASS

app.use((req, res, next) => {
  if (!AUTH_USER || !AUTH_PASS) return next()
  const header = req.headers['authorization'] || ''
  const b64 = header.startsWith('Basic ') ? header.slice(6) : ''
  const [user, pass] = Buffer.from(b64, 'base64').toString().split(':')
  if (user === AUTH_USER && pass === AUTH_PASS) return next()
  res.set('WWW-Authenticate', 'Basic realm="MC Server"')
  res.status(401).send('Unauthorized')
})

app.use(express.static('public'))
app.use(express.json())

async function getContainer() {
  const containers = await docker.listContainers({ all: true })
  const info = containers.find(c => c.Names.some(n => n.replace('/', '').startsWith(CONTAINER_NAME)))
  if (!info) throw new Error('Minecraft container not found')
  return { container: docker.getContainer(info.Id), state: info.State, status: info.Status }
}

app.get('/api/status', async (req, res) => {
  try {
    const { state, status } = await getContainer()
    res.json({ running: state === 'running', status })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/start', async (req, res) => {
  try {
    const { container, state } = await getContainer()
    if (state !== 'running') await container.start()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/stop', async (req, res) => {
  try {
    const { container, state } = await getContainer()
    if (state === 'running') await container.stop()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

const PORT = process.env.PORT || 3005
app.listen(PORT, () => console.log(`Listening on :${PORT}`))
