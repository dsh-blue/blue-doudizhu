/**
 * Readonly snapshots derived from the owner-scoped Doudizhu domain state.
 *
 * @module @dsh-blue/blue-doudizhu/projection
 */

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function card(value) {
  return { v: value.v, suit: value.suit, uid: value.uid }
}

function combo(value) {
  return value === null || value === undefined
    ? null
    : { type: value.type, rank: value.rank, count: value.count, seqHigh: value.seqHigh }
}

function played(value) {
  return value === null || value === undefined
    ? null
    : { cards: value.cards.map(card), combo: combo(value.combo) }
}

function gameSnapshot(game) {
  if (game === null) return null
  return {
    round: game.round,
    stage: game.stage,
    players: game.players.map(player => ({
      idx: player.idx,
      name: player.name,
      role: player.role,
      hand: player.hand.map(card),
      played: played(player.played),
      playedDisplay: player.playedDisplay,
      passed: player.passed === true,
    })),
    currentIdx: game.currentIdx,
    table: game.table === null
      ? null
      : { cards: game.table.cards.map(card), combo: combo(game.table.combo), ownerIdx: game.table.ownerIdx },
    bottom: game.bottom.map(card),
    landlord: game.landlord,
    winner: game.winner,
    playedCounts: { ...game.playedCounts },
    thinking: game.thinking,
    thinkName: game.thinkName,
    thinkRaw: game.thinkRaw,
    thinkDeadline: game.thinkDeadline,
  }
}

/** Derive one immutable render snapshot without retaining mutable domain data. */
export function projectRuntime(runtime) {
  return deepFreeze({
    game: gameSnapshot(runtime.game),
    match: { scores: runtime.match.scores.slice(), games: runtime.match.games },
    memoOn: runtime.memoOn,
    paused: runtime.paused,
    botMode: runtime.botMode,
    finalRanking: runtime.finalRanking === null
      ? null
      : {
          games: runtime.finalRanking.games,
          rows: runtime.finalRanking.rows.map(row => ({ ...row })),
        },
    thinkTimeoutMs: runtime.thinkTimeoutMs,
  })
}
