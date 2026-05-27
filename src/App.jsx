import { useState, useEffect, useRef } from 'react'
import { db } from './firebase'
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, query, orderBy
} from 'firebase/firestore'
import './index.css'

// ── crypto ────────────────────────────────────────────────────────────────────

async function hashPassword(password) {
  const data = new TextEncoder().encode(password + ':vbt-salt-2024')
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

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
  return Math.max(0, Math.min(avail1 / (odds2 - 1), avail2 / (odds1 - 1)))
}

function fmt(n) {
  return `$${Number(n).toFixed(2)}`
}

function today() {
  return new Date().toISOString().split('T')[0]
}

const ADMIN_PASSWORD = '888'

// ── Auth Screen ───────────────────────────────────────────────────────────────

function AuthScreen({ players, onLogin }) {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const player = players.find(p => p.username?.toLowerCase() === username.trim().toLowerCase())
    if (!player) { setError('Username not found.'); setLoading(false); return }
    const hash = await hashPassword(password)
    if (hash !== player.passwordHash) { setError('Incorrect password.'); setLoading(false); return }
    onLogin(player.id, player.username)
    setLoading(false)
  }

  async function handleRegister(e) {
    e.preventDefault()
    setError('')
    const trimmed = username.trim()
    if (!trimmed) return setError('Username cannot be empty.')
    if (password.length < 3) return setError('Password must be at least 3 characters.')
    if (password !== confirmPassword) return setError('Passwords do not match.')
    if (players.find(p => p.username?.toLowerCase() === trimmed.toLowerCase())) return setError('Username already taken.')
    setLoading(true)
    const hash = await hashPassword(password)
    const ref = await addDoc(collection(db, 'players'), {
      username: trimmed, passwordHash: hash,
      balance: 50, wins: 0, losses: 0, createdAt: serverTimestamp()
    })
    onLogin(ref.id, trimmed)
    setLoading(false)
  }

  return (
    <div className="auth-screen">
      <div className="auth-tabs">
        <button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError('') }}>Sign In</button>
        <button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError('') }}>Create Account</button>
      </div>
      {mode === 'login' ? (
        <form className="auth-form" onSubmit={handleLogin}>
          <div className="form-group">
            <label>Username</label>
            <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Your username" autoFocus required />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password" required />
          </div>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="submit-btn" disabled={loading}>{loading ? 'Signing in...' : 'Sign In'}</button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={handleRegister}>
          <div className="form-group">
            <label>Choose a Username</label>
            <input value={username} onChange={e => setUsername(e.target.value)} placeholder="e.g. jason" autoFocus required />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 3 characters" required />
          </div>
          <div className="form-group">
            <label>Confirm Password</label>
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Repeat password" required />
          </div>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="submit-btn" disabled={loading}>{loading ? 'Creating...' : 'Create Account'}</button>
        </form>
      )}
    </div>
  )
}

// ── Gear Menu ─────────────────────────────────────────────────────────────────

function GearMenu({ onNavigate, isAdmin }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function go(tab) {
    onNavigate(tab)
    setOpen(false)
  }

  return (
    <div className="gear-wrapper" ref={ref}>
      <button className="gear-btn" onClick={() => setOpen(o => !o)} aria-label="Settings">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        {isAdmin && <span className="admin-dot" />}
      </button>
      {open && (
        <div className="gear-dropdown">
          <button onClick={() => go('profile')}>My Profile</button>
          <button onClick={() => go('admin')}>
            Admin {isAdmin && <span className="admin-badge">Unlocked</span>}
          </button>
        </div>
      )}
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [players, setPlayers] = useState([])
  const [bets, setBets] = useState([])
  const [games, setGames] = useState([])
  const [listings, setListings] = useState([])
  const [tab, setTab] = useState('market')
  const [isAdmin, setIsAdmin] = useState(false)
  const [session, setSession] = useState(() => {
    try { return JSON.parse(localStorage.getItem('session')) || null }
    catch { return null }
  })

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'players'), snap =>
      setPlayers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    const u2 = onSnapshot(
      query(collection(db, 'bets'), orderBy('createdAt', 'desc')),
      snap => setBets(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    const u3 = onSnapshot(
      query(collection(db, 'games'), orderBy('createdAt', 'desc')),
      snap => setGames(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    const u4 = onSnapshot(
      query(collection(db, 'listings'), orderBy('createdAt', 'desc')),
      snap => setListings(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    return () => { u1(); u2(); u3(); u4() }
  }, [])

  function login(playerId, username) {
    const s = { playerId, username }
    setSession(s)
    localStorage.setItem('session', JSON.stringify(s))
    setTab('market')
  }

  function logout() {
    setSession(null)
    setIsAdmin(false)
    localStorage.removeItem('session')
  }

  if (!session) {
    return (
      <div className="app">
        <header><h1>Bet Tracker</h1></header>
        <AuthScreen players={players} onLogin={login} />
      </div>
    )
  }

  const currentPlayer = players.find(p => p.id === session.playerId) || null
  const activeBets = bets.filter(b => b.status === 'active')
  const settledBets = bets.filter(b => b.status === 'settled')
  const openListings = listings.filter(l => l.status === 'open')
  const avail = (p) => availableBalance(p, activeBets)

  // Games
  async function addGame(team1, odds1, team2, odds2, matchDate) {
    await addDoc(collection(db, 'games'), {
      team1, odds1: parseFloat(odds1), team2, odds2: parseFloat(odds2),
      matchDate, createdAt: serverTimestamp()
    })
  }

  async function removeGame(id) { await deleteDoc(doc(db, 'games', id)) }

  async function updateGame(id, fields) {
    await updateDoc(doc(db, 'games', id), {
      ...fields,
      odds1: parseFloat(fields.odds1),
      odds2: parseFloat(fields.odds2),
    })
  }
  async function removePlayer(id) { await deleteDoc(doc(db, 'players', id)) }

  // Listings
  async function publishListing({ gameId, team1, team2, odds1, odds2, publisherSide, stake }) {
    await addDoc(collection(db, 'listings'), {
      publisherId: session.playerId,
      gameId, team1, team2, odds1, odds2, publisherSide,
      stake: stake ? parseFloat(stake) : null,
      status: 'open', createdAt: serverTimestamp()
    })
  }

  async function cancelListing(id) {
    await updateDoc(doc(db, 'listings', id), { status: 'cancelled' })
  }

  async function editListingStake(id, stake) {
    await updateDoc(doc(db, 'listings', id), { stake: stake ? parseFloat(stake) : null })
  }

  async function takeListing(listing, takerStake) {
    const takerId = session.playerId
    const finalStake = listing.stake ?? parseFloat(takerStake)
    const player1Id = listing.publisherSide === 1 ? listing.publisherId : takerId
    const player2Id = listing.publisherSide === 1 ? takerId : listing.publisherId
    await Promise.all([
      addDoc(collection(db, 'bets'), {
        player1Id, player2Id,
        team1: listing.team1, team2: listing.team2,
        player1Odds: listing.odds1, player2Odds: listing.odds2,
        stake: finalStake, status: 'active',
        listingId: listing.id, createdAt: serverTimestamp()
      }),
      updateDoc(doc(db, 'listings', listing.id), { status: 'taken', takerId })
    ])
  }

  // Bets
  async function cancelBet(bet) {
    await updateDoc(doc(db, 'bets', bet.id), { status: 'cancelled' })
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
        status: 'settled', winnerId, payout, settledAt: serverTimestamp()
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
        status: 'active', winnerId: null, payout: null, settledAt: null
      })
    ])
  }

  async function updateUsername(newUsername) {
    await updateDoc(doc(db, 'players', session.playerId), { username: newUsername })
    const s = { ...session, username: newUsername }
    setSession(s)
    localStorage.setItem('session', JSON.stringify(s))
  }

  async function updatePassword(newPassword) {
    const hash = await hashPassword(newPassword)
    await updateDoc(doc(db, 'players', session.playerId), { passwordHash: hash })
  }

  return (
    <div className="app">
      <header>
        <h1>Bet Tracker</h1>
        <div className="header-right">
          <div className="header-info">
            <span className="header-username">{session.username}</span>
            {currentPlayer && (
              <span className="header-balance">{fmt(avail(currentPlayer))} available</span>
            )}
          </div>
          <button className="signout-btn" onClick={logout}>Sign Out</button>
          <GearMenu onNavigate={setTab} isAdmin={isAdmin} />
        </div>
      </header>

      <nav className="nav-primary">
        {[
          ['market', `Market (${openListings.length})`],
          ['new', '+ New Bet'],
          ['bets', `Active (${activeBets.length})`],
        ].map(([key, label]) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>
      <nav className="nav-secondary">
        {[
          ['leaderboard', 'Leaderboard'],
          ['history', 'History'],
        ].map(([key, label]) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'market' && (
          <Market
            listings={openListings} players={players}
            currentPlayer={currentPlayer} activeBets={activeBets}
            takeListing={takeListing} cancelListing={cancelListing}
            editListingStake={editListingStake} sessionId={session.playerId}
          />
        )}
        {tab === 'new' && (
          <NewBet
            games={games} currentPlayer={currentPlayer}
            activeBets={activeBets} publishListing={publishListing} setTab={setTab}
          />
        )}
        {tab === 'bets' && (
          <ActiveBets
            bets={activeBets} players={players}
            settleBet={settleBet} cancelBet={cancelBet} isAdmin={isAdmin}
          />
        )}
        {tab === 'leaderboard' && <Leaderboard players={players} avail={avail} />}
        {tab === 'history' && <History bets={settledBets} players={players} undoBet={undoBet} isAdmin={isAdmin} />}
        {tab === 'profile' && (
          <Profile
            currentPlayer={currentPlayer} session={session} players={players}
            updateUsername={updateUsername} updatePassword={updatePassword}
          />
        )}
        {tab === 'admin' && (
          <Admin
            games={games} players={players} bets={activeBets}
            addGame={addGame} removeGame={removeGame} updateGame={updateGame} removePlayer={removePlayer}
            settleBet={settleBet} isAdmin={isAdmin} setIsAdmin={setIsAdmin}
          />
        )}
      </main>
    </div>
  )
}

// ── Market ────────────────────────────────────────────────────────────────────

function Market({ listings, players, currentPlayer, activeBets, takeListing, cancelListing, editListingStake, sessionId }) {
  const name = (id) => players.find(p => p.id === id)?.username ?? '?'
  const [takerStakes, setTakerStakes] = useState({})
  const [editingStake, setEditingStake] = useState(null)
  const [editStakeVal, setEditStakeVal] = useState('')
  const [confirming, setConfirming] = useState(null)
  const [stakeErrors, setStakeErrors] = useState({})

  function getMax(listing) {
    if (!currentPlayer) return null
    const publisher = players.find(p => p.id === listing.publisherId)
    if (!publisher) return null
    return listing.publisherSide === 1
      ? calcMaxStake(publisher, currentPlayer, listing.odds1, listing.odds2, activeBets)
      : calcMaxStake(currentPlayer, publisher, listing.odds1, listing.odds2, activeBets)
  }

  function handleStakeChange(listingId, val, max) {
    setTakerStakes(s => ({ ...s, [listingId]: val }))
    const s = parseFloat(val)
    if (max !== null && s > max + 0.001) {
      setStakeErrors(e => ({ ...e, [listingId]: `Max stake is ${fmt(max)} based on available funds` }))
    } else {
      setStakeErrors(e => ({ ...e, [listingId]: null }))
    }
  }

  if (!currentPlayer) return <section><h2>Market</h2><p className="empty">Loading...</p></section>

  return (
    <section>
      <h2>Market</h2>
      {listings.length === 0 && <p className="empty">No open bets. Go to + New Bet to post one.</p>}
      {listings.map(listing => {
        const isOwn = listing.publisherId === sessionId
        const publisherTeam = listing.publisherSide === 1 ? listing.team1 : listing.team2
        const takerTeam = listing.publisherSide === 1 ? listing.team2 : listing.team1
        const publisherOdds = listing.publisherSide === 1 ? listing.odds1 : listing.odds2
        const takerOdds = listing.publisherSide === 1 ? listing.odds2 : listing.odds1
        const max = isOwn ? null : getMax(listing)
        const takerStake = takerStakes[listing.id] || ''
        const displayStake = listing.stake ?? parseFloat(takerStake)
        const stakeError = stakeErrors[listing.id]

        return (
          <div key={listing.id} className={`bet-card ${isOwn ? 'own-listing' : ''}`}>
            <div className="listing-badge">{isOwn ? 'Your listing' : `${name(listing.publisherId)}'s bet`}</div>
            <div className="bet-header">
              <span><strong>{publisherTeam}</strong><span className="odds-tag">{publisherOdds}</span>{name(listing.publisherId)}</span>
              <span className="vs">vs</span>
              <span><strong>{takerTeam}</strong><span className="odds-tag">{takerOdds}</span>{isOwn ? '(open)' : currentPlayer.username}</span>
            </div>

            {displayStake > 0 && (
              <div className="bet-info">
                Stake: {fmt(displayStake)}
                &nbsp;·&nbsp;{publisherTeam} wins → {name(listing.publisherId)} +{fmt(displayStake * (publisherOdds - 1))}
                &nbsp;·&nbsp;{takerTeam} wins → {isOwn ? 'taker' : currentPlayer.username} +{fmt(displayStake * (takerOdds - 1))}
              </div>
            )}

            {isOwn ? (
              <div className="bet-actions">
                {editingStake === listing.id ? (
                  <>
                    <input className="inline-input" type="number" step="0.01" min="0" placeholder="Stake ($)"
                      value={editStakeVal} onChange={e => setEditStakeVal(e.target.value)} />
                    <button className="edit-save-btn" onClick={async () => { await editListingStake(listing.id, editStakeVal); setEditingStake(null) }}>Save</button>
                    <button className="edit-btn" onClick={() => setEditingStake(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <span className="settle-label">Stake: {listing.stake ? fmt(listing.stake) : 'open'}</span>
                    <button className="edit-btn" onClick={() => { setEditingStake(listing.id); setEditStakeVal(listing.stake || '') }}>Edit Stake</button>
                    <button
                      className={`undo-btn ${confirming === listing.id ? 'confirming' : ''}`}
                      onClick={() => { if (confirming === listing.id) { cancelListing(listing.id); setConfirming(null) } else setConfirming(listing.id) }}
                    >
                      {confirming === listing.id ? 'Confirm cancel?' : 'Cancel Bet'}
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="take-section">
                {!listing.stake && (
                  <div className="form-group">
                    <input className="inline-input" type="number" step="0.01" min="0.01"
                      placeholder={max !== null && max > 0 ? `Enter stake (max ${fmt(max)})` : 'Stake ($)'}
                      value={takerStake}
                      onChange={e => handleStakeChange(listing.id, e.target.value, max)}
                    />
                    {stakeError && <p className="stake-error">{stakeError}</p>}
                  </div>
                )}
                {max !== null && max <= 0
                  ? <p className="stake-error">You don't have enough available funds for this bet.</p>
                  : <button className="win-btn"
                      disabled={!!stakeError || (!listing.stake && (!takerStake || parseFloat(takerStake) <= 0))}
                      onClick={() => takeListing(listing, takerStake)}>
                      Take this bet
                    </button>
                }
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}

// ── New Bet ───────────────────────────────────────────────────────────────────

function NewBet({ games, currentPlayer, activeBets, publishListing, setTab }) {
  const [gameId, setGameId] = useState('')
  const [side, setSide] = useState('')
  const [stake, setStake] = useState('')
  const [stakeError, setStakeError] = useState('')

  const upcomingGames = games.filter(g => !g.matchDate || g.matchDate >= today())
  const game = upcomingGames.find(g => g.id === gameId)
  const myOdds = game ? (side === '1' ? game.odds1 : game.odds2) : null
  const myTeam = game ? (side === '1' ? game.team1 : game.team2) : null
  const theirOdds = game ? (side === '1' ? game.odds2 : game.odds1) : null
  const theirTeam = game ? (side === '1' ? game.team2 : game.team1) : null
  const s = parseFloat(stake)

  function handleStakeChange(val) {
    setStake(val)
    setStakeError('')
    const sv = parseFloat(val)
    if (!currentPlayer || !sv || sv <= 0) return
    const availBal = availableBalance(currentPlayer, activeBets)
    if (myOdds && theirOdds) {
      const maxForMe = availBal / (theirOdds - 1)
      if (sv > maxForMe + 0.001) {
        setStakeError(`You can't bet more than ${fmt(maxForMe)} — your available balance of ${fmt(availBal)} can't cover a loss if ${theirTeam} wins.`)
      }
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!currentPlayer || !game || !side || stakeError) return
    await publishListing({
      gameId, team1: game.team1, team2: game.team2,
      odds1: game.odds1, odds2: game.odds2,
      publisherSide: parseInt(side),
      stake: s > 0 ? s : null
    })
    setGameId(''); setSide(''); setStake(''); setStakeError('')
    setTab('market')
  }

  if (!currentPlayer) return <section><h2>+ New Bet</h2><p className="empty">Loading...</p></section>
  if (upcomingGames.length === 0) return <section><h2>+ New Bet</h2><p className="empty">No upcoming games. Ask the admin to add some.</p></section>

  return (
    <section>
      <h2>+ New Bet</h2>
      <form className="bet-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Select Game</label>
          <select value={gameId} onChange={e => { setGameId(e.target.value); setSide(''); setStake(''); setStakeError('') }} required>
            <option value="">Choose a game...</option>
            {upcomingGames.map(g => (
              <option key={g.id} value={g.id}>
                {g.team1} ({g.odds1}) vs {g.team2} ({g.odds2}){g.matchDate ? ` — ${g.matchDate}` : ''}
              </option>
            ))}
          </select>
        </div>

        {game && (
          <div className="form-group">
            <label>I'm backing</label>
            <div className="side-picker">
              <button type="button" className={`side-btn ${side === '1' ? 'selected' : ''}`} onClick={() => { setSide('1'); setStake(''); setStakeError('') }}>
                {game.team1}<span className="odds-tag">{game.odds1}</span>
              </button>
              <button type="button" className={`side-btn ${side === '2' ? 'selected' : ''}`} onClick={() => { setSide('2'); setStake(''); setStakeError('') }}>
                {game.team2}<span className="odds-tag">{game.odds2}</span>
              </button>
            </div>
          </div>
        )}

        {side && game && (
          <>
            <div className="form-group stake-group">
              <label>Stake — optional, leave blank to decide when someone takes it</label>
              <input type="number" step="0.01" min="0.01" value={stake}
                onChange={e => handleStakeChange(e.target.value)} placeholder="$0.00" />
              {stakeError && <p className="stake-error">{stakeError}</p>}
            </div>

            {s > 0 && !stakeError && myOdds && theirOdds && (
              <div className="payout-preview">
                <div className="payout-row win">
                  <span>{myTeam} wins</span>
                  <span>You get <strong>+{fmt(s * (myOdds - 1))}</strong></span>
                </div>
                <div className="payout-row lose">
                  <span>{theirTeam} wins</span>
                  <span>You pay <strong>-{fmt(s * (theirOdds - 1))}</strong></span>
                </div>
              </div>
            )}

            <button type="submit" className="submit-btn" disabled={!!stakeError}>
              Publish to Market
            </button>
          </>
        )}
      </form>
    </section>
  )
}

// ── Active Bets ───────────────────────────────────────────────────────────────

function ActiveBets({ bets, players, settleBet, cancelBet, isAdmin }) {
  const name = (id) => players.find(p => p.id === id)?.username ?? '?'
  const [confirming, setConfirming] = useState(null)
  const [cancelling, setCancelling] = useState(null)

  function handleSettle(bet, winnerId) {
    const key = `${bet.id}-${winnerId}`
    if (confirming === key) { settleBet(bet, winnerId); setConfirming(null) }
    else setConfirming(key)
  }

  function handleCancel(bet) {
    if (cancelling === bet.id) { cancelBet(bet); setCancelling(null) }
    else setCancelling(bet.id)
  }

  return (
    <section>
      <h2>Active Bets</h2>
      {!isAdmin && bets.length > 0 && (
        <p className="admin-note">Results are settled by the admin once games finish.</p>
      )}
      {bets.length === 0 && <p className="empty">No active bets.</p>}
      {bets.map(bet => (
        <div key={bet.id} className="bet-card">
          <div className="bet-header">
            <span><strong>{bet.team1}</strong><span className="odds-tag">{bet.player1Odds}</span>{name(bet.player1Id)}</span>
            <span className="vs">vs</span>
            <span><strong>{bet.team2}</strong><span className="odds-tag">{bet.player2Odds}</span>{name(bet.player2Id)}</span>
          </div>
          <div className="bet-info">
            Stake: {fmt(bet.stake)}
            &nbsp;·&nbsp;{bet.team1} wins → {name(bet.player1Id)} +{fmt(bet.stake * (bet.player1Odds - 1))}
            &nbsp;·&nbsp;{bet.team2} wins → {name(bet.player2Id)} +{fmt(bet.stake * (bet.player2Odds - 1))}
          </div>
          {isAdmin && (
            <div className="bet-actions">
              <span className="settle-label">Settle:</span>
              <button className={`win-btn ${confirming === `${bet.id}-${bet.player1Id}` ? 'confirming' : ''}`}
                onClick={() => handleSettle(bet, bet.player1Id)}>
                {confirming === `${bet.id}-${bet.player1Id}` ? 'Confirm?' : `${bet.team1} won`}
              </button>
              <button className={`win-btn ${confirming === `${bet.id}-${bet.player2Id}` ? 'confirming' : ''}`}
                onClick={() => handleSettle(bet, bet.player2Id)}>
                {confirming === `${bet.id}-${bet.player2Id}` ? 'Confirm?' : `${bet.team2} won`}
              </button>
              <button className={`undo-btn ${cancelling === bet.id ? 'confirming' : ''}`}
                onClick={() => handleCancel(bet)}>
                {cancelling === bet.id ? 'Confirm remove?' : 'Remove'}
              </button>
            </div>
          )}
        </div>
      ))}
    </section>
  )
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

function Leaderboard({ players, avail }) {
  const sorted = [...players].sort((a, b) => b.balance - a.balance)
  return (
    <section className="leaderboard">
      <h2>Leaderboard</h2>
      {sorted.length === 0 && <p className="empty">No players yet.</p>}
      {sorted.map((p, i) => (
        <div key={p.id} className="player-card">
          <span className="rank">#{i + 1}</span>
          <span className="name">{p.username}</span>
          <div className="stats">
            <span className={`balance ${p.balance >= 50 ? 'up' : 'down'}`}>{fmt(p.balance)}</span>
            <span className="record">{p.wins || 0}W / {p.losses || 0}L</span>
            <span className="avail">available: {fmt(avail(p))}</span>
          </div>
        </div>
      ))}
    </section>
  )
}

// ── History ───────────────────────────────────────────────────────────────────

function History({ bets, players, undoBet, isAdmin }) {
  const name = (id) => players.find(p => p.id === id)?.username ?? '?'
  const [confirming, setConfirming] = useState(null)

  function handleUndo(bet) {
    if (confirming === bet.id) { undoBet(bet); setConfirming(null) }
    else setConfirming(bet.id)
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
              Stake: {fmt(bet.stake)} &nbsp;·&nbsp;
              <span className="winner">{winnerName} ({winnerTeam}) won {fmt(bet.payout)}</span>
            </div>
            {isAdmin && (
              <div className="bet-actions">
                <button className={`undo-btn ${confirming === bet.id ? 'confirming' : ''}`} onClick={() => handleUndo(bet)}>
                  {confirming === bet.id ? 'Confirm undo?' : 'Undo'}
                </button>
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}

// ── Profile ───────────────────────────────────────────────────────────────────

function Profile({ currentPlayer, session, updateUsername, updatePassword, players }) {
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [usernameMsg, setUsernameMsg] = useState('')
  const [passwordMsg, setPasswordMsg] = useState('')

  async function handleUsernameChange(e) {
    e.preventDefault()
    setUsernameMsg('')
    const trimmed = newUsername.trim()
    if (!trimmed) return
    if (players.find(p => p.username?.toLowerCase() === trimmed.toLowerCase() && p.id !== session.playerId))
      return setUsernameMsg('Username already taken.')
    await updateUsername(trimmed)
    setNewUsername('')
    setUsernameMsg('Username updated!')
  }

  async function handlePasswordChange(e) {
    e.preventDefault()
    setPasswordMsg('')
    if (newPassword.length < 3) return setPasswordMsg('Password must be at least 3 characters.')
    if (newPassword !== confirmPassword) return setPasswordMsg('Passwords do not match.')
    await updatePassword(newPassword)
    setNewPassword(''); setConfirmPassword('')
    setPasswordMsg('Password updated!')
  }

  return (
    <section>
      <h2>My Profile</h2>
      {currentPlayer && (
        <div className="profile-stats">
          <div className="profile-stat">
            <span className="profile-stat-label">Balance</span>
            <span className={currentPlayer.balance >= 50 ? 'up' : 'down'}>{fmt(currentPlayer.balance)}</span>
          </div>
          <div className="profile-stat">
            <span className="profile-stat-label">Record</span>
            <span>{currentPlayer.wins || 0}W / {currentPlayer.losses || 0}L</span>
          </div>
        </div>
      )}
      <div className="profile-section">
        <h3>Change Username</h3>
        <form className="bet-form" onSubmit={handleUsernameChange}>
          <div className="form-group">
            <label>New Username</label>
            <input value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder={session.username} required />
          </div>
          {usernameMsg && <p className={usernameMsg.includes('!') ? 'success-msg' : 'error'}>{usernameMsg}</p>}
          <button type="submit" className="submit-btn">Update Username</button>
        </form>
      </div>
      <div className="profile-section">
        <h3>Change Password</h3>
        <form className="bet-form" onSubmit={handlePasswordChange}>
          <div className="form-group">
            <label>New Password</label>
            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Min 3 characters" required />
          </div>
          <div className="form-group">
            <label>Confirm Password</label>
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Repeat password" required />
          </div>
          {passwordMsg && <p className={passwordMsg.includes('!') ? 'success-msg' : 'error'}>{passwordMsg}</p>}
          <button type="submit" className="submit-btn">Update Password</button>
        </form>
      </div>
    </section>
  )
}

// ── Admin ─────────────────────────────────────────────────────────────────────

function Admin({ games, players, bets, addGame, removeGame, updateGame, removePlayer, settleBet, isAdmin, setIsAdmin }) {
  const [pw, setPw] = useState('')
  const [pwError, setPwError] = useState(false)
  const [team1, setTeam1] = useState('')
  const [odds1, setOdds1] = useState('')
  const [team2, setTeam2] = useState('')
  const [odds2, setOdds2] = useState('')
  const [matchDate, setMatchDate] = useState('')
  const [confirmGame, setConfirmGame] = useState(null)
  const [confirmPlayer, setConfirmPlayer] = useState(null)
  const [editingGame, setEditingGame] = useState(null)
  const [editFields, setEditFields] = useState({})

  function handleLogin(e) {
    e.preventDefault()
    if (pw === ADMIN_PASSWORD) { setIsAdmin(true); setPwError(false) }
    else setPwError(true)
  }

  async function handleAddGame(e) {
    e.preventDefault()
    await addGame(team1.trim(), odds1, team2.trim(), odds2, matchDate)
    setTeam1(''); setOdds1(''); setTeam2(''); setOdds2(''); setMatchDate('')
  }

  function startEditGame(g) {
    setEditingGame(g.id)
    setEditFields({ team1: g.team1, odds1: g.odds1, team2: g.team2, odds2: g.odds2, matchDate: g.matchDate || '' })
  }

  async function saveEditGame(id) {
    await updateGame(id, editFields)
    setEditingGame(null)
  }

  const upcomingGames = games.filter(g => !g.matchDate || g.matchDate >= today())
  const pastGames = games.filter(g => g.matchDate && g.matchDate < today())

  if (!isAdmin) {
    return (
      <section>
        <h2>Admin</h2>
        <form className="pw-form" onSubmit={handleLogin}>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="Enter password" autoFocus />
          <button type="submit">Unlock</button>
        </form>
        {pwError && <p className="error" style={{ marginTop: 12 }}>Incorrect password.</p>}
      </section>
    )
  }

  return (
    <section>
      <div className="admin-unlocked-badge">Admin Unlocked</div>

      <h2>Add Game</h2>
      <form className="bet-form" onSubmit={handleAddGame}>
        <div className="form-row">
          <div className="form-group">
            <label>Team 1</label>
            <input value={team1} onChange={e => setTeam1(e.target.value)} placeholder="e.g. LEV" required />
          </div>
          <div className="form-group">
            <label>Odds</label>
            <input type="number" step="0.01" min="1.01" value={odds1} onChange={e => setOdds1(e.target.value)} placeholder="1.30" required />
          </div>
          <div className="form-group">
            <label>Team 2</label>
            <input value={team2} onChange={e => setTeam2(e.target.value)} placeholder="e.g. GE" required />
          </div>
          <div className="form-group">
            <label>Odds</label>
            <input type="number" step="0.01" min="1.01" value={odds2} onChange={e => setOdds2(e.target.value)} placeholder="1.80" required />
          </div>
          <div className="form-group">
            <label>Match Date</label>
            <input type="date" value={matchDate} onChange={e => setMatchDate(e.target.value)} required />
          </div>
        </div>
        <button type="submit" className="submit-btn">Add Game</button>
      </form>

      <div style={{ marginTop: 28 }}>
        <h2 style={{ marginBottom: 12 }}>Upcoming Games</h2>
        {upcomingGames.length === 0 && <p className="empty">No upcoming games.</p>}
        {upcomingGames.map(g => (
          <div key={g.id} className="game-admin-card">
            {editingGame === g.id ? (
              <>
                <div className="form-row" style={{ marginBottom: 8 }}>
                  <div className="form-group">
                    <label>Team 1</label>
                    <input value={editFields.team1} onChange={e => setEditFields(f => ({ ...f, team1: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label>Odds</label>
                    <input type="number" step="0.01" min="1.01" value={editFields.odds1} onChange={e => setEditFields(f => ({ ...f, odds1: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label>Team 2</label>
                    <input value={editFields.team2} onChange={e => setEditFields(f => ({ ...f, team2: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label>Odds</label>
                    <input type="number" step="0.01" min="1.01" value={editFields.odds2} onChange={e => setEditFields(f => ({ ...f, odds2: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label>Date</label>
                    <input type="date" value={editFields.matchDate} onChange={e => setEditFields(f => ({ ...f, matchDate: e.target.value }))} />
                  </div>
                </div>
                <div className="bet-actions">
                  <button className="edit-save-btn" onClick={() => saveEditGame(g.id)}>Save</button>
                  <button className="edit-btn" onClick={() => setEditingGame(null)}>Cancel</button>
                </div>
              </>
            ) : (
              <div className="game-admin-row">
                <span className="name">
                  <strong>{g.team1}</strong> ({g.odds1}) vs <strong>{g.team2}</strong> ({g.odds2})
                  {g.matchDate ? <span className="game-date"> — {g.matchDate}</span> : ''}
                </span>
                <div className="player-row-right">
                  <button className="edit-btn" onClick={() => startEditGame(g)}>Edit</button>
                  <button className={`undo-btn ${confirmGame === g.id ? 'confirming' : ''}`}
                    onClick={() => { if (confirmGame === g.id) { removeGame(g.id); setConfirmGame(null) } else setConfirmGame(g.id) }}>
                    {confirmGame === g.id ? 'Confirm?' : 'Remove'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {pastGames.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ marginBottom: 12, color: '#475569' }}>Past Games</h2>
          {pastGames.map(g => (
            <div key={g.id} className="game-admin-card" style={{ opacity: 0.5 }}>
              <div className="game-admin-row">
                <span className="name"><strong>{g.team1}</strong> ({g.odds1}) vs <strong>{g.team2}</strong> ({g.odds2}) — {g.matchDate}</span>
                <button className={`undo-btn ${confirmGame === g.id ? 'confirming' : ''}`}
                  onClick={() => { if (confirmGame === g.id) { removeGame(g.id); setConfirmGame(null) } else setConfirmGame(g.id) }}>
                  {confirmGame === g.id ? 'Confirm?' : 'Remove'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 32 }}>
        <h2 style={{ marginBottom: 12 }}>Players</h2>
        {players.length === 0 && <p className="empty">No players.</p>}
        {players.map(p => (
          <div key={p.id} className="player-row">
            <span className="name">{p.username}</span>
            <div className="player-row-right">
              <span className={p.balance >= 50 ? 'up' : 'down'}>${p.balance?.toFixed(2)}</span>
              <button className={`undo-btn ${confirmPlayer === p.id ? 'confirming' : ''}`}
                onClick={() => { if (confirmPlayer === p.id) { removePlayer(p.id); setConfirmPlayer(null) } else setConfirmPlayer(p.id) }}>
                {confirmPlayer === p.id ? 'Confirm delete?' : 'Delete'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
