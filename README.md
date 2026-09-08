# Demon Dark

A live, private-room social deduction game for 5-6 players. Bard is excluded from this first playable ruleset; Fool appears in six-player games.

## Run

```bash
npm install
npm run dev
```

Open the Vite URL on the host machine. Vite listens on the LAN, so phones on the same network can use the host machine's LAN address on port 5173. The realtime server uses port 3001; allow both ports through the local firewall when testing on a network.

The host creates a room and shares the four-letter code. The host can start once 5-6 players have joined. The server handles role assignment, night/day timers, private role information, voting, deaths, and victory screens.

## Publish a shareable website

This repo includes `render.yaml` for Render. Create a new Web Service from the repository, choose the included blueprint, and deploy. Render runs the build and start commands, serves the compiled client from the Express server, and gives you an HTTPS URL to share. The client automatically uses the same origin for Socket.IO in production.

For local development, use `npm run dev`. For a production-like local check, use `npm run build && npm start`.
