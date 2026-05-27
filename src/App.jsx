import { useState, useEffect } from 'react'
import { db } from './firebase'
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc,
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
  return Math.max(0, Math.min(avail1 / (odds2 - 1), avail2 / (odds1 - 1)))
}

function fmt(n) {
  return `$${Number(n).toFixed(2)}`
}

const ADMIN_PASSWORD = '888'

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [players, setPlayers] = useState([])
  const [bets, setBets] = useState([])
  const [games, setGames] = useState([])
  const [listings, setListings] = useState([])
  const [tab, setTab] = useState('market')
  const [currentPlayerId, setCurrentPlayerId] = useState(
    () => localStorage.getItem('currentPlayerId') || ''
  )

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

  function selectPlayer(id) {
    setCurrentPlayerId(id)
    localStorage.setItem('currentPlayerId', id)
  }

  const currentPlayer = players.find(p => p.id === currentPlayerId) || null
  const activeBets = bets.filter(b => b.status === 'active')
  const settledBets = bets.filter(b => b.status === 'settled')
  const openListings = listings.filter(l => l.status === 'open')
  const avail = (p) => availableBalance(p, activeBets)

  // Games
  async function addGame(team1, odds1, team2, odds2) {
    await addDoc(collection(db, 'games'), {
      team1, odds1: parseFloat(odds1), team2, odds2: parseFloat(odds2),
      createdAt: serverTimestamp()
    })
  }

  async function removeGame(id) {
    await deleteDoc(doc(db, 'games', id))
  }

  // Listings
  async function publishListing({ gameId, team1, team2, odds1, odds2, publisherSide, stake }) {
    await addDoc(collection(db, 'listings'), {
      publisherId: currentPlayerId,
      gameId, team1, team2, odds1, odds2,
      publisherSide,
      stake: stake ? parseFloat(stake) : null,
      status: 'open',
      createdAt: serverTimestamp()
    })
  }

  async function cancelListing(id) {
    await updateDoc(doc(db, 'listings', id), { status: 'cancelled' })
  }

  async function editListingStake(id, stake) {
    await updateDoc(doc(db, 'listings', id), {
      stake: stake ? parseFloat(stake) : null
    })
  }

  async function takeListing(listing, takerStake) {
    const takerId = currentPlayerId
    const finalStake = listing.stake ?? parseFloat(takerStake)

    let player1Id, player2Id
    if (listing.publisherSide === 1) {
      player1Id = listing.publisherId
      player2Id = takerId
    } else {
      player1Id = takerId
      player2Id = listing.publisherId
    }

    await Promise.all([
      addDoc(collection(db, 'bets'), {
        player1Id, player2Id,
        team1: listing.team1, team2: listing.team2,
        player1Odds: listing.odds1, player2Odds: listing.odds2,
        stake: finalStake,
        status: 'active',
        listingId: listing.id,
        createdAt: serverTimestamp()
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

  // Players
  async function addPlayer(name) {
    await addDoc(collection(db, 'players'), { name, balance: 50, wins: 0, losses: 0 })
  }

  async function updatePlayer(id, fields) {
    await updateDoc(doc(db, 'players', id), fields)
  }

  return (
    <div className="app">
      <header>
        <h1>Bet Tracker</h1>
        <div className="player-selector">
          <span>You are:</span>
          <select value={currentPlayerId} onChange={e => selectPlayer(e.target.value)}>
            <option value="">Select your name</option>
            {players.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {currentPlayer && (
            <span className="header-balance">
              {fmt(avail(currentPlayer))} available
            </span>
          )}
        </div>
      </header>

      <nav>
        {[
          ['market', `Market (${openListings.length})`],
          ['new', '+ New Bet'],
          ['bets', `Active (${activeBets.length})`],
          ['leaderboard', 'Leaderboard'],
          ['history', 'History'],
          ['players', 'Players'],
          ['admin', 'Admin'],
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
        {tab === 'market' && (
          <Market
            listings={openListings}
            players={players}
            currentPlayer={currentPlayer}
            activeBets={activeBets}
            takeListing={takeListing}
            cancelListing={cancelListing}
            editListingStake={editListingStake}
          />
        )}
        {tab === 'new' && (
          <NewBet
            games={games}
            currentPlayer={currentPlayer}
            activeBets={activeBets}
            publishListing={publishListing}
            setTab={setTab}
          />
        )}
        {tab === 'bets' && (
          <ActiveBets
            bets={activeBets}
            players={players}
            settleBet={settleBet}
            cancelBet={cancelBet}
          />
        )}
        {tab === 'leaderboard' && <Leaderboard players={players} avail={avail} />}
        {tab === 'history' && <History bets={settledBets} players={players} undoBet={undoBet} />}
        {tab === 'players' && <Players players={players} addPlayer={addPlayer} updatePlayer={updatePlayer} />}
        {tab === 'admin' && <Admin games={games} addGame={addGame} removeGame={removeGame} />}
      </main>
    </div>
  )
}

// ── Market ────────────────────────────────────────────────────────────────────

function Market({ listings, players, currentPlayer, activeBets, takeListing, cancelListing, editListingStake }) {
  const name = (id) => players.find(p => p.id === id)?.name ?? '?'
  const [takerStakes, setTakerStakes] = useState({})
  const [editingStake, setEditingStake] = useState(null)
  const [editStakeVal, setEditStakeVal] = useState('')
  const [confirming, setConfirming] = useState(null)

  function getPlayer(id) {
    return players.find(p => p.id === id)
  }

  function getMax(listing) {
    if (!currentPlayer) return null
    const publisher = getPlayer(listing.publisherId)
    if (!publisher) return null
    if (listing.publisherSide === 1) {
      return calcMaxStake(publisher, currentPlayer, listing.odds1, listing.odds2, activeBets)
    } else {
      return calcMaxStake(currentPlayer, publisher, listing.odds1, listing.odds2, activeBets)
    }
  }

  async function handleTake(listing) {
    if (!currentPlayer) return
    const stake = listing.stake ?? parseFloat(takerStakes[listing.id])
    if (!stake || stake <= 0) return
    await takeListing(listing, stake)
  }

  async function saveEditStake(id) {
    await editListingStake(id, editStakeVal)
    setEditingStake(null)
  }

  if (!currentPlayer) {
    return (
      <section>
        <h2>Market</h2>
        <p className="empty">Select your name at the top to interact with the market.</p>
      </section>
    )
  }

  return (
    <section>
      <h2>Market</h2>
      {listings.length === 0 && (
        <p className="empty">No open bets. Be the first — go to + New Bet.</p>
      )}
      {listings.map(listing => {
        const isOwn = listing.publisherId === currentPlayer?.id
        const publisherTeam = listing.publisherSide === 1 ? listing.team1 : listing.team2
        const takerTeam = listing.publisherSide === 1 ? listing.team2 : listing.team1
        const publisherOdds = listing.publisherSide === 1 ? listing.odds1 : listing.odds2
        const takerOdds = listing.publisherSide === 1 ? listing.odds2 : listing.odds1
        const max = isOwn ? null : getMax(listing)
        const takerStake = takerStakes[listing.id] || ''
        const displayStake = listing.stake ?? parseFloat(takerStake)

        return (
          <div key={listing.id} className={`bet-card ${isOwn ? 'own-listing' : ''}`}>
            <div className="listing-badge">
              {isOwn ? 'Your listing' : `${name(listing.publisherId)}'s bet`}
            </div>
            <div className="bet-header">
              <span>
                <strong>{publisherTeam}</strong>
                <span className="odds-tag">{publisherOdds}</span>
                {name(listing.publisherId)}
              </span>
              <span className="vs">vs</span>
              <span>
                <strong>{takerTeam}</strong>
                <span className="odds-tag">{takerOdds}</span>
                {isOwn ? '(open)' : currentPlayer.name}
              </span>
            </div>

            {displayStake > 0 && (
              <div className="bet-info">
                Stake: {fmt(displayStake)}
                &nbsp;·&nbsp;
                {publisherTeam} wins → {name(listing.publisherId)} gets {fmt(displayStake * (publisherOdds - 1))}
                &nbsp;·&nbsp;
                {takerTeam} wins → {isOwn ? 'taker' : currentPlayer.name} gets {fmt(displayStake * (takerOdds - 1))}
              </div>
            )}

            {isOwn ? (
              <div className="bet-actions">
                {editingStake === listing.id ? (
                  <>
                    <input
                      className="inline-input"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Stake ($)"
                      value={editStakeVal}
                      onChange={e => setEditStakeVal(e.target.value)}
                    />
                    <button className="edit-save-btn" onClick={() => saveEditStake(listing.id)}>Save</button>
                    <button className="edit-btn" onClick={() => setEditingStake(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <span className="settle-label">
                      Stake: {listing.stake ? fmt(listing.stake) : 'open'}
                    </span>
                    <button className="edit-btn" onClick={() => {
                      setEditingStake(listing.id)
                      setEditStakeVal(listing.stake || '')
                    }}>
                      Edit Stake
                    </button>
                    <button
                      className={`undo-btn ${confirming === listing.id ? 'confirming' : ''}`}
                      onClick={() => {
                        if (confirming === listing.id) {
                          cancelListing(listing.id)
                          setConfirming(null)
                        } else {
                          setConfirming(listing.id)
                        }
                      }}
                    >
                      {confirming === listing.id ? 'Confirm cancel?' : 'Cancel Bet'}
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="bet-actions">
                {!listing.stake && (
                  <>
                    <input
                      className="inline-input"
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder={max !== null ? `Max ${fmt(max)}` : 'Stake ($)'}
                      value={takerStake}
                      onChange={e => setTakerStakes(s => ({ ...s, [listing.id]: e.target.value }))}
                    />
                  </>
                )}
                {max !== null && max <= 0 ? (
                  <span className="error-inline">Insufficient funds</span>
                ) : (
                  <button
                    className="win-btn"
                    disabled={!listing.stake && (!takerStake || parseFloat(takerStake) <= 0)}
                    onClick={() => handleTake(listing)}
                  >
                    Take this bet
                  </button>
                )}
                {max !== null && max > 0 && (
                  <span className="max-label">max {fmt(max)}</span>
                )}
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

  const game = games.find(g => g.id === gameId)
  const myOdds = game ? (side === '1' ? game.odds1 : game.odds2) : null
  const myTeam = game ? (side === '1' ? game.team1 : game.team2) : null
  const theirOdds = game ? (side === '1' ? game.odds2 : game.odds1) : null
  const theirTeam = game ? (side === '1' ? game.team2 : game.team1) : null
  const s = parseFloat(stake)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!currentPlayer) return
    if (!game || !side) return
    await publishListing({
      gameId,
      team1: game.team1,
      team2: game.team2,
      odds1: game.odds1,
      odds2: game.odds2,
      publisherSide: parseInt(side),
      stake: s > 0 ? s : null
    })
    setGameId('')
    setSide('')
    setStake('')
    setTab('market')
  }

  if (!currentPlayer) {
    return (
      <section>
        <h2>+ New Bet</h2>
        <p className="empty">Select your name at the top first.</p>
      </section>
    )
  }

  if (games.length === 0) {
    return (
      <section>
        <h2>+ New Bet</h2>
        <p className="empty">No games available yet. Ask the admin to add some.</p>
      </section>
    )
  }

  return (
    <section>
      <h2>+ New Bet</h2>
      <form className="bet-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Select Game</label>
          <select value={gameId} onChange={e => { setGameId(e.target.value); setSide('') }} required>
            <option value="">Choose a game...</option>
            {games.map(g => (
              <option key={g.id} value={g.id}>
                {g.team1} ({g.odds1}) vs {g.team2} ({g.odds2})
              </option>
            ))}
          </select>
        </div>

        {game && (
          <div className="form-group">
            <label>I'm backing</label>
            <div className="side-picker">
              <button
                type="button"
                className={`side-btn ${side === '1' ? 'selected' : ''}`}
                onClick={() => setSide('1')}
              >
                {game.team1}
                <span className="odds-tag">{game.odds1}</span>
              </button>
              <button
                type="button"
                className={`side-btn ${side === '2' ? 'selected' : ''}`}
                onClick={() => setSide('2')}
              >
                {game.team2}
                <span className="odds-tag">{game.odds2}</span>
              </button>
            </div>
          </div>
        )}

        {side && game && (
          <>
            <div className="form-group stake-group">
              <label>Stake (optional — leave blank to decide later)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={stake}
                onChange={e => setStake(e.target.value)}
                placeholder="$0.00"
              />
            </div>

            {s > 0 && myOdds && theirOdds && (
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

            <button type="submit" className="submit-btn">
              Publish to Market
            </button>
          </>
        )}
      </form>
    </section>
  )
}

// ── Active Bets ───────────────────────────────────────────────────────────────

function ActiveBets({ bets, players, settleBet, cancelBet }) {
  const name = (id) => players.find(p => p.id === id)?.name ?? '?'
  const [confirming, setConfirming] = useState(null)
  const [cancelling, setCancelling] = useState(null)

  function handleSettle(bet, winnerId) {
    const key = `${bet.id}-${winnerId}`
    if (confirming === key) {
      settleBet(bet, winnerId)
      setConfirming(null)
    } else {
      setConfirming(key)
    }
  }

  function handleCancel(bet) {
    if (cancelling === bet.id) {
      cancelBet(bet)
      setCancelling(null)
    } else {
      setCancelling(bet.id)
    }
  }

  return (
    <section>
      <h2>Active Bets</h2>
      {bets.length === 0 && <p className="empty">No active bets.</p>}
      {bets.map(bet => (
        <div key={bet.id} className="bet-card">
          <div className="bet-header">
            <span><strong>{bet.team1}</strong> <span className="odds-tag">{bet.player1Odds}</span> {name(bet.player1Id)}</span>
            <span className="vs">vs</span>
            <span><strong>{bet.team2}</strong> <span className="odds-tag">{bet.player2Odds}</span> {name(bet.player2Id)}</span>
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
            <button
              className={`undo-btn ${cancelling === bet.id ? 'confirming' : ''}`}
              onClick={() => handleCancel(bet)}
            >
              {cancelling === bet.id ? 'Confirm remove?' : 'Remove'}
            </button>
          </div>
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
          <span className="name">{p.name}</span>
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
              <span className="winner">{winnerName} ({winnerTeam}) won {fmt(bet.payout)}</span>
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

function Players({ players, addPlayer, updatePlayer }) {
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')

  async function handleAdd(e) {
    e.preventDefault()
    if (!name.trim()) return
    await addPlayer(name.trim())
    setName('')
  }

  function startEdit(p) {
    setEditingId(p.id)
    setEditName(p.name)
  }

  async function saveEdit(p) {
    if (editName.trim() && editName.trim() !== p.name) {
      await updatePlayer(p.id, { name: editName.trim() })
    }
    setEditingId(null)
  }

  return (
    <section>
      <h2>Players</h2>
      <form className="add-player-form" onSubmit={handleAdd}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Player name" required />
        <button type="submit">Add Player</button>
      </form>
      {players.length === 0 && <p className="empty">No players yet.</p>}
      {players.map(p => (
        <div key={p.id} className="player-row">
          {editingId === p.id ? (
            <input
              className="edit-name-input"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveEdit(p)}
              autoFocus
            />
          ) : (
            <span className="name">{p.name}</span>
          )}
          <div className="player-row-right">
            <span className={p.balance >= 50 ? 'up' : 'down'}>${p.balance.toFixed(2)}</span>
            {editingId === p.id
              ? <button className="edit-save-btn" onClick={() => saveEdit(p)}>Save</button>
              : <button className="edit-btn" onClick={() => startEdit(p)}>Edit</button>
            }
          </div>
        </div>
      ))}
    </section>
  )
}

// ── Admin ─────────────────────────────────────────────────────────────────────

function Admin({ games, addGame, removeGame }) {
  const [unlocked, setUnlocked] = useState(false)
  const [pw, setPw] = useState('')
  const [pwError, setPwError] = useState(false)
  const [team1, setTeam1] = useState('')
  const [odds1, setOdds1] = useState('')
  const [team2, setTeam2] = useState('')
  const [odds2, setOdds2] = useState('')
  const [confirming, setConfirming] = useState(null)

  function handleLogin(e) {
    e.preventDefault()
    if (pw === ADMIN_PASSWORD) {
      setUnlocked(true)
      setPwError(false)
    } else {
      setPwError(true)
    }
  }

  async function handleAddGame(e) {
    e.preventDefault()
    if (!team1 || !team2 || !odds1 || !odds2) return
    await addGame(team1.trim(), odds1, team2.trim(), odds2)
    setTeam1(''); setOdds1(''); setTeam2(''); setOdds2('')
  }

  function handleRemove(id) {
    if (confirming === id) {
      removeGame(id)
      setConfirming(null)
    } else {
      setConfirming(id)
    }
  }

  if (!unlocked) {
    return (
      <section>
        <h2>Admin</h2>
        <form className="pw-form" onSubmit={handleLogin}>
          <input
            type="password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            placeholder="Enter password"
            autoFocus
          />
          <button type="submit">Unlock</button>
        </form>
        {pwError && <p className="error" style={{ marginTop: 12 }}>Incorrect password.</p>}
      </section>
    )
  }

  return (
    <section>
      <h2>Admin — Games</h2>
      <form className="bet-form" onSubmit={handleAddGame}>
        <div className="form-row">
          <div className="form-group">
            <label>Team 1</label>
            <input value={team1} onChange={e => setTeam1(e.target.value)} placeholder="e.g. LEV" required />
          </div>
          <div className="form-group">
            <label>Odds</label>
            <input type="number" step="0.01" min="1.01" value={odds1} onChange={e => setOdds1(e.target.value)} placeholder="e.g. 1.30" required />
          </div>
          <div className="form-group">
            <label>Team 2</label>
            <input value={team2} onChange={e => setTeam2(e.target.value)} placeholder="e.g. GE" required />
          </div>
          <div className="form-group">
            <label>Odds</label>
            <input type="number" step="0.01" min="1.01" value={odds2} onChange={e => setOdds2(e.target.value)} placeholder="e.g. 1.80" required />
          </div>
        </div>
        <button type="submit" className="submit-btn">Add Game</button>
      </form>

      <div style={{ marginTop: 24 }}>
        {games.length === 0 && <p className="empty">No games added yet.</p>}
        {games.map(g => (
          <div key={g.id} className="player-row">
            <span className="name">
              <strong>{g.team1}</strong> ({g.odds1}) vs <strong>{g.team2}</strong> ({g.odds2})
            </span>
            <button
              className={`undo-btn ${confirming === g.id ? 'confirming' : ''}`}
              onClick={() => handleRemove(g.id)}
            >
              {confirming === g.id ? 'Confirm?' : 'Remove'}
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
