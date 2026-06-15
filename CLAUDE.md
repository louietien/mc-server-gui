# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install       # install dependencies
npm start         # run locally on :3000
```

No build step — the app runs directly with Node.

## Architecture

Single-file Node.js backend (`server.js`) + single-file frontend (`public/index.html`). No framework, no bundler.

**Backend** connects to the Docker daemon via the Unix socket (`/var/run/docker.sock`) using `dockerode`. Finds containers by prefix from env vars. Routes accept `?server=mc|skyblock`: `GET /api/status`, `POST /api/start`, `POST /api/stop`.

**Frontend** is a single vanilla HTML file served as a static asset. Shows two server cards (Survival + Skyblock), each polling `/api/status?server=<id>` every 8 seconds independently.

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `MC_CONTAINER_NAME` | `mc-` | Prefix to find Survival container |
| `SKYBLOCK_CONTAINER_NAME` | `skyblock-` | Prefix to find Skyblock container |
| `PORT` | `3005` | Port the HTTP server listens on |

## Deployment (Coolify)

1. Push repo to GitHub
2. Coolify → New Resource → Application → select the repo
3. Set env vars: `MC_CONTAINER_NAME=mc-ybm749g4du2qaudvl6dfwsim`, `SKYBLOCK_CONTAINER_NAME=mc-ex2lov9altg9keg3u5hoz2b0`
4. Under the service's Volumes tab, add a bind mount: `/var/run/docker.sock` → `/var/run/docker.sock`
5. Assign a domain (e.g. `mc.lthm.dk`)

The Docker socket mount is required — without it the app cannot control the MC container.
