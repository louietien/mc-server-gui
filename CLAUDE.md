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

**Backend** connects to the Docker daemon via the Unix socket (`/var/run/docker.sock`) using `dockerode`. It finds the Minecraft container by matching `MC_CONTAINER_NAME` as a prefix against container names (e.g. `mc-c43bu19mwqohpp7ove1f4edg`). Three API routes: `GET /api/status`, `POST /api/start`, `POST /api/stop`.

**Frontend** is a single vanilla HTML file served as a static asset. It polls `/api/status` every 8 seconds and shows one button at a time (Start or Stop) based on container state.

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `MC_CONTAINER_NAME` | `mc-` | Prefix used to find the Minecraft container via `docker ps` |
| `PORT` | `3005` | Port the HTTP server listens on |

## Deployment (Coolify)

1. Push repo to GitHub
2. Coolify → New Resource → Application → select the repo
3. Set env var: `MC_CONTAINER_NAME=mc-c43bu19mwqohpp7ove1f4edg`
4. Under the service's Volumes tab, add a bind mount: `/var/run/docker.sock` → `/var/run/docker.sock`
5. Assign a domain (e.g. `mc.lthm.dk`)

The Docker socket mount is required — without it the app cannot control the MC container.
