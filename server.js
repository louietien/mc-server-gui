const express = require('express')
const Dockerode = require('dockerode')

const app = express()
const docker = new Dockerode({ socketPath: '/var/run/docker.sock' })
const CONTAINER_NAME = process.env.MC_CONTAINER_NAME || 'mc-'

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
