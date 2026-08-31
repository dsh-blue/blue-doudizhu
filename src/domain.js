/**
 * Pure Doudizhu rules, state transitions, and heuristic decisions.
 *
 * @module @dsh-blue/blue-doudizhu/domain
 */

export const PLAYER_NAMES = Object.freeze(['你', 'Bot-1', 'Bot-2'])
export const RANK_CHAR = Object.freeze(['3', '4', '5', '6', '7', '8', '9', '0', 'J', 'Q', 'K', 'A', '2', 's', 'x'])

const SUITS = Object.freeze(['♠', '♥', '♦', '♣'])
const RANK_VALUE = Object.freeze({
  '3': 0,
  '4': 1,
  '5': 2,
  '6': 3,
  '7': 4,
  '8': 5,
  '9': 6,
  '0': 7,
  'j': 8,
  'q': 9,
  'k': 10,
  'a': 11,
  '2': 12,
  's': 13,
  'x': 14,
})

/** Return the compact label used by commands and the board. */
export function cardLabel(card) {
  return RANK_CHAR[card.v] + (card.v < 13 ? card.suit : '')
}

/** Build one uniquely identified deck without retaining module state. */
export function buildDeck(startUid = 0) {
  let nextUid = startUid
  const cards = []
  for (let value = 0; value <= 12; value += 1) {
    for (const suit of SUITS) cards.push({ v: value, suit, uid: `c${String(nextUid++)}` })
  }
  cards.push({ v: 13, suit: '', uid: `c${String(nextUid++)}` })
  cards.push({ v: 14, suit: '', uid: `c${String(nextUid++)}` })
  return { cards, nextUid }
}

/** Return a shuffled copy using the caller-owned source of randomness. */
export function shuffle(cards, random = Math.random) {
  const result = cards.slice()
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1))
    const value = result[index]
    result[index] = result[other]
    result[other] = value
  }
  return result
}

/** Classify a rank sequence into a supported Doudizhu combination. */
export function classifyRanks(values) {
  const sorted = values.slice().sort((left, right) => left - right)
  const count = new Map()
  for (const value of sorted) count.set(value, (count.get(value) || 0) + 1)
  const unique = [...count.keys()].sort((left, right) => left - right)
  const size = sorted.length
  if (size === 2 && count.has(13) && count.has(14)) return { type: 'rocket', rank: 99, count: 2, seqHigh: 14 }
  if (size === 4 && unique.length === 1) return { type: 'bomb', rank: unique[0], count: 4, seqHigh: unique[0] }
  if (size === 1) return { type: 'single', rank: unique[0], count: 1, seqHigh: unique[0] }
  if (size === 2 && unique.length === 1 && unique[0] < 13) return { type: 'pair', rank: unique[0], count: 2, seqHigh: unique[0] }
  if (size === 3 && unique.length === 1) return { type: 'triple', rank: unique[0], count: 3, seqHigh: unique[0] }

  const groups = [...count.entries()].sort((left, right) => right[1] - left[1] || left[0] - right[0])
  const triples = groups.filter(group => group[1] === 3)
  const pairs = groups.filter(group => group[1] === 2)
  const singles = groups.filter(group => group[1] === 1)
  const quad = groups.find(group => group[1] === 4)
  if (size === 4 && triples.length === 1 && singles.length === 1) return { type: 'triple1', rank: triples[0][0], count: 4, seqHigh: triples[0][0] }
  if (size === 5 && triples.length === 1 && pairs.length === 1) return { type: 'triple2', rank: triples[0][0], count: 5, seqHigh: triples[0][0] }
  if (quad) {
    if (size === 6) return { type: 'four2', rank: quad[0], count: 6, seqHigh: quad[0] }
    if (size === 8 && pairs.length === 2) return { type: 'four2', rank: quad[0], count: 8, seqHigh: quad[0] }
  }
  if (size >= 5 && unique.length === size && unique.every(value => value <= 11)) {
    for (let index = 1; index < unique.length; index += 1) if (unique[index] !== unique[index - 1] + 1) return null
    return { type: 'straight', rank: unique[size - 1], count: size, seqHigh: unique[size - 1] }
  }
  if (size >= 6 && size % 2 === 0 && unique.every(value => value <= 11) && unique.every(value => count.get(value) === 2)) {
    for (let index = 1; index < unique.length; index += 1) if (unique[index] !== unique[index - 1] + 1) return null
    return { type: 'doubleSeq', rank: unique[unique.length - 1], count: size, seqHigh: unique[unique.length - 1] }
  }

  const tripleValues = [...count.entries()]
    .filter(entry => entry[1] === 3 && entry[0] <= 11)
    .map(entry => entry[0])
    .sort((left, right) => left - right)
  let run = []
  for (let index = 0; index < tripleValues.length; index += 1) {
    const candidate = [tripleValues[index]]
    while (index + 1 < tripleValues.length && tripleValues[index + 1] === tripleValues[index] + 1) {
      candidate.push(tripleValues[index + 1])
      index += 1
    }
    if (candidate.length > run.length) run = candidate
  }
  if (run.length >= 2) {
    const wings = size - 3 * run.length
    if (wings === 0 || wings === run.length || wings === 2 * run.length) {
      return { type: 'plane', rank: run[run.length - 1], count: size, seqHigh: run[run.length - 1] }
    }
  }
  return null
}

/** Decide whether one classified combination beats another. */
export function beats(candidate, table) {
  if (!table) return true
  if (candidate.type === 'rocket') return table.type !== 'rocket'
  if (table.type === 'rocket') return false
  if (candidate.type === 'bomb') return table.type !== 'bomb' || candidate.rank > table.rank
  if (table.type === 'bomb' || candidate.type !== table.type || candidate.count !== table.count) return false
  return candidate.rank > table.rank
}

/** Generate bounded candidates used by the heuristic fallback. */
export function generateCandidates(hand) {
  const byValue = new Map()
  for (const card of hand) {
    const cards = byValue.get(card.v) || []
    cards.push(card)
    byValue.set(card.v, cards)
  }
  const values = [...byValue.keys()].sort((left, right) => left - right)
  const result = []
  for (const value of values) result.push({ cards: byValue.get(value).slice(0, 1), combo: { type: 'single', rank: value, count: 1, seqHigh: value } })
  for (const value of values) if (byValue.get(value).length >= 2 && value < 13) result.push({ cards: byValue.get(value).slice(0, 2), combo: { type: 'pair', rank: value, count: 2, seqHigh: value } })
  for (const value of values) if (byValue.get(value).length >= 3 && value < 13) result.push({ cards: byValue.get(value).slice(0, 3), combo: { type: 'triple', rank: value, count: 3, seqHigh: value } })
  for (const triple of values) {
    if (byValue.get(triple).length < 3 || triple >= 13) continue
    const cards = byValue.get(triple).slice(0, 3)
    const single = values.find(value => value !== triple)
    if (single !== undefined) result.push({ cards: [...cards, byValue.get(single)[0]], combo: { type: 'triple1', rank: triple, count: 4, seqHigh: triple } })
    const pair = values.find(value => value !== triple && byValue.get(value).length >= 2)
    if (pair !== undefined) result.push({ cards: [...cards, ...byValue.get(pair).slice(0, 2)], combo: { type: 'triple2', rank: triple, count: 5, seqHigh: triple } })
  }
  for (let length = 5; length <= 12; length += 1) {
    for (let start = 0; start + length - 1 <= 11; start += 1) {
      const cards = []
      for (let offset = 0; offset < length && byValue.has(start + offset); offset += 1) cards.push(byValue.get(start + offset)[0])
      if (cards.length === length) result.push({ cards, combo: { type: 'straight', rank: start + length - 1, count: length, seqHigh: start + length - 1 } })
    }
  }
  for (let length = 3; length <= 6; length += 1) {
    for (let start = 0; start + length - 1 <= 11; start += 1) {
      const cards = []
      for (let offset = 0; offset < length && (byValue.get(start + offset) || []).length >= 2; offset += 1) cards.push(...byValue.get(start + offset).slice(0, 2))
      if (cards.length === length * 2) result.push({ cards, combo: { type: 'doubleSeq', rank: start + length - 1, count: length * 2, seqHigh: start + length - 1 } })
    }
  }
  for (const value of values) if (byValue.get(value).length === 4) result.push({ cards: byValue.get(value).slice(0, 4), combo: { type: 'bomb', rank: value, count: 4, seqHigh: value } })
  if (byValue.has(13) && byValue.has(14)) result.push({ cards: [byValue.get(13)[0], byValue.get(14)[0]], combo: { type: 'rocket', rank: 99, count: 2, seqHigh: 14 } })
  return result
}

/** Estimate a bounded bid from one hand. */
export function strengthBid(cards) {
  const counts = {}
  let bombs = 0
  for (const card of cards) counts[card.v] = (counts[card.v] || 0) + 1
  for (const value of Object.keys(counts)) if (counts[value] === 4) bombs += 1
  const score = (counts[13] ? 1 : 0) + (counts[14] ? 2 : 0) + (counts[12] || 0) + bombs
  return score >= 5 ? 3 : score >= 3 ? 2 : score >= 1 ? 1 : 0
}

/** Create one game and return the next uid cursor to the owner. */
export function createGame({ round, startUid, humanBid, random = Math.random }) {
  const built = buildDeck(startUid)
  const deck = shuffle(built.cards, random)
  const hands = [deck.slice(0, 17), deck.slice(17, 34), deck.slice(34, 51)]
  const bottom = deck.slice(51, 54)
  const players = PLAYER_NAMES.map((name, index) => ({
    idx: index,
    name,
    role: '',
    hand: hands[index],
    isBot: index !== 0,
    played: null,
    playedDisplay: '',
  }))
  const bids = [humanBid ?? strengthBid(players[0].hand), strengthBid(players[1].hand), strengthBid(players[2].hand)]
  const maxBid = Math.max(...bids)
  if (maxBid === 0) return { ok: false, error: '三家都不叫，重新洗牌（请再次 /poker new）', nextUid: built.nextUid }
  const landlord = bids.lastIndexOf(maxBid)
  for (const player of players) player.role = player.idx === landlord ? 'landlord' : 'farmer'
  players[landlord].hand = [...players[landlord].hand, ...bottom]
  return {
    ok: true,
    nextUid: built.nextUid,
    game: {
      round,
      stage: 'play',
      players,
      currentIdx: landlord,
      table: null,
      passStreak: 0,
      bottom,
      landlord,
      winner: null,
      base: Math.max(1, bids[landlord]),
      playedCounts: {},
      settled: false,
      thinking: false,
      thinkName: '',
      thinkRaw: '',
      thinkDeadline: 0,
    },
  }
}

/** Parse and validate one player move against current game state. */
export function parseMove(game, playerIndex, input) {
  const text = String(input).trim().toLowerCase()
  if (/^(p|pass|不出|过|不要)$/u.test(text)) return { pass: true }
  const values = text.replace(/[\s,]/gu, '').split('').map(character => RANK_VALUE[character]).filter(value => value !== undefined)
  if (values.length === 0) return { error: '无法识别出牌编码' }
  const needed = new Map()
  for (const value of values) needed.set(value, (needed.get(value) || 0) + 1)
  const byValue = new Map()
  for (const card of game.players[playerIndex].hand) {
    const cards = byValue.get(card.v) || []
    cards.push(card)
    byValue.set(card.v, cards)
  }
  const chosen = []
  for (const [value, quantity] of needed) {
    if (!byValue.has(value) || byValue.get(value).length < quantity) return { error: '手牌中该点数数量不足' }
    chosen.push(...byValue.get(value).slice(0, quantity))
  }
  const combo = classifyRanks(chosen.map(card => card.v))
  if (!combo) return { error: '非法的牌型' }
  if (game.table && !beats(combo, game.table.combo)) return { error: '压不过上家' }
  return { cards: chosen, combo }
}

/** Apply one validated play to the owner-scoped game. */
export function applyPlay(game, playerIndex, move) {
  const player = game.players[playerIndex]
  const ids = new Set(move.cards.map(card => card.uid))
  player.hand = player.hand.filter(card => !ids.has(card.uid))
  player.played = { cards: move.cards, combo: move.combo }
  player.playedDisplay = move.cards.map(cardLabel).join('')
  player.passed = false
  game.table = { cards: move.cards, combo: move.combo, ownerIdx: playerIndex }
  game.passStreak = 0
  for (const card of move.cards) game.playedCounts[card.v] = (game.playedCounts[card.v] || 0) + 1
  if (player.hand.length === 0) {
    game.stage = 'ended'
    game.winner = player.role
    return
  }
  game.currentIdx = (playerIndex + 1) % 3
}

/** Apply one pass and reset the table after two consecutive passes. */
export function applyPass(game, playerIndex) {
  const player = game.players[playerIndex]
  player.played = null
  player.playedDisplay = '不出'
  player.passed = true
  game.passStreak += 1
  if (game.passStreak >= 2 && game.table) {
    game.currentIdx = game.table.ownerIdx
    game.table = null
    game.passStreak = 0
    for (const current of game.players) {
      current.passed = false
      current.playedDisplay = ''
    }
  } else {
    game.currentIdx = (playerIndex + 1) % 3
  }
}

/** Pick one legal low-cost move without model services. */
export function heuristicMove(game, playerIndex) {
  let legal = generateCandidates(game.players[playerIndex].hand)
  if (game.table) legal = legal.filter(candidate => beats(candidate.combo, game.table.combo))
  else legal = legal.filter(candidate => candidate.combo.type !== 'bomb' && candidate.combo.type !== 'rocket')
  if (legal.length === 0) return { pass: true, fromHeuristic: true }
  if (game.table) legal.sort((left, right) => left.combo.rank - right.combo.rank || left.combo.count - right.combo.count)
  else legal.sort((left, right) => right.combo.count - left.combo.count || left.combo.rank - right.combo.rank)
  return { ...legal[0], fromHeuristic: true }
}

/** Settle one completed game exactly once into match state. */
export function settleMatch(match, game) {
  if (game.settled || game.stage !== 'ended') return
  game.settled = true
  const landlord = game.landlord
  if (game.winner === 'landlord') {
    match.scores[landlord] += 2 * game.base
    for (const index of [0, 1, 2]) if (index !== landlord) match.scores[index] -= game.base
  } else {
    match.scores[landlord] -= 2 * game.base
    for (const index of [0, 1, 2]) if (index !== landlord) match.scores[index] += game.base
  }
  match.games += 1
}

/** Build a stable ranking value before the owner resets a match. */
export function rankMatch(match) {
  const order = [0, 1, 2].sort((left, right) => match.scores[right] - match.scores[left])
  return {
    games: match.games,
    rows: order.map((playerIndex, index) => ({ rank: index + 1, name: PLAYER_NAMES[playerIndex], score: match.scores[playerIndex] })),
  }
}
