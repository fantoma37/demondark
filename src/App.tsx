import { useEffect, useState } from 'react'
import { io, Socket } from 'socket.io-client'

type Player = { id: string; nickname: string; alive: boolean; ready: boolean; role?: string }
type GameState = {
  room: { code: string; hostId: string; phase: string; phaseEndsAt: number | null; firstNight: boolean; players: Player[] }
  me: Player & { roleDescription?: string; lastInfo?: string | null }
  choices: Player[]
  result: { winner: string; title: string; copy: string } | null
  nightPrompt: string | null
  teamInfo: { allies: string[]; bluff: string | null } | null
}

const socket: Socket = io(import.meta.env.VITE_SOCKET_URL || (import.meta.env.DEV ? `http://${window.location.hostname}:3001` : window.location.origin), { autoConnect: true })

function App() {
  const [mode, setMode] = useState<'home' | 'lobby' | 'game'>('home')
  const [nickname, setNickname] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [state, setState] = useState<GameState | null>(null)
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [remaining, setRemaining] = useState(0)

  useEffect(() => {
    const joined = (code: string) => { setRoomCode(code); setMode('lobby'); setMessage('') }
    const update = (next: GameState) => { setState(next); if (next.room.phase !== 'lobby') setMode('game') }
    socket.on('joined', joined)
    socket.on('state', update)
    socket.on('errorMessage', setMessage)
    return () => { socket.off('joined', joined); socket.off('state', update); socket.off('errorMessage', setMessage) }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setRemaining(state?.room.phaseEndsAt ? Math.max(0, Math.ceil((state.room.phaseEndsAt - Date.now()) / 1000)) : 0), 500)
    return () => window.clearInterval(timer)
  }, [state?.room.phaseEndsAt])

  useEffect(() => { setSelected(null) }, [state?.room.phase])

  const canJoin = nickname.trim().length > 0
  const me = state?.me

  function createRoom() { if (canJoin) socket.emit('createRoom', { nickname: nickname.trim() }) }
  function joinRoom() { if (canJoin && joinCode.length === 4) socket.emit('joinRoom', { nickname: nickname.trim(), code: joinCode }) }
  function choose(targetId: string) {
    setSelected(targetId)
    socket.emit(state?.room.phase === 'night' ? 'choose' : 'vote', { code: roomCode, targetId })
  }

  if (mode === 'home') return <main className="shell home"><div className="brand-mark">D</div><p className="eyebrow">A live social deduction game</p><h1>Demon Dark</h1><p className="lede">The village goes quiet.<br />Someone is already awake.</p><div className="panel entry-panel"><label>Your nickname<input value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="e.g. Rowan" maxLength={18} /></label><button className="primary" disabled={!canJoin} onClick={createRoom}>Create private game <span>↗</span></button><div className="or"><span>or join a game</span></div><div className="join-row"><input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="ROOM CODE" maxLength={4} /><button className="secondary" disabled={!canJoin || joinCode.length !== 4} onClick={joinRoom}>Join</button></div>{message && <p className="error">{message}</p>}</div><p className="tiny">Built for 5–6 players · one phone each</p></main>

  if (mode === 'lobby' && state) return <main className="shell"><Header status="LOBBY" /><section className="lobby-head"><p className="eyebrow">Private game</p><h2>Gather your circle.</h2><p>Share this code with the people at the table.</p><div className="room-code">{roomCode.split('').map((character) => <span key={character}>{character}</span>)}</div><button className="copy-button" onClick={() => navigator.clipboard?.writeText(roomCode)}>Copy room code</button></section><section className="player-list panel"><div className="section-title"><span>Players</span><strong>{state.room.players.length}<small>/6</small></strong></div>{state.room.players.map((player, index) => <PlayerRow key={player.id} player={player} index={index} isSelf={player.id === socket.id} isHost={player.id === state.room.hostId} />)}{state.room.players.length < 5 && <div className="waiting">Waiting for {5 - state.room.players.length} more player{5 - state.room.players.length === 1 ? '' : 's'}…</div>}</section><footer className="lobby-footer"><button className="primary" disabled={state.room.hostId !== socket.id || state.room.players.length < 5} onClick={() => socket.emit('startGame', { code: roomCode })}>{state.room.players.length < 5 ? 'Need 5 players to begin' : 'Start the game'} <span>→</span></button></footer></main>

  if (!state || !me) return null
  if (state.result) return <main className="shell result-screen"><div className={`result-sigil ${state.result.winner}`}>{state.result.winner === 'good' ? '✦' : state.result.winner === 'fool' ? '☻' : '☾'}</div><p className="eyebrow">Game over</p><h1>{state.result.title}</h1><p className="lede">{state.result.copy}</p><div className="final-roles panel"><div className="section-title"><span>The table</span><span>Roles revealed</span></div>{state.room.players.map((player) => <div className="player-row" key={player.id}><span className={`avatar ${player.alive ? 'alive' : 'dead'}`}>{player.nickname.slice(0, 1)}</span><span>{player.nickname}</span><b className="role-reveal">{player.role}</b></div>)}</div></main>

  const isNight = state.room.phase === 'night'
  const canAct = me.alive && me.role !== 'Fool' && !(isNight && state.room.firstNight && me.role === 'Demon')
  const targets = isNight ? state.choices : state.room.players.filter((player) => player.alive && player.id !== me.id)
  return <main className={`shell game-shell ${state.room.phase}`}><Header status={`${isNight ? 'NIGHT' : 'DAY'}  ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`} /><div className="game-intro"><p className="eyebrow">{me.alive ? `You are the ${me.role}` : 'You are dead'}</p><h2>{me.role}</h2><p>{me.roleDescription}</p>{state.teamInfo && <div className="info-note"><span>☾</span>{state.teamInfo.allies.join(' and ')} are the Evil team.{state.teamInfo.bluff && ` Bluff: ${state.teamInfo.bluff}.`}</div>}{me.lastInfo && <div className="info-note"><span>✦</span>{me.lastInfo}</div>}</div><section className="action-area">{canAct ? <><div className="action-heading"><span>{isNight ? 'Choose one player' : 'Vote to execute'}</span><small>Tap to confirm</small></div><div className="target-grid">{targets.map((player) => <button className={`target ${selected === player.id ? 'selected' : ''}`} key={player.id} onClick={() => choose(player.id)}><span className="avatar">{player.nickname.slice(0, 1)}</span><span>{player.nickname}</span><i>{selected === player.id ? '✓' : '○'}</i></button>)}</div><div className="action-explainer">{state.nightPrompt || 'Choose carefully. Votes are private.'}</div></> : <div className="sleep-state"><span className="moon">☾</span><h3>{me.role === 'Demon' && state.room.firstNight ? 'The first night is for learning.' : me.alive ? 'The night passes over you.' : 'Your story has ended.'}</h3><p>{me.alive ? 'Stay quiet. Watch the clock.' : 'You can still watch the village.'}</p></div>}</section><div className="alive-strip">{state.room.players.map((player) => <span className={player.alive ? '' : 'is-dead'} key={player.id}>{player.nickname.slice(0, 1)}</span>)}</div>{state.room.hostId === socket.id && state.room.phase === 'day' && <button className="end-day" onClick={() => socket.emit('endDay', { code: roomCode })}>End day early</button>}</main>
}

function Header({ status }: { status: string }) { return <header className="topbar"><div className="wordmark"><span className="brand-dot">D</span> DEMON DARK</div><span className="status-pill">{status}</span></header> }
function PlayerRow({ player, index, isSelf, isHost }: { player: Player; index: number; isSelf: boolean; isHost: boolean }) { return <div className="player-row"><span className={`avatar avatar-${index % 4}`}>{player.nickname.slice(0, 1).toUpperCase()}</span><span>{player.nickname}{isSelf && <em> you</em>}</span>{isHost && <span className="host-tag">HOST</span>}</div> }

export default App
