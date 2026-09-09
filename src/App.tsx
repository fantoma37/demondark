import { useEffect, useState } from 'react'
import { io, Socket } from 'socket.io-client'

type Player = { id: string; nickname: string; alive: boolean; ready: boolean; role?: string }
type Resolution = { kind: 'execution' | 'night'; title: string; copy: string }
type GameState = {
  room: { code: string; hostId: string; phase: string; phaseEndsAt: number | null; firstNight: boolean; resolution: Resolution | null; players: Player[] }
  me: Player & { roleDescription?: string; immediateInfo?: string | null; resolutionInfo?: string | null }
  choices: Player[]
  result: { winner: string; title: string; copy: string } | null
  teamInfo: { demon: string | null; minion: string | null; bluff: string[] | null } | null
}

const socket: Socket = io(import.meta.env.VITE_SOCKET_URL || (import.meta.env.DEV ? `http://${window.location.hostname}:3001` : window.location.origin), { autoConnect: true })
const roleGroups = [
  { title: 'Good team', roles: [['Priest', 'Choose a player to learn if they are good.'], ['Bard', 'Choose a player. They learn that you are the Bard.'], ['Sage', 'Choose a player. At the start of the next night, learn their role.'], ['Guard', 'Choose a player. They cannot die tonight.'], ['Knight', 'Choose a player. If you die, and they are the Demon, they die instead.']] },
  { title: 'Evil team', roles: [['Minion', 'Your Demon is your ally. Choose another player to learn their role.'], ['Demon', 'Choose a player to kill tonight.']] },
  { title: 'Wild card', roles: [['Fool', 'If the town executes you, you win.']] }
]

function App() {
  const [mode, setMode] = useState<'home' | 'lobby' | 'game'>('home')
  const [nickname, setNickname] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [state, setState] = useState<GameState | null>(null)
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [guideOpen, setGuideOpen] = useState(false)
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
    const timer = window.setInterval(() => setRemaining(state?.room.phaseEndsAt ? Math.max(0, Math.ceil((state.room.phaseEndsAt - Date.now()) / 1000)) : 0), 250)
    return () => window.clearInterval(timer)
  }, [state?.room.phaseEndsAt])
  useEffect(() => setSelected(null), [state?.room.phase])

  const canJoin = nickname.trim().length > 0
  const me = state?.me
  const openGuide = () => setGuideOpen(true)
  const closeGuide = () => setGuideOpen(false)
  function choose(targetId: string) {
    if (state?.room.phase === 'day' && selected === targetId) {
      setSelected(null)
      socket.emit('vote', { code: roomCode, targetId: null })
      return
    }
    setSelected(targetId)
    socket.emit(state?.room.phase === 'night' ? 'choose' : 'vote', { code: roomCode, targetId })
  }

  if (mode === 'home') return <main className="shell home"><div className="brand-mark">D</div><h1>Demon Dark</h1><div className="panel entry-panel"><label>Your nickname<input value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="e.g. Rowan" maxLength={18} /></label><button className="primary" disabled={!canJoin} onClick={() => socket.emit('createRoom', { nickname: nickname.trim() })}>Create private game <span>↗</span></button><div className="or"><span>or join a game</span></div><div className="join-row"><input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="ROOM CODE" maxLength={4} /><button className="secondary" disabled={!canJoin || joinCode.length !== 4} onClick={() => socket.emit('joinRoom', { nickname: nickname.trim(), code: joinCode })}>Join</button></div>{message && <p className="error">{message}</p>}</div><button className="guide-link" onClick={openGuide}>Characters</button><RoleGuide open={guideOpen} onClose={closeGuide} /></main>

  if (mode === 'lobby' && state) return <main className="shell"><Header status="LOBBY" onGuide={openGuide} /><section className="lobby-head"><p className="eyebrow">Room code</p><h2>{roomCode}</h2><button className="copy-button" onClick={() => navigator.clipboard?.writeText(roomCode)}>Copy code</button></section><section className="player-list panel"><div className="section-title"><span>Players</span><strong>{state.room.players.length}<small>/6</small></strong></div>{state.room.players.map((player, index) => <PlayerRow key={player.id} player={player} index={index} isSelf={player.id === socket.id} isHost={player.id === state.room.hostId} />)}{state.room.players.length < 5 && <div className="waiting">Need {5 - state.room.players.length} more player{5 - state.room.players.length === 1 ? '' : 's'}.</div>}</section><button className="primary" disabled={state.room.hostId !== socket.id || state.room.players.length < 5} onClick={() => socket.emit('startGame', { code: roomCode })}>{state.room.players.length < 5 ? 'Need 5 players to begin' : 'Start the game'} <span>→</span></button><RoleGuide open={guideOpen} onClose={closeGuide} /></main>

  if (!state || !me) return null
  if (state.room.phase === 'resolution' && state.room.resolution) return <main className="shell resolution-screen"><Header status="RESOLUTION" onGuide={openGuide} /><div className="resolution-card"><h1>{state.room.resolution.kind === 'night' ? 'Night result' : state.room.resolution.title}</h1>{me.resolutionInfo && <p className="information-copy resolution-info">{me.resolutionInfo}</p>}<p className="resolution-copy">{state.room.resolution.copy}</p><strong className="resolution-countdown">{remaining}</strong></div><RoleGuide open={guideOpen} onClose={closeGuide} /></main>
  if (state.result) return <main className="shell result-screen"><Header status="GAME OVER" onGuide={openGuide} /><h1>{state.result.title}</h1><p className="lede">{state.result.copy}</p>{state.room.hostId === socket.id && <button className="primary rematch-button" onClick={() => socket.emit('rematch', { code: roomCode })}>Play again <span>↻</span></button>}<RoleGuide open={guideOpen} onClose={closeGuide} /></main>

  const isNight = state.room.phase === 'night'
  const noNightChoice = isNight && (me.role === 'Fool' || ((me.role === 'Demon' || me.role === 'Guard') && state.room.firstNight))
  const canAct = me.alive && (isNight ? !noNightChoice : true)
  const targets = isNight ? state.choices : state.room.players.filter((player) => player.alive)
  return <main className={`shell game-shell ${state.room.phase}`}><Header status={isNight ? 'NIGHT' : 'DAY'} time={remaining} onGuide={openGuide} /><div className="game-intro"><p className="eyebrow">{isNight && me.alive ? `You are the ${me.role}` : me.alive ? 'Day phase' : 'You are dead'}</p><h2>{isNight ? me.role : 'The town decides'}</h2>{isNight && me.immediateInfo && <div className="information-copy top-information">{me.immediateInfo}</div>}{isNight && state.teamInfo?.demon && <div className="evil-info">Your Demon is <strong>{state.teamInfo.demon}</strong></div>}{isNight && state.teamInfo?.minion && <div className="evil-info">Your Minion is <strong>{state.teamInfo.minion}</strong></div>}{isNight && state.teamInfo?.bluff?.map((bluff) => <div className="bluff-note" key={bluff}><span>Bluff</span><strong>{bluff}</strong></div>)}</div><section className="action-area">{isNight && me.roleDescription && <p className="ability-copy action-ability">{me.roleDescription}</p>}{canAct ? <><div className="action-heading"><span>{isNight ? 'Choose one player' : 'Vote to execute'}</span><small>{isNight ? 'Your choice is private' : 'Votes are private'}</small></div><div className="target-grid">{targets.map((player) => <button className={`target ${selected === player.id ? 'selected' : ''}`} key={player.id} onClick={() => choose(player.id)}><span className="avatar">{player.nickname.slice(0, 1)}</span><span>{player.nickname}{player.id === me.id ? ' (you)' : ''}</span><i>{selected === player.id ? '✓' : '○'}</i></button>)}</div></> : <div className="sleep-state"><span className="moon">☾</span><h3>{noNightChoice ? 'No night choice.' : me.alive ? 'Waiting.' : 'You are dead.'}</h3><p>{me.alive ? 'Waiting.' : 'You are still allowed to talk in the village.'}</p></div>}</section><div className="alive-strip">{state.room.players.map((player) => <span className={player.alive ? '' : 'is-dead'} key={player.id}>{player.nickname.slice(0, 1)}</span>)}</div>{state.room.hostId === socket.id && state.room.phase === 'day' && <button className="end-day" onClick={() => socket.emit('endDay', { code: roomCode })}>End day early</button>}<RoleGuide open={guideOpen} onClose={closeGuide} /></main>
}

function Header({ status, time, onGuide }: { status: string; time?: number; onGuide: () => void }) { return <header className="topbar"><div className="wordmark"><span className="brand-dot">D</span> DEMON DARK</div><div className="header-actions"><button className="guide-button" onClick={onGuide}>Characters</button><span className="status-pill">{status}</span>{time !== undefined && <strong className="big-timer">{Math.floor(time / 60)}:{String(time % 60).padStart(2, '0')}</strong>}</div></header> }
function PlayerRow({ player, index, isSelf, isHost }: { player: Player; index: number; isSelf: boolean; isHost: boolean }) { return <div className="player-row"><span className={`avatar avatar-${index % 4}`}>{player.nickname.slice(0, 1).toUpperCase()}</span><span>{player.nickname}{isSelf && <em> you</em>}</span>{isHost && <span className="host-tag">HOST</span>}</div> }
function RoleGuide({ open, onClose }: { open: boolean; onClose: () => void }) { if (!open) return null; return <div className="guide-backdrop" onClick={onClose}><section className="role-guide panel" onClick={(event) => event.stopPropagation()}><div className="guide-top"><div><p className="eyebrow">Characters</p><h2>Roles</h2></div><button className="close-guide" onClick={onClose}>×</button></div>{roleGroups.map((group) => <div className="role-group" key={group.title}><h3>{group.title}</h3>{group.roles.map(([role, ability]) => <div className="role-entry" key={role}><strong>{role}</strong><span>{ability}</span></div>)}</div>)}</section></div> }

export default App
