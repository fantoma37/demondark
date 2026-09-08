import express from 'express'
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const app = express()
const httpServer = createServer(app)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const io = new Server(httpServer, { cors: { origin: process.env.CLIENT_ORIGIN || true } })
const rooms = new Map()
const roles = ['Priest', 'Sage', 'Guard', 'Knight', 'Minion', 'Demon', 'Fool']
const goodRoles = ['Priest', 'Sage', 'Guard', 'Knight']
const roleDescriptions = {
  Priest: 'Learn if your chosen player is good.',
  Sage: 'Tomorrow night, learn the role of your chosen player.',
  Guard: 'Your chosen player cannot die tonight.',
  Knight: 'If you die, and your chosen player is the Demon, they die instead.',
  Minion: 'Learn the role of your chosen player.',
  Demon: 'Your chosen player dies tonight.',
  Fool: 'You have no night action. If the town executes you, you win.'
}

function makeCode() {
  let code = ''
  do code = Math.random().toString(36).slice(2, 6).toUpperCase()
  while (rooms.has(code))
  return code
}
function publicRoom(room) {
  return { code: room.code, hostId: room.hostId, phase: room.phase, phaseEndsAt: room.phaseEndsAt, firstNight: room.firstNight, resolution: room.resolution, players: [...room.players.values()].map(({ id, nickname, alive, ready, role }) => ({ id, nickname, alive, ready, role: room.result ? role : undefined })) }
}
function visibleState(room, socketId) {
  const player = room.players.get(socketId)
  const evil = player?.role === 'Demon' || player?.role === 'Minion'
  const allies = [...room.players.values()].filter((p) => (p.role === 'Demon' || p.role === 'Minion') && p.id !== socketId).map((p) => p.nickname)
  const immediateInfo = player?.lastInfo || (player?.choice && player.role === 'Priest' ? `${room.players.get(player.choice)?.nickname} is ${['Priest', 'Sage', 'Guard', 'Knight'].includes(room.players.get(player.choice)?.role) ? 'good' : 'not good'}.` : player?.choice && player.role === 'Minion' ? `${room.players.get(player.choice)?.nickname} is the ${room.players.get(player.choice)?.role}.` : null)
  const choices = room.phase === 'night' && !player?.choice && !(room.firstNight && player?.role === 'Demon') ? [...room.players.values()].filter((p) => p.alive && p.id !== socketId).map((p) => ({ id: p.id, nickname: p.nickname })) : []
  return { room: publicRoom(room), me: player ? { ...player, roleDescription: roleDescriptions[player.role], immediateInfo } : null, choices, result: room.result, nightPrompt: player?.role === 'Fool' ? null : room.firstNight && player?.role === 'Demon' ? 'The first night is for learning. Stay hidden and watch.' : player?.role ? roleDescriptions[player.role] : null, teamInfo: evil ? { allies, bluff: player?.role === 'Demon' ? player.bluffRole : null } : null }
}
function broadcast(room) {
  for (const player of room.players.values()) io.to(player.id).emit('state', visibleState(room, player.id))
}
function assignRoles(room) {
  const good = [...goodRoles].sort(() => Math.random() - 0.5).slice(0, 3)
  const shuffled = [...good, 'Minion', 'Demon', ...(room.players.size === 6 ? ['Fool'] : [])].sort(() => Math.random() - 0.5)
  for (const [index, player] of [...room.players.values()].entries()) player.role = shuffled[index]
  const demon = [...room.players.values()].find((player) => player.role === 'Demon')
  if (demon) demon.bluffRole = goodRoles.filter((role) => ![...room.players.values()].some((player) => player.role === role))[0]
}
function startPhase(room, phase, seconds) {
  room.phase = phase
  room.phaseEndsAt = Date.now() + seconds * 1000
  room.resolution = null
  room.choices = new Map()
  clearTimeout(room.timer)
  room.timer = setTimeout(() => phase === 'night' ? resolveNight(room) : resolveVotes(room), seconds * 1000)
}
function startResolution(room, resolution) {
  room.phase = 'resolution'
  room.phaseEndsAt = Date.now() + 5000
  room.resolution = resolution
  clearTimeout(room.timer)
  room.timer = setTimeout(() => {
    room.resolution = null
    if (room.result) {
      room.phase = 'gameover'
      room.phaseEndsAt = null
      broadcast(room)
    } else if (resolution.kind === 'execution') startPhase(room, 'night', 60)
    else startPhase(room, 'day', 180)
    broadcast(room)
  }, 5000)
}
function checkWin(room) {
  const alive = [...room.players.values()].filter((p) => p.alive)
  const demonAlive = alive.some((p) => p.role === 'Demon')
  const goodAlive = alive.some((p) => p.role !== 'Demon' && p.role !== 'Minion')
  if (!demonAlive) room.result = { winner: 'good', title: 'The town endures', copy: 'The Demon has fallen. Dawn belongs to the Good team.' }
  else if (!goodAlive) room.result = { winner: 'evil', title: 'Night takes the village', copy: 'The Demon and Minion have outlasted the Good team.' }
  return Boolean(room.result)
}
function resolveNight(room) {
  const protectedId = [...room.players.values()].find((p) => p.role === 'Guard' && p.alive)?.choice
  const demon = [...room.players.values()].find((p) => p.role === 'Demon' && p.alive)
  const knight = [...room.players.values()].find((p) => p.role === 'Knight' && p.alive)
  const knightWasAttacked = demon?.choice === knight?.id && demon.choice !== protectedId
  let killed = null
  if (demon?.choice && demon.choice !== protectedId) {
    const target = room.players.get(demon.choice)
    if (target) { target.alive = false; killed = target }
  }
  if (knightWasAttacked && knight?.choice === demon?.id) demon.alive = false
  for (const player of room.players.values()) {
    player.lastInfo = null
    const target = player.choice ? room.players.get(player.choice) : null
    if (player.role === 'Priest' && target) player.lastInfo = `${target.nickname} is ${['Priest', 'Sage', 'Guard', 'Knight'].includes(target.role) ? 'good' : 'not good'}.`
    if (player.role === 'Sage' && player.alive && player.previousChoice && room.players.has(player.previousChoice)) player.lastInfo = `${room.players.get(player.previousChoice).nickname} is the ${room.players.get(player.previousChoice).role}.`
    if (player.role === 'Minion' && target) player.lastInfo = `${target.nickname} is the ${target.role}.`
    if (player.role === 'Priest' && target) player.lastInfo = `${target.nickname} is ${['Priest', 'Sage', 'Guard', 'Knight'].includes(target.role) ? 'good' : 'not good'}.`
    if (player.role === 'Minion' && target) player.lastInfo = `${target.nickname} is the ${target.role}.`
    player.previousChoice = player.choice
    player.choice = null
  }
  const won = checkWin(room)
  room.firstNight = false
  startResolution(room, { kind: 'night', title: killed ? 'The night claims a life' : 'The night passes quietly', copy: killed ? `${killed.nickname} was found dead at dawn.` : 'No one died during the night.' })
  if (!won) room.result = null
  broadcast(room)
}
function resolveVotes(room) {
  const counts = new Map()
  for (const [voterId, choice] of room.choices) if (room.players.get(voterId)?.alive) counts.set(choice, (counts.get(choice) || 0) + 1)
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const executed = top.length && (!top[1] || top[0][1] > top[1][1]) ? room.players.get(top[0][0]) : null
  if (executed) {
    executed.alive = false
    if (executed.role === 'Fool') room.result = { winner: 'fool', title: 'The Fool wins', copy: `${executed.nickname} fooled the whole town.` }
    const demon = [...room.players.values()].find((p) => p.role === 'Demon')
    if (executed.role === 'Knight' && room.choices.get(executed.id) === demon?.id) demon.alive = false
  }
  room.choices = new Map()
  const won = Boolean(room.result) || checkWin(room)
  startResolution(room, { kind: 'execution', title: executed ? `${executed.nickname} was executed` : 'No one was executed', copy: executed ? `${executed.nickname} was chosen by the town.` : 'The vote was tied or no one received a vote.' })
  if (!won) room.result = null
  broadcast(room)
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ nickname }) => {
    const room = { code: makeCode(), hostId: socket.id, players: new Map(), phase: 'lobby', phaseEndsAt: null, firstNight: false, choices: new Map(), result: null, resolution: null }
    room.players.set(socket.id, { id: socket.id, nickname, alive: true, ready: true, role: null, choice: null, previousChoice: null, lastInfo: null })
    rooms.set(room.code, room); socket.join(room.code); socket.emit('joined', room.code); broadcast(room)
  })
  socket.on('joinRoom', ({ code, nickname }) => {
    const room = rooms.get(code?.toUpperCase())
    if (!room || room.phase !== 'lobby' || room.players.size >= 6) return socket.emit('errorMessage', 'That room is full or already in progress.')
    room.players.set(socket.id, { id: socket.id, nickname, alive: true, ready: true, role: null, choice: null, previousChoice: null, lastInfo: null })
    socket.join(room.code); socket.emit('joined', room.code); broadcast(room)
  })
  socket.on('startGame', ({ code }) => {
    const room = rooms.get(code); if (!room || room.hostId !== socket.id || room.players.size < 5) return
    assignRoles(room); room.firstNight = true; startPhase(room, 'night', 60); broadcast(room)
  })
  socket.on('choose', ({ code, targetId }) => {
    const room = rooms.get(code); const player = room?.players.get(socket.id)
    const target = room?.players.get(targetId)
    if (!room || !player || !player.alive || player.role === 'Fool' || player.choice || (room.firstNight && player.role === 'Demon') || !target || !target.alive || target.id === player.id || room.phase !== 'night') return
    player.choice = targetId
    player.lastInfo = player.role === 'Priest' ? `${target.nickname} is ${['Priest', 'Sage', 'Guard', 'Knight'].includes(target.role) ? 'good' : 'not good'}.` : player.role === 'Minion' ? `${target.nickname} is the ${target.role}.` : player.lastInfo
    room.choices.set(socket.id, targetId); broadcast(room)
  })
  socket.on('vote', ({ code, targetId }) => {
    const room = rooms.get(code); const player = room?.players.get(socket.id)
    const target = targetId ? room?.players.get(targetId) : null
    if (!room || !player?.alive || room.phase !== 'day' || (targetId && (!target?.alive || target.id !== player.id && !target))) return
    if (!targetId) { room.choices.delete(socket.id); broadcast(room); return }
    room.choices.set(socket.id, targetId); broadcast(room)
  })
  socket.on('endDay', ({ code }) => { const room = rooms.get(code); if (room?.hostId === socket.id && room.phase === 'day') resolveVotes(room) })
  socket.on('disconnect', () => { for (const room of rooms.values()) { if (room.players.delete(socket.id)) { if (room.players.size === 0) rooms.delete(room.code); else { if (room.hostId === socket.id) room.hostId = room.players.keys().next().value; broadcast(room) } } } })
})
app.get('/health', (_req, res) => res.json({ ok: true }))
app.use(express.static(path.join(__dirname, '../dist')))
app.get(/.*/, (_req, res) => res.sendFile(path.join(__dirname, '../dist/index.html')))
const port = Number(process.env.PORT || 3001)
httpServer.listen(port, () => console.log(`Demon Dark server listening on port ${port}`))
