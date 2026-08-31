/**
 * Renderer-neutral Blue UI for Doudizhu runtime projections.
 *
 * @module @dsh-blue/blue-doudizhu/view
 */

import { ui } from '@dsh-blue/blue-ui'
import { cardLabel, RANK_CHAR } from './domain.js'

const HINT_LINE = '直接输入 /poker <编码> 出牌 · /poker p 不出 · /poker hide 收起牌面 · /poker stop 停止'
const BAND_STEP = 4
const MIN_BAND_COLUMNS = 20
const MAX_BAND_COLUMNS = 120
const CHROME_COLUMNS = 4

function cardRows(cards, gap, padding) {
  const separator = ' '.repeat(gap)
  const top = cards.map(() => '┌───┐').join(separator)
  const middle = cards.map(value => `│${(cardLabel(value) + '  ').slice(0, 3)}│`).join(separator)
  const bottom = cards.map(() => '└───┘').join(separator)
  const prefix = ' '.repeat(padding)
  return [`${prefix}${top}`, `${prefix}${middle}`, `${prefix}${bottom}`]
}

function handArt(hand, width) {
  if (hand.length === 0) return []
  const cardWidth = 5
  const gap = 1
  const maxPerRow = Math.max(1, Math.min(hand.length, Math.floor((width + gap) / (cardWidth + gap))))
  const rowCount = Math.ceil(hand.length / maxPerRow)
  const perRow = Math.ceil(hand.length / rowCount)
  const lines = []
  for (let index = 0; index < hand.length; index += perRow) {
    const row = hand.slice(index, index + perRow)
    const rowWidth = cardWidth * row.length + gap * (row.length - 1)
    lines.push(...cardRows(row, gap, Math.max(0, Math.floor((width - rowWidth) / 2))))
  }
  return lines
}

function remainingSeconds(game, now) {
  return game.thinkDeadline ? Math.max(0, Math.ceil((game.thinkDeadline - now) / 1000)) : 0
}

function status(game, timeoutMs, now) {
  if (game.thinking) return { text: `🤔 ${game.thinkName} 思考中… 剩 ${String(remainingSeconds(game, now))}s（最多等 ${String(timeoutMs / 1000)}s）`, tone: 'default' }
  if (game.stage === 'ended') {
    const won = game.winner === game.players[0].role
    return { text: `★★ ${won ? '你赢了！' : '你输了！'}（${game.winner === 'landlord' ? '地主获胜' : '农民获胜'}）★★`, tone: won ? 'success' : 'danger' }
  }
  if (game.currentIdx === 0) return { text: '→ 轮到你了！  出牌：/poker <编码>   不出：/poker p', tone: 'accent' }
  return { text: `→ ${game.players[game.currentIdx].name} 出牌中…`, tone: 'default' }
}

function playedNotation(player) {
  return player.played ? player.played.cards.map(cardLabel).join('') : (player.playedDisplay || '—')
}

function memoLine(game) {
  const parts = []
  for (let value = 0; value <= 14; value += 1) {
    const total = value < 13 ? 4 : 1
    parts.push(`${RANK_CHAR[value]}:${String(total - (game.playedCounts[value] || 0))}`)
  }
  return `记牌(剩余未出): ${parts.join(' ')}`
}

function boardLines(model, width) {
  const game = model.game
  const lines = [
    `第${String(game.round)}局 地主:${game.players[game.landlord].name}(底牌 ${game.bottom.map(cardLabel).join(' ')})  局分 ${game.players.map(player => player.name[0] + String(model.match.scores[player.idx])).join(' ')}`,
  ]
  if (model.memoOn) lines.push(memoLine(game))
  for (const player of game.players) {
    if (player.idx === 0) continue
    const turn = game.currentIdx === player.idx && game.stage === 'play' ? '→ ' : '  '
    lines.push(`${turn}${player.name} [${player.role === 'landlord' ? '地主' : '农民'}] 剩${String(player.hand.length)}张   本回合: ${player.playedDisplay || playedNotation(player)}`)
  }
  if (game.table) {
    const owner = game.players[game.table.ownerIdx]
    lines.push(`桌面(上家 ${owner.name} 出)：${playedNotation(owner)}`)
  } else {
    lines.push('本轮无牌可压（新的领出回合）')
  }
  const human = game.players[0]
  lines.push(`你的手牌 [${human.role === 'landlord' ? '地主' : '农民'}] 剩${String(human.hand.length)}张：`)
  lines.push(...handArt(human.hand.slice().sort((left, right) => left.v - right.v), width))
  return lines
}

function framed(node) {
  return ui.stack.column([ui.divider(), node, ui.divider()])
}

function leaderboard(ranking) {
  const lines = ['【排行榜】']
  for (const row of ranking.rows) lines.push(`${String(row.rank)}. ${row.name}   ${String(row.score)} 分`)
  lines.push(`（共 ${String(ranking.games)} 局）`)
  return ui.code(lines.join('\n'), { language: '' })
}

/** Render the current game or final ranking from one immutable projection. */
export function createBoardView(model, now = Date.now()) {
  if (model.game === null) {
    return model.finalRanking === null
      ? framed(ui.text('暂无牌局。/poker new 开始一局斗地主！', { tone: 'muted' }))
      : framed(leaderboard(model.finalRanking))
  }
  const currentStatus = status(model.game, model.thinkTimeoutMs, now)
  const children = [ui.text(currentStatus.text, { tone: currentStatus.tone })]
  if (model.game.thinking) {
    const raw = model.game.thinkRaw.replace(/\s+/gu, ' ').trim()
    children.push(ui.text(raw ? `  ${raw.slice(-64)}` : '…', { tone: 'muted' }))
  }
  children.push(ui.divider())
  for (let lower = MIN_BAND_COLUMNS; lower <= MAX_BAND_COLUMNS; lower += BAND_STEP) {
    const when = lower === MAX_BAND_COLUMNS
      ? { minWidth: lower }
      : { minWidth: lower, maxWidth: lower + BAND_STEP - 1 }
    children.push(ui.child(
      ui.code(boardLines(model, Math.max(1, lower - CHROME_COLUMNS)).join('\n'), { language: '' }),
      { when },
    ))
  }
  children.push(ui.divider(), ui.text(HINT_LINE, { tone: 'muted' }))
  return ui.stack.column(children)
}

/** Build one bounded notification node from plain interaction data. */
export function createNoticeView(text, tone = 'default') {
  return ui.text(text, { tone })
}
