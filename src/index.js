/**
 * Canonical Blue v1 composition for the Doudizhu domain and interaction model.
 *
 * @module @dsh-blue/blue-doudizhu
 */

import { validateBluePluginManifestV1 } from '@dsh-blue/blue-api/protocol/v1'
import manifestSource from '../blue.plugin.json' with { type: 'json' }
import {
  PLAYER_NAMES,
  applyPass,
  applyPlay,
  cardLabel,
  createGame,
  heuristicMove,
  parseMove,
  rankMatch,
  settleMatch,
} from './domain.js'
import { mountModelAdapter } from './model-adapter.js'
import { projectRuntime } from './projection.js'
import { createBoardView, createNoticeView } from './view.js'

export const name = '@dsh-blue/blue-doudizhu'
export const inject = ['bluePluginHost']

const parsed = validateBluePluginManifestV1(manifestSource)
if (!parsed.ok) throw new TypeError(`invalid blue.plugin.json: ${parsed.issues[0]?.message ?? 'unknown issue'}`)
const manifest = parsed.value

const SYSTEM_PROMPT = '你是斗地主(3人扑克)的AI玩家。当前轮到你出牌。只输出你选择的牌，编码如下：单张用点数字母(3,4,5,6,7,8,9,0=10,j,q,k,a,2,s=小王,x=大王)；对对子写出两个相同点数(如00)；顺子34567；三带一3334；三带二33344；炸弹3333；王炸sx。若用上面编码无法打不过上家，则输出 p。只输出编码，不要任何解释或多余文字。'
const THINK_TIMEOUT_MS = 30_000

function rejected(message) {
  return { ok: false, code: 'BLUE_ACTION_REJECTED', message }
}

function success() {
  return { ok: true, value: undefined }
}

/** Mount one owner-scoped game runtime into the granted Blue capabilities. */
export function apply(ctx) {
  const opened = ctx.bluePluginHost.open(ctx, manifest)
  if (!opened.ok) return
  const api = opened.value.api
  if (api.commands === undefined || api.overlays === undefined) return

  let disposed = false
  let game = null
  let roundNo = 0
  let nextUid = 0
  let match = { scores: [0, 0, 0], games: 0 }
  let memoOn = false
  let paused = false
  let botMode = 'hybrid'
  let finalRanking = null
  let boardHandle = null
  let noticeSequence = 0
  let driverGeneration = 0
  let activeThinkAbort = null
  let modelAdapter
  let modelEpoch = 0

  const snapshot = () => projectRuntime({
    game,
    match,
    memoOn,
    paused,
    botMode,
    finalRanking,
    thinkTimeoutMs: THINK_TIMEOUT_MS,
  })

  function refreshBoard() {
    if (disposed || boardHandle === null || boardHandle.closed) return
    try {
      boardHandle.refresh()
    } catch {
      // Refresh quotas and owner gaps are transient; the next state change retries.
    }
  }

  function closeBoard() {
    const current = boardHandle
    boardHandle = null
    if (current === null || current.closed) return
    try {
      current.close()
    } catch {
      // Host teardown may already have fenced the retained handle.
    }
  }

  function stopThinking() {
    const current = activeThinkAbort
    activeThinkAbort = null
    current?.abort()
  }

  function invalidateDriver() {
    driverGeneration += 1
    stopThinking()
  }

  function currentRun(token, expectedGame) {
    return !disposed && token === driverGeneration && game === expectedGame
  }

  function notify(text, tone = 'default') {
    if (disposed || api.notifications === undefined) return
    try {
      api.notifications.publish({
        id: `doudizhu.notice.${String(++noticeSequence)}`,
        view: createNoticeView(text, tone),
      })
    } catch {
      // Optional notifications never affect the game or command result.
    }
  }

  function openBoard() {
    if (disposed) return rejected('plugin unloaded')
    if (boardHandle !== null && !boardHandle.closed) {
      refreshBoard()
      return success()
    }
    const result = api.overlays.open({
      id: 'doudizhu.board',
      title: '斗地主',
      capturing: false,
      dismissible: true,
      anchor: 'center',
      width: '86%',
      maxHeight: '80%',
      render: () => createBoardView(snapshot()),
    })
    if (!result.ok) return result
    boardHandle = result.value
    return success()
  }

  function modelLabel() {
    try {
      const selection = modelAdapter?.currentSelection()
      return selection?.provider && selection?.model ? selection.model : ''
    } catch {
      return ''
    }
  }

  function buildPrompt(currentGame, playerIndex) {
    const player = currentGame.players[playerIndex]
    const hand = player.hand.slice().sort((left, right) => left.v - right.v).map(cardLabel).join(' ')
    let text = `你是「${player.name}」(${player.role === 'landlord' ? '地主' : '农民'})。你的手牌：${hand}\n`
    if (currentGame.table) text += `上家「${currentGame.players[currentGame.table.ownerIdx].name}」出的牌：${currentGame.table.cards.map(cardLabel).join('')}\n`
    else text += '你是当前第一个出牌的人，可自由出牌。\n'
    text += `其它玩家剩余：${currentGame.players.map(value => `${value.name} ${String(value.hand.length)}张`).join('，')}\n`
    return `${text}请输出你的出牌编码（只输出答案）：`
  }

  async function modelMove(currentGame, playerIndex, token) {
    const adapter = modelAdapter
    const epoch = modelEpoch
    if (adapter === undefined) throw new Error('model services unavailable')
    const selection = adapter.currentSelection()
    if (!selection?.provider || !selection?.model) throw new Error('model selection unavailable')
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(THINK_TIMEOUT_MS)])
    activeThinkAbort = controller
    currentGame.thinking = true
    currentGame.thinkName = currentGame.players[playerIndex].name
    currentGame.thinkRaw = ''
    currentGame.thinkDeadline = Date.now() + THINK_TIMEOUT_MS
    refreshBoard()
    let output = ''
    try {
      const message = {
        id: `doudizhu-${String(currentGame.round)}-${String(playerIndex)}`,
        role: 'user',
        content: [{ type: 'text', text: buildPrompt(currentGame, playerIndex) }],
        source: { kind: 'user' },
      }
      const stream = adapter.stream({
        provider: selection.provider,
        model: selection.model,
        reasoningEffort: 'high',
        system: SYSTEM_PROMPT,
        messages: [message],
        temperature: 0.3,
        signal,
      })
      for await (const chunk of stream) {
        if (!currentRun(token, currentGame) || modelAdapter !== adapter || modelEpoch !== epoch) throw new Error('stale model result')
        if (chunk?.type === 'reasoning-delta') currentGame.thinkRaw = `${currentGame.thinkRaw}${chunk.text}`.slice(-300)
        if (chunk?.type === 'text-delta') output += chunk.text
        refreshBoard()
      }
      if (!currentRun(token, currentGame) || modelAdapter !== adapter || modelEpoch !== epoch) throw new Error('stale model result')
      return output.trim()
    } finally {
      if (activeThinkAbort === controller) activeThinkAbort = null
      currentGame.thinking = false
      currentGame.thinkRaw = ''
      currentGame.thinkDeadline = 0
      if (game === currentGame && !disposed) refreshBoard()
    }
  }

  function parseModelMove(currentGame, playerIndex, text) {
    const normalized = String(text || '').trim().toLowerCase()
    if (/^(p|pass|不出|过|不要)$/u.test(normalized) || /(^|\s)(pass|不出|过|不要)(\s|$)/u.test(normalized)) return { pass: true }
    const token = normalized.replace(/[^0-9jqka2sx]/gu, '')
    if (!token) return null
    const result = parseMove(currentGame, playerIndex, token)
    return result.error ? null : result
  }

  async function decideBotMove(currentGame, playerIndex, token) {
    if (botMode !== 'heuristic' && modelAdapter !== undefined) {
      try {
        const result = parseModelMove(currentGame, playerIndex, await modelMove(currentGame, playerIndex, token))
        if (result && (result.cards || (result.pass && currentGame.table))) return result
      } catch {
        if (!currentRun(token, currentGame)) throw new Error('stale bot decision')
      }
    }
    if (!currentRun(token, currentGame)) throw new Error('stale bot decision')
    return heuristicMove(currentGame, playerIndex)
  }

  function settleAndRefresh(currentGame, token) {
    if (!currentRun(token, currentGame) || currentGame.stage !== 'ended') return
    settleMatch(match, currentGame)
    notify(currentGame.winner === 'landlord' ? '地主获胜！' : '农民获胜！', 'success')
    refreshBoard()
  }

  async function drive() {
    const token = ++driverGeneration
    const currentGame = game
    if (currentGame === null || disposed) return
    if (currentGame.stage === 'ended') {
      settleAndRefresh(currentGame, token)
      return
    }
    if (currentGame.currentIdx === 0) return
    while (currentRun(token, currentGame) && currentGame.stage === 'play' && !paused && currentGame.currentIdx !== 0) {
      const playerIndex = currentGame.currentIdx
      let move
      try {
        move = await decideBotMove(currentGame, playerIndex, token)
      } catch {
        break
      }
      if (!currentRun(token, currentGame) || paused || currentGame.stage !== 'play' || currentGame.currentIdx !== playerIndex) break
      const playerName = currentGame.players[playerIndex].name
      const fallback = move.fromHeuristic ? '（规则AI）' : ''
      if (move.pass) {
        applyPass(currentGame, playerIndex)
        notify(`${playerName} 不出${fallback}`, 'muted')
      } else {
        applyPlay(currentGame, playerIndex, move)
        notify(`${playerName} 出了 ${move.cards.map(cardLabel).join('')}${fallback}`)
      }
      refreshBoard()
    }
    settleAndRefresh(currentGame, token)
  }

  function scheduleDrive() {
    queueMicrotask(() => {
      if (!disposed) void drive()
    })
  }

  mountModelAdapter(ctx, next => {
    const previous = modelAdapter
    modelAdapter = next
    modelEpoch += 1
    if (previous !== undefined && next === undefined) {
      invalidateDriver()
      scheduleDrive()
    }
  })

  ctx.effect(() => {
    const interval = setInterval(() => {
      if (game?.thinking) refreshBoard()
    }, 1000)
    return () => clearInterval(interval)
  })

  ctx.effect(() => () => {
    disposed = true
    invalidateDriver()
    closeBoard()
    game = null
    finalRanking = null
    modelAdapter = undefined
  })

  function turnDescription() {
    if (game === null) return '无牌局'
    if (game.stage === 'ended') return `已结束：${game.winner === 'landlord' ? '地主胜' : '农民胜'}`
    return `第${String(game.round)}局  轮到：${game.players[game.currentIdx].name}  剩余：${game.players.map(player => `${player.name} ${String(player.hand.length)}张`).join('，')}`
  }

  async function execute(args) {
    if (!args || args.length === 0) {
      notify('/poker new 开始一局；/poker help 查看说明')
      return success()
    }
    const first = String(args[0]).toLowerCase()
    if (first === 'new' || first === 'start') {
      invalidateDriver()
      paused = false
      finalRanking = null
      let humanBid
      if (args[1] !== undefined) {
        const value = Number(args[1])
        if (Number.isFinite(value) && value >= 0) humanBid = Math.min(3, Math.floor(value))
      }
      const created = createGame({ round: roundNo + 1, startUid: nextUid, humanBid })
      nextUid = created.nextUid
      if (!created.ok) {
        notify(created.error)
        return rejected(created.error)
      }
      roundNo += 1
      game = created.game
      notify(`新局开始！地主：${game.players[game.landlord].name}；底牌 ${game.bottom.map(cardLabel).join(' ')}。Bot 决策模型：${modelLabel() || '启发式AI'}`, 'success')
      const board = openBoard()
      if (!board.ok) notify(`牌面打开失败（${board.code}），牌局继续；稍后可用 /poker show 重试`, 'warning')
      scheduleDrive()
      return success()
    }
    if (first === 'help' || first === 'rules') {
      notify('/poker new 开局；看着牌面直接输入：出牌 /poker <编码>、不出 /poker p（0=10 jqka2 sx=王炸）。/poker hide 收起牌面 / /poker show 展开；/poker pause 暂停 Bot；/poker stop 停止牌局；/poker score 记分；/poker end 排行榜；/poker memo 记牌器；/poker bot 模型Bot', 'muted')
      return success()
    }
    if (first === 'status') {
      notify(turnDescription())
      return success()
    }
    if (first === 'score') {
      notify(`局分：${match.scores.map((score, index) => `${PLAYER_NAMES[index]} ${String(score)}`).join('  | ')}（共 ${String(match.games)} 局）`, 'muted')
      return success()
    }
    if (first === 'stop' || first === 'quit' || first === 'exit') {
      invalidateDriver()
      closeBoard()
      game = null
      paused = false
      notify('牌局已停止（不计分）。/poker new 开始新一局', 'muted')
      return success()
    }
    if (first === 'pause') {
      paused = true
      invalidateDriver()
      notify('已暂停：Bot 停止出牌（牌面保持可见）；/poker resume 恢复', 'muted')
      return success()
    }
    if (first === 'hide' || first === 'close') {
      closeBoard()
      notify('牌面已收起（牌局继续）；/poker show 重新打开', 'muted')
      return success()
    }
    if (first === 'show' || first === 'resume') {
      if (first === 'resume') paused = false
      if (game === null) {
        if (finalRanking !== null) {
          const board = openBoard()
          if (!board.ok) notify(`牌面打开失败（${board.code}）`, 'warning')
          return success()
        }
        notify('当前没有进行中的牌局。/poker new 开始一局')
        return rejected('no game')
      }
      const board = openBoard()
      if (!board.ok) notify(`牌面打开失败（${board.code}），牌局继续`, 'warning')
      else notify('牌面已展开', 'success')
      scheduleDrive()
      return success()
    }
    if (first === 'end' || first === 'finish') {
      invalidateDriver()
      finalRanking = rankMatch(match)
      const games = match.games
      match = { scores: [0, 0, 0], games: 0 }
      game = null
      paused = false
      notify(`比赛结束！共 ${String(games)} 局，排行榜见面板`, 'success')
      const board = openBoard()
      if (!board.ok) notify(`排行榜打开失败（${board.code}）`, 'warning')
      return success()
    }
    if (first === 'memo') {
      const value = args[1] ? String(args[1]).toLowerCase() : (memoOn ? 'off' : 'on')
      memoOn = value !== 'off'
      notify(`记牌器：${memoOn ? '开' : '关'}`, 'muted')
      refreshBoard()
      return success()
    }
    if (first === 'heuristic' || first === 'bot') {
      botMode = first === 'heuristic' ? 'heuristic' : 'hybrid'
      invalidateDriver()
      notify(`Bot 决策模式：${botMode}${botMode === 'hybrid' ? `（模型:${modelLabel() || '未配置'}）` : ''}`, 'muted')
      scheduleDrive()
      return success()
    }
    if (game === null) {
      notify('还没有牌局，先 /poker new')
      return rejected('no game')
    }
    if (game.stage !== 'play') {
      notify('牌局已结束')
      return rejected('ended')
    }
    if (paused) {
      notify('牌局已暂停，/poker resume 恢复')
      return rejected('paused')
    }
    if (game.currentIdx !== 0) {
      notify(`还不是你的回合（当前 ${game.players[game.currentIdx].name}）`)
      return rejected('not your turn')
    }
    const move = parseMove(game, 0, args.join(''))
    if (move.error) {
      notify(move.error, 'danger')
      return rejected(move.error)
    }
    if (move.pass) {
      applyPass(game, 0)
      notify('你选择不出', 'muted')
    } else {
      applyPlay(game, 0, move)
      notify(`你出了 ${move.cards.map(cardLabel).join('')}`, 'success')
    }
    refreshBoard()
    scheduleDrive()
    return success()
  }

  const registered = api.commands.register({ id: 'poker', label: '斗地主牌局', execute })
  if (!registered.ok) throw new Error(`command register failed: ${registered.message}`)
}
