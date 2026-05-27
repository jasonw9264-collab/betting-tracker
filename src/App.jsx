import { useState, useEffect } from 'react'
import { db } from './firebase'
import {
  collection, onSnapshot, addDoc, updateDoc, doc,
  serverTimestamp, query, orderBy
} from 'firebase/firestore'
import './index.css'

// ── helpers ───────────────────────────────────────────────────────────────────

function lockedAmount(player, activeBets) {
  return activeBets.reduce((sum, bet) => {
    if (bet.player1Id === player.id) return sum + bet.stake * (bet.player2Odds - 1)
    if (bet.player2Id === player.id) return sum + bet.stake * (bet.player1Odds - 1)
    return sum
  }, 0)
}

function availableBalance(player, activeBets) {
  return player.balance - lockedAmount(player, activeBets)
}

function calcMaxStake(p1, p2, odds1, odds2, activeBets) {
  const avail1 = availableBalance(p1, activeBets)
  const avail2 = availableBalance(p2, activeBets)
  // p1 backs team1 (odds1): worst case p1 loses → pays stake × (odds2 - 1)
  // p2 backs team2 (odds2): worst case p2 loses → pays stake × (odds1 - 1)
  const maxForP1 = avail1 / (odds2 - 1)
  const maxForP2 = avail2 / (odds1 - 1)
  return Math.max(0, Math.min(maxForP1, maxForP2))
}

function fmt(n) {
  return `$${Number(n).toFixed(2)}`
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [players, setPlayers] = useState([])
  const [bets, setBets] = useState([])
  const [tab, setTab] = useState('leaderboard')

  useEffect(() => {
    const unsub1 = onSnapshot(collection(db, 'players'), snap =>
      setPlayers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    const unsub2 = onSnapshot(
      query(collection(db, 'bets'), orderBy('createdAt', 'desc')),
      snap => setBets(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    return () => { unsub1(); unsub2() }
  }, [])

  const activeBets = bets.filter(b => b.status === 'active')
  const settledBets = bets.filter(b => b.status === 'settled')

  const avail = (p) => availableBalance(p, activeBets)

  async function createBet(data) {
    await addDoc(collection(db, 'bets'), {
      ...data,
      status: 'active',
      createdAt: serverTimestamp()
    })
  }

  async function settleBet(bet, winnerId) {
    const winner = players.find(p => p.id === winnerId)
    const loserId = winnerId === bet.player1Id ? bet.player2Id : bet.player1Id
    const loser = players.find(p => p.id === loserId)
    const winnerOdds = winnerId === bet.player1Id ? bet.player1Odds : bet.player2Odds
    const payout = parseFloat((bet.stake * (winnerOdds - 1)).toFixed(2))

    await Promise.all([
      updateDoc(doc(db, 'players', winner.id), {
        balance: parseFloat((winner.balance + payout).toFixed(2)),
        wins: (winner.wins || 0) + 1
      }),
      updateDoc(doc(db, 'players', loser.id), {
        balance: parseFloat((loser.balance - payout).toFixed(2)),
        losses: (loser.losses || 0) + 1
      }),
      updateDoc(doc(db, 'bets', bet.id), {
        status: 'settled',
        winnerId,
        payout,
        settledAt: serverTimestamp()
      })
    ])
  }

  async function undoBet(bet) {
    const winner = players.find(p => p.id === bet.winnerId)
    const loserId = bet.winnerId === bet.player1Id ? bet.player2Id : bet.player1Id
    const loser = players.find(p => p.id === loserId)

    await Promise.all([
      updateDoc(doc(db, 'players', winner.id), {
        balance: parseFloat((winner.balance - bet.payout).toFixed(2)),
        wins: Math.max(0, (winner.wins || 1) - 1)
      }),
      updateDoc(doc(db, 'players', loser.id), {
        balance: parseFloat((loser.balance + bet.payout).toFixed(2)),
        losses: Math.max(0, (loser.losses || 1) - 1)
      }),
      updateDoc(doc(db, 'bets', bet.id), {
        status: 'active',
        winnerId: null,
        payout: null,
        settledAt: null
      })
    ])
  }

  async function addPlayer(name) {
    await addDoc(collection(db, 'players'), {
      name,
      balance: 50,
      wins: 0,
      losses: 0
    })
  }

  return (
    <div className="app">
      <header>
        <h1>Bet Tracker</h1>
      </header>
      <nav>
        {[
          ['leaderboard', 'Leaderboard'],
          ['bets', `Active (${activeBets.length})`],
          ['new', '+ New Bet'],
          ['history', 'History'],
          ['players', 'Players'],
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? 'active' : ''}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'leaderboard' && <Leaderboard players={players} avail={avail} />}
        {tab === 'bets' && <ActiveBets bets={activeBets} players={players} settleBet={settleBet} />}
        {tab === 'new' && <NewBet players={players} activeBets={activeBets} createBet={createBet} setTab={setTab} />}
        {tab === 'history' && <History bets={settledBets} players={players} undoBet={undoBet} />}
        {tab === 'players' && <Players players={players} addPlayer={addPlayer} />}
      </main>
    </div>
  )
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

function Leaderboard({ players, avail }) {
  const sorted = [...players].sort((a, b) => b.balance - a.balance)
  return (
    <section className="leaderboard">
      <h2>Leaderboard</h2>
      {sorted.length === 0 && (
        <p className="empty">No players yet. Add some in the Players tab.</p>
      )}
      {sorted.map((p, i) => (
        <div key={p.id} className="player-card">
          <span className="rank">#{i + 1}</span>
          <span className="name">{p.name}</span>
          <div className="stats">
            <span className={`balance ${p.balance >= 50 ? 'up' : 'down'}`}>
              {fmt(p.balance)}
            </span>
            <span className="record">{p.wins || 0}W / {p.losses || 0}L</span>
            <span className="avail">available: {fmt(avail(p))}</span>
          </div>
        </div>
      ))}
    </section>
  )
}

// ── Active Bets ───────────────────────────────────────────────────────────────

function ActiveBets({ bets, players, settleBet }) {
  const name = (id) => players.find(p => p.id === id)?.name ?? '?'
  const [confirming, setConfirming] = useState(null)

  function handleSettle(bet, winnerId) {
    const key = `${bet.id}-${winnerId}`
    if (confirming === key) {
      settleBet(bet, winnerId)
      setConfirming(null)
    } else {
      setConfirming(key)
    }
  }

  return (
    <section>
      <h2>Active Bets</h2>
      {bets.length === 0 && <p className="empty">No active bets.</p>}
      {bets.map(bet => (
        <div key={bet.id} className="bet-card">
          <div className="bet-header">
            <span>
              <strong>{bet.team1}</strong> ({bet.player1Odds}) — {name(bet.player1Id)}
            </span>
            <span className="vs">vs</span>
            <span>
              <strong>{bet.team2}</strong> ({bet.player2Odds}) — {name(bet.player2Id)}
            </span>
          </div>
          <div className="bet-info">
            Stake: {fmt(bet.stake)}
            &nbsp;·&nbsp;
            {bet.team1} wins → {name(bet.player1Id)} gets {fmt(bet.stake * (bet.player1Odds - 1))}
            &nbsp;·&nbsp;
            {bet.team2} wins → {name(bet.player2Id)} gets {fmt(bet.stake * (bet.player2Odds - 1))}
          </div>
          <div className="bet-actions">
            <span className="settle-label">Settle:</span>
            <button
              className={`win-btn ${confirming === `${bet.id}-${bet.player1Id}` ? 'confirming' : ''}`}
              onClick={() => handleSettle(bet, bet.player1Id)}
            >
              {confirming === `${bet.id}-${bet.player1Id}` ? 'Confirm?' : `${bet.team1} won`}
            </button>
            <button
              className={`win-btn ${confirming === `${bet.id}-${bet.player2Id}` ? 'confirming' : ''}`}
              onClick={() => handleSettle(bet, bet.player2Id)}
            >
              {confirming === `${bet.id}-${bet.player2Id}` ? 'Confirm?' : `${bet.team2} won`}
            </button>
          </div>
        </div>
      ))}
    </section>
  )
}

// ── New Bet ───────────────────────────────────────────────────────────────────

function NewBet({ players, activeBets, createBet, setTab }) {
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [team1, setTeam1] = useState('')
  const [team2, setTeam2] = useState('')
  const [odds1, setOdds1] = useState('')
  const [odds2, setOdds2] = useState('')
  const [stake, setStake] = useState('')
  const [error, setError] = useState('')

  const player1 = players.find(p => p.id === p1)
  const player2 = players.find(p => p.id === p2)
  const o1 = parseFloat(odds1)
  const o2 = parseFloat(odds2)
  const s = parseFloat(stake)

  const showMax = player1 && player2 && p1 !== p2 && o1 > 1 && o2 > 1
  const max = showMax ? calcMaxStake(player1, player2, o1, o2, activeBets) : null

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (p1 === p2) return setError('Pick two different players.')
    if (isNaN(o1) || o1 <= 1) return setError('Odds must be greater than 1.')
    if (isNaN(o2) || o2 <= 1) return setError('Odds must be greater than 1.')
    if (isNaN(s) || s <= 0) return setError('Stake must be a positive number.')
    if (max !== null && s > max + 0.001) return setError(`Max stake is ${fmt(max)}.`)
    await createBet({
      player1Id: p1,
      player2Id: p2,
      team1,
      team2,
      player1Odds: o1,
      player2Odds: o2,
      stake: s
    })
    setTab('bets')
  }

  return (
    <section>
      <h2>New Bet</h2>
      <form className="bet-form" onSubmit={handleSubmit}>
        <div className="form-row">
          <div className="form-group">
            <label>Player 1</label>
            <select value={p1} onChange={e => setP1(e.target.value)} required>
              <option value="">Select player</option>
              {players.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Their Team</label>
            <input
              value={team1}
              onChange={e => setTeam1(e.target.value)}
              placeholder="e.g. LEV"
              required
            />
          </div>
          <div className="form-group">
            <label>Odds</label>
            <input
              type="number"
              step="0.01"
              min="1.01"
              value={odds1}
              onChange={e => setOdds1(e.target.value)}
              placeholder="e.g. 1.30"
              required
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Player 2</label>
            <select value={p2} onChange={e => setP2(e.target.value)} required>
              <option value="">Select player</option>
              {players.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Their Team</label>
            <input
              value={team2}
              onChange={e => setTeam2(e.target.value)}
              placeholder="e.g. GE"
              required
            />
          </div>
          <div className="form-group">
            <label>Odds</label>
            <input
              type="number"
              step="0.01"
              min="1.01"
              value={odds2}
              onChange={e => setOdds2(e.target.value)}
              placeholder="e.g. 1.80"
              required
            />
          </div>
        </div>

        {max !== null && (
          <div className={`max-stake-info ${max <= 0 ? 'no-funds' : ''}`}>
            {max <= 0
              ? 'One or both players have no available funds for this bet.'
              : <>Max stake: <strong>{fmt(max)}</strong></>
            }
          </div>
        )}

        <div className="form-group stake-group">
          <label>Stake ($)</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={stake}
            onChange={e => setStake(e.target.value)}
            placeholder="0.00"
            required
          />
        </div>

        {error && <p className="error">{error}</p>}
        <button type="submit" className="submit-btn" disabled={max !== null && max <= 0}>
          Place Bet
        </button>
      </form>
    </section>
  )
}

// ── History ───────────────────────────────────────────────────────────────────

function History({ bets, players, undoBet }) {
  const name = (id) => players.find(p => p.id === id)?.name ?? '?'
  const [confirming, setConfirming] = useState(null)

  function handleUndo(bet) {
    if (confirming === bet.id) {
      undoBet(bet)
      setConfirming(null)
    } else {
      setConfirming(bet.id)
    }
  }

  return (
    <section>
      <h2>Bet History</h2>
      {bets.length === 0 && <p className="empty">No settled bets yet.</p>}
      {bets.map(bet => {
        const winnerName = name(bet.winnerId)
        const winnerTeam = bet.winnerId === bet.player1Id ? bet.team1 : bet.team2
        return (
          <div key={bet.id} className="bet-card settled">
            <div className="bet-header">
              <span>{bet.team1} ({bet.player1Odds}) — {name(bet.player1Id)}</span>
              <span className="vs">vs</span>
              <span>{bet.team2} ({bet.player2Odds}) — {name(bet.player2Id)}</span>
            </div>
            <div className="bet-info">
              Stake: {fmt(bet.stake)}
              &nbsp;·&nbsp;
              <span className="winner">
                {winnerName} ({winnerTeam}) won {fmt(bet.payout)}
              </span>
            </div>
            <div className="bet-actions">
              <button
                className={`undo-btn ${confirming === bet.id ? 'confirming' : ''}`}
                onClick={() => handleUndo(bet)}
              >
                {confirming === bet.id ? 'Confirm undo?' : 'Undo'}
              </button>
            </div>
          </div>
        )
      })}
    </section>
  )
}

// ── Players ───────────────────────────────────────────────────────────────────

function Players({ players, addPlayer }) {
  const [name, setName] = useState('')

  async function handleAdd(e) {
    e.preventDefault()
    if (!name.trim()) return
    await addPlayer(name.trim())
    setName('')
  }

  return (
    <section>
      <h2>Players</h2>
      <form className="add-player-form" onSubmit={handleAdd}>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Player name"
          required
        />
        <button type="submit">Add Player</button>
      </form>
      {players.length === 0 && <p className="empty">No players yet.</p>}
      {players.map(p => (
        <div key={p.id} className="player-row">
          <span className="name">{p.name}</span>
          <span className={p.balance >= 50 ? 'up' : 'down'}>{fmt(p.balance)}</span>
        </div>
      ))}
    </section>
  )
}
