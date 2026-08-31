/** Domain and projection contract tests. */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  RANK_CHAR,
  applyPlay,
  beats,
  buildDeck,
  classifyRanks,
  createGame,
  generateCandidates,
  parseMove,
} from '../src/domain.js'
import { projectRuntime } from '../src/projection.js'

test('classifies core combinations and comparison rules', () => {
  assert.deepEqual(classifyRanks([3]), { type: 'single', rank: 3, count: 1, seqHigh: 3 })
  assert.equal(classifyRanks([0, 1, 2, 3, 4]).type, 'straight')
  assert.equal(classifyRanks([8, 8, 8, 8]).type, 'bomb')
  assert.equal(classifyRanks([13, 14]).type, 'rocket')
  assert.equal(classifyRanks([0, 2, 3, 4, 5]), null)
  assert.equal(beats(classifyRanks([5]), classifyRanks([4])), true)
  assert.equal(beats(classifyRanks([8, 8, 8, 8]), classifyRanks([12])), true)
  assert.equal(beats(classifyRanks([4]), classifyRanks([5])), false)
})

test('creates unique decks and deterministic owner-scoped games', () => {
  const first = buildDeck(0)
  const second = buildDeck(first.nextUid)
  assert.equal(first.cards.length, 54)
  assert.equal(new Set([...first.cards, ...second.cards].map(card => card.uid)).size, 108)
  const created = createGame({ round: 1, startUid: second.nextUid, humanBid: 3, random: () => 0.5 })
  assert.equal(created.ok, true)
  assert.equal(created.game.landlord, 0)
  assert.deepEqual(created.game.players.map(player => player.hand.length), [20, 17, 17])
})

test('validates and applies moves while keeping the projection immutable', () => {
  const created = createGame({ round: 2, startUid: 0, humanBid: 3, random: () => 0.5 })
  assert.equal(created.ok, true)
  const game = created.game
  const firstCard = game.players[0].hand[0]
  const move = parseMove(game, 0, RANK_CHAR[firstCard.v].toLowerCase())
  assert.ok(move.cards)
  const before = game.players[0].hand.length
  applyPlay(game, 0, move)
  assert.equal(game.players[0].hand.length, before - 1)
  assert.ok(generateCandidates(game.players[1].hand).length > 0)

  const projected = projectRuntime({
    game,
    match: { scores: [0, 0, 0], games: 0 },
    memoOn: false,
    paused: false,
    botMode: 'hybrid',
    finalRanking: null,
    thinkTimeoutMs: 30_000,
  })
  assert.equal(Object.isFrozen(projected), true)
  assert.equal(Object.isFrozen(projected.game.players[0].hand), true)
  assert.notEqual(projected.game.players[0], game.players[0])
  assert.throws(() => { projected.game.players[0].name = 'mutated' }, TypeError)
})
