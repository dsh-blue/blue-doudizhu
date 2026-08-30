export const name = '@dsh-blue/blue-doudizhu'
export const inject = ['bluePluginHost']

export function apply(ctx) {
  // Blue plugin API (Beta host 1.0.0-beta.1): the inline manifest mirrors the
  // shipped blue.plugin.json. Capabilities: commands, overlays,
  // notifications.publish ("dock"/"notifications" were removed upstream).
  const BLUE_API_RANGE = '^1.0.0-beta.1'
  const CAPABILITIES = ['commands', 'overlays', 'notifications.publish']

  // ---------- constants ----------
  const SUITS = ['♠', '♥', '♦', '♣']
  const RANK_CHAR = ['3', '4', '5', '6', '7', '8', '9', '0', 'J', 'Q', 'K', 'A', '2', 's', 'x']
  const RANK_VAL = { '3': 0, '4': 1, '5': 2, '6': 3, '7': 4, '8': 5, '9': 6, '0': 7, 'j': 8, 'q': 9, 'k': 10, 'a': 11, '2': 12, 's': 13, 'x': 14 }
  const SYSTEM_PROMPT = '你是斗地主(3人扑克)的AI玩家。当前轮到你出牌。只输出你选择的牌，编码如下：单张用点数字母(3,4,5,6,7,8,9,0=10,j,q,k,a,2,s=小王,x=大王)；对对子写出两个相同点数(如00)；顺子34567；三带一3334；三带二33344；炸弹3333；王炸sx。若用上面编码无法打不过上家，则输出 p。只输出编码，不要任何解释或多余文字。'
  const THINK_TIMEOUT_MS = 30000

  // ---------- card helpers ----------
  let nextUid = 0
  function cardLabel(c) { return RANK_CHAR[c.v] + (c.v < 13 ? c.suit : '') }
  function buildDeck() {
    const deck = []
    for (let v = 0; v <= 12; v++) for (const s of SUITS) deck.push({ v, suit: s, uid: 'c' + (nextUid++) })
    deck.push({ v: 13, suit: '', uid: 'c' + (nextUid++) })
    deck.push({ v: 14, suit: '', uid: 'c' + (nextUid++) })
    return deck
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t } return a }

  // ---------- pattern classification ----------
  function classifyRanks(vals) {
    vals = vals.slice().sort((a, b) => a - b)
    const n = vals.length
    const count = new Map()
    for (const v of vals) count.set(v, (count.get(v) || 0) + 1)
    const uniq = [...count.keys()].sort((a, b) => a - b)
    // rocket
    if (n === 2 && count.has(13) && count.has(14)) return { type: 'rocket', rank: 99, count: 2, seqHigh: 14 }
    // bomb
    if (n === 4 && uniq.length === 1) return { type: 'bomb', rank: uniq[0], count: 4, seqHigh: uniq[0] }
    // single/pair/triple
    if (n === 1) return { type: 'single', rank: uniq[0], count: 1, seqHigh: uniq[0] }
    if (n === 2 && uniq.length === 1 && uniq[0] < 13) return { type: 'pair', rank: uniq[0], count: 2, seqHigh: uniq[0] }
    if (n === 3 && uniq.length === 1) return { type: 'triple', rank: uniq[0], count: 3, seqHigh: uniq[0] }

    const groups = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])
    const trip = groups.filter(g => g[1] === 3)
    const pair = groups.filter(g => g[1] === 2)
    const single = groups.filter(g => g[1] === 1)
    const quad = groups.find(g => g[1] === 4)
    // triple + single / triple + pair
    if (n === 4 && trip.length === 1 && single.length === 1) return { type: 'triple1', rank: trip[0][0], count: 4, seqHigh: trip[0][0] }
    if (n === 5 && trip.length === 1 && pair.length === 1) return { type: 'triple2', rank: trip[0][0], count: 5, seqHigh: trip[0][0] }
    // four + two
    if (quad) {
      if (n === 6) return { type: 'four2', rank: quad[0], count: 6, seqHigh: quad[0] }
      if (n === 8 && pair.length === 2) return { type: 'four2', rank: quad[0], count: 8, seqHigh: quad[0] }
    }
    // straight (>=5 distinct consecutive, 3..A)
    if (n >= 5 && uniq.length === n && uniq.every(v => v <= 11)) {
      for (let i = 1; i < uniq.length; i++) if (uniq[i] !== uniq[i - 1] + 1) return null
      return { type: 'straight', rank: uniq[n - 1], count: n, seqHigh: uniq[n - 1] }
    }
    // double sequence (>=3 consecutive pairs, 3..A)
    if (n >= 6 && n % 2 === 0 && uniq.every(v => v <= 11) && uniq.every(v => count.get(v) === 2)) {
      for (let i = 1; i < uniq.length; i++) if (uniq[i] !== uniq[i - 1] + 1) return null
      return { type: 'doubleSeq', rank: uniq[uniq.length - 1], count: n, seqHigh: uniq[uniq.length - 1] }
    }
    // airplane: consecutive triple-runs (3..A) with optional wings
    const tripleVs = [...count.entries()].filter(e => e[1] === 3 && e[0] <= 11).map(e => e[0]).sort((a, b) => a - b)
    // find the longest consecutive run of triple values
    let run = []
    for (let i = 0; i < tripleVs.length; i++) {
      let r = [tripleVs[i]]
      while (i + 1 < tripleVs.length && tripleVs[i + 1] === tripleVs[i] + 1) { r.push(tripleVs[i + 1]); i++ }
      if (r.length > run.length) run = r
    }
    if (run.length >= 2) {
      const k = run.length
      const wings = n - 3 * k
      if (wings === 0) return { type: 'plane', rank: run[k - 1], count: n, seqHigh: run[k - 1] }
      if (wings === k || wings === 2 * k) return { type: 'plane', rank: run[k - 1], count: n, seqHigh: run[k - 1] }
    }
    return null
  }

  function beats(c, t) {
    if (!t) return true
    if (c.type === 'rocket') return t.type !== 'rocket'
    if (t.type === 'rocket') return false
    if (c.type === 'bomb') return t.type !== 'bomb' || c.rank > t.rank
    if (t.type === 'bomb') return false
    if (c.type !== t.type) return false
    if (c.count !== t.count) return false
    if (c.type === 'straight' || c.type === 'doubleSeq' || c.type === 'plane') return c.seqHigh > t.seqHigh
    return c.rank > t.rank
  }

  // ---------- candidate generation (for bots) ----------
  function generateCandidates(hand) {
    const byV = new Map()
    for (const c of hand) { const a = byV.get(c.v) || []; a.push(c); byV.set(c.v, a) }
    const vals = [...byV.keys()].sort((a, b) => a - b)
    const out = []
    for (const v of vals) out.push({ cards: byV.get(v).slice(0, 1), combo: { type: 'single', rank: v, count: 1, seqHigh: v } })
    for (const v of vals) if (byV.get(v).length >= 2 && v < 13) out.push({ cards: byV.get(v).slice(0, 2), combo: { type: 'pair', rank: v, count: 2, seqHigh: v } })
    for (const v of vals) if (byV.get(v).length >= 3 && v < 13) out.push({ cards: byV.get(v).slice(0, 3), combo: { type: 'triple', rank: v, count: 3, seqHigh: v } })
    for (const t of vals) {
      if (byV.get(t).length >= 3 && t < 13) {
        const tri = byV.get(t).slice(0, 3)
        for (const w of vals) if (w !== t) { out.push({ cards: [...tri, byV.get(w)[0]], combo: { type: 'triple1', rank: t, count: 4, seqHigh: t } }); break }
        for (const w of vals) if (w !== t && byV.get(w).length >= 2) { out.push({ cards: [...tri, ...byV.get(w).slice(0, 2)], combo: { type: 'triple2', rank: t, count: 5, seqHigh: t } }); break }
      }
    }
    for (const len of [5, 6, 7, 8, 9, 10, 11, 12]) {
      for (let s = 0; s + len - 1 <= 11; s++) {
        let ok = true; const cards = []
        for (let off = 0; off < len; off++) { const v = s + off; if (!byV.has(v)) { ok = false; break }; cards.push(byV.get(v)[0]) }
        if (ok) out.push({ cards, combo: { type: 'straight', rank: s + len - 1, count: len, seqHigh: s + len - 1 } })
      }
    }
    for (const len of [3, 4, 5, 6]) {
      for (let s = 0; s + len - 1 <= 11; s++) {
        let ok = true; const cards = []
        for (let off = 0; off < len; off++) { const v = s + off; if ((byV.get(v) || []).length < 2) { ok = false; break }; cards.push(...byV.get(v).slice(0, 2)) }
        if (ok) out.push({ cards, combo: { type: 'doubleSeq', rank: s + len - 1, count: len * 2, seqHigh: s + len - 1 } })
      }
    }
    for (const v of vals) if (byV.get(v).length === 4) out.push({ cards: byV.get(v).slice(0, 4), combo: { type: 'bomb', rank: v, count: 4, seqHigh: v } })
    if (byV.has(13) && byV.has(14)) out.push({ cards: [byV.get(13)[0], byV.get(14)[0]], combo: { type: 'rocket', rank: 99, count: 2, seqHigh: 14 } })
    return out
  }

  // ---------- rendering (Blue UI wire nodes) ----------
  function cardRow(cards, gap, pad) {
    const g = ' '.repeat(gap)
    const top = cards.map(() => '┌───┐').join(g)
    const mid = cards.map(c => '│' + (cardLabel(c) + '  ').slice(0, 3) + '│').join(g)
    const bot = cards.map(() => '└───┘').join(g)
    return [' '.repeat(pad) + top, ' '.repeat(pad) + mid, ' '.repeat(pad) + bot]
  }
  // Hand layout: cards grouped tightly (single-space gaps — scattered cards
  // are hard to read as a hand), rows balanced, and the whole block centered
  // in the width budget so it occupies the board instead of hugging a side.
  // Pure-box glyphs only, so cell math is exact — unlike CJK text lines,
  // these can be padded safely.
  function handArt(hand, width) {
    const CARD_W = 5 // ┌───┐
    const GAP = 1
    const n = hand.length
    if (n === 0) return []
    const maxPerRow = Math.max(1, Math.min(n, Math.floor((width + GAP) / (CARD_W + GAP))))
    const rowCount = Math.ceil(n / maxPerRow)
    const perRow = Math.ceil(n / rowCount)
    const lines = []
    for (let i = 0; i < n; i += perRow) {
      const row = hand.slice(i, Math.min(i + perRow, n))
      const rowWidth = CARD_W * row.length + GAP * (row.length - 1)
      const pad = Math.max(0, Math.floor((width - rowWidth) / 2))
      lines.push(...cardRow(row, GAP, pad))
    }
    return lines
  }
  function remainSec(st) { return st && st.thinkDeadline ? Math.max(0, Math.ceil((st.thinkDeadline - Date.now()) / 1000)) : 0 }
  function thinkLines(st) {
    const raw = (st.thinkRaw || '').replace(/\s+/g, ' ').trim()
    return raw ? ['  ' + raw.slice(-64)] : ['…']
  }
  function memoLine(st) {
    const parts = []
    for (let v = 0; v <= 14; v++) { const remain = totalOfRank(v) - (st.playedCounts[v] || 0); parts.push(RANK_CHAR[v] + ':' + remain) }
    return '记牌(剩余未出): ' + parts.join(' ')
  }
  function statusText(st) {
    if (st.thinking) return { text: `🤔 ${st.thinkName} 思考中… 剩 ${remainSec(st)}s（最多等 ${THINK_TIMEOUT_MS / 1000}s）`, tone: 'default' }
    if (st.stage === 'ended') {
      const won = st.winner === st.players[0].role
      return { text: `★★ ${won ? '你赢了！' : '你输了！'}（${st.winner === 'landlord' ? '地主获胜' : '农民获胜'}）★★`, tone: won ? 'success' : 'danger' }
    }
    if (st.currentIdx === 0) return { text: '→ 轮到你了！  出牌：/poker <编码>   不出：/poker p', tone: 'accent' }
    return { text: `→ ${st.players[st.currentIdx].name} 出牌中…`, tone: 'default' }
  }
  function playedNotation(p) { return p.played ? p.played.cards.map(cardLabel).join('') : (p.playedDisplay || '—') }

  // Overlay content. The board is NON-capturing: the main editor keeps
  // keyboard focus, so the player types /poker moves while looking at the
  // cards — no need to close anything. Hiding (/poker hide) never interrupts
  // the game; /poker stop terminates it.
  //
  // The renderer never centers or stretches plugin content in the main
  // screen, so width is used through the primitives that do span it:
  // divider nodes (always full overlay width) and responsive `when`
  // children. Each width band knows its column budget, so the hand cluster
  // is centered against that exact budget.
  const HINT_LINE = '直接输入 /poker <编码> 出牌 · /poker p 不出 · /poker hide 收起牌面 · /poker stop 停止'
  // overlay viewport columns -> inner text columns (surface padding + chrome)
  const BAND_STEP = 4
  const MIN_BAND_COLUMNS = 56
  const MAX_BAND_COLUMNS = 100
  const CHROME_COLUMNS = 4
  function boardLines(st, width) {
    const lines = []
    lines.push(`第${st.round}局 地主:${st.players[st.landlord].name}(底牌 ${st.bottom.map(cardLabel).join(' ')})  局分 ${st.players.map(p => p.name[0] + match.scores[p.idx]).join(' ')}`)
    if (memoOn) lines.push(memoLine(st))
    for (const p of st.players) {
      if (p.idx === 0) continue
      const turnMark = st.currentIdx === p.idx && st.stage === 'play' ? '→ ' : '  '
      const last = p.playedDisplay || (p.played ? playedNotation(p) : '—')
      lines.push(`${turnMark}${p.name} [${p.role === 'landlord' ? '地主' : '农民'}] 剩${p.hand.length}张   本回合: ${last}`)
    }
    if (st.table) {
      const owner = st.players[st.table.ownerIdx]
      lines.push(`桌面(上家 ${owner.name} 出)：${playedNotation(owner)}`)
    } else {
      lines.push('本轮无牌可压（新的领出回合）')
    }
    const me = st.players[0]
    lines.push(`你的手牌 [${me.role === 'landlord' ? '地主' : '农民'}] 剩${me.hand.length}张：`)
    const hand = me.hand.slice().sort((a, b) => a.v - b.v)
    lines.push(...handArt(hand, width))
    return lines
  }
  function boardNode() {
    const st = state
    if (!st) return finalNode()
    const status = statusText(st)
    const children = [
      { node: { kind: 'text', content: status.text, tone: status.tone } },
    ]
    if (st.thinking) for (const l of thinkLines(st)) children.push({ node: { kind: 'text', content: l, tone: 'muted' } })
    children.push({ node: { kind: 'divider' } })
    // One hand layout per width band; the live band centers the tight card
    // cluster against its own column budget (band minimum, so wider viewports
    // only leave slack around the cluster, never a truncation).
    for (let lo = MIN_BAND_COLUMNS; lo <= MAX_BAND_COLUMNS; lo += BAND_STEP) {
      const width = lo - CHROME_COLUMNS
      children.push({
        node: { kind: 'code', code: boardLines(st, width).join('\n'), language: '' },
        when: { minWidth: lo, maxWidth: lo + BAND_STEP - 1 },
      })
    }
    children.push({ node: { kind: 'divider' } })
    children.push({ node: { kind: 'text', content: HINT_LINE, tone: 'muted' } })
    return { kind: 'stack', direction: 'column', gap: 0, children }
  }
  function framed(node) {
    return { kind: 'stack', direction: 'column', gap: 0, children: [{ node: { kind: 'divider' } }, { node }, { node: { kind: 'divider' } }] }
  }
  function finalNode() {
    if (finalBoard) return framed(finalBoard)
    return framed({ kind: 'text', content: '暂无牌局。/poker new 开始一局斗地主！', tone: 'muted' })
  }

  // ---------- game & match state ----------
  let state = null
  let roundNo = 0
  const NAMES = ['你', 'Bot-1', 'Bot-2']
  let match = { scores: [0, 0, 0], games: 0 }
  let memoOn = false
  let finalBoard = null
  let paused = false
  let driverToken = 0
  function cancelDriver() { driverToken++ }
  function stopTheThink() { if (state && state.thinkAbort) state.thinkAbort.abort() }
  function totalOfRank(v) { return v < 13 ? 4 : 1 }
  function settle() {
    if (!state || state.settled || state.stage !== 'ended') return
    state.settled = true
    const base = state.base || 1
    const land = state.landlord
    if (state.winner === 'landlord') { match.scores[land] += 2 * base; for (const f of [0, 1, 2]) if (f !== land) match.scores[f] -= base }
    else { match.scores[land] -= 2 * base; for (const f of [0, 1, 2]) if (f !== land) match.scores[f] += base }
    match.games += 1
  }

  function nextPlayer(i) { return (i + 1) % 3 }
  function strengthBid(cards) {
    const byV = {}
    let bombs = 0
    for (const c of cards) { byV[c.v] = (byV[c.v] || 0) + 1 }
    for (const v of Object.keys(byV)) if (byV[v] === 4) bombs++
    let s = 0
    if (byV[13]) s += 1
    if (byV[14]) s += 2
    s += (byV[12] || 0) // number of 2s
    s += bombs
    return Math.max(0, Math.min(3, s >= 5 ? 3 : s >= 3 ? 2 : s >= 1 ? 1 : 0))
  }

  function startGame(bidArg) {
    const deck = shuffle(buildDeck())
    const hands = [deck.slice(0, 17), deck.slice(17, 34), deck.slice(34, 51)]
    const bottom = deck.slice(51, 54)
    const players = [
      { idx: 0, name: '你', role: '', hand: hands[0], isBot: false, played: null, playedDisplay: '' },
      { idx: 1, name: 'Bot-1', role: '', hand: hands[1], isBot: true, played: null, playedDisplay: '' },
      { idx: 2, name: 'Bot-2', role: '', hand: hands[2], isBot: true, played: null, playedDisplay: '' },
    ]
    const humanBid = bidArg !== undefined ? bidArg : strengthBid(players[0].hand)
    const bids = [humanBid, strengthBid(players[1].hand), strengthBid(players[2].hand)]
    const maxBid = Math.max(...bids)
    if (maxBid === 0) return { error: '三家都不叫，重新洗牌（请再次 /poker new）' }
    const landlordIdx = bids.lastIndexOf(maxBid)
    for (const p of players) p.role = p.idx === landlordIdx ? 'landlord' : 'farmer'
    players[landlordIdx].hand = [...players[landlordIdx].hand, ...bottom]
    roundNo += 1
    state = { round: roundNo, stage: 'play', players, currentIdx: landlordIdx, table: null, passStreak: 0, bottom, landlord: landlordIdx, winner: null, base: Math.max(1, bids[landlordIdx]), playedCounts: {}, settled: false }
    return null
  }

  function parseAndValidate(idx, str) {
    const t = String(str).trim().toLowerCase()
    if (/^(p|pass|不出|过|不要)$/.test(t)) return { pass: true }
    const tokens = t.replace(/[\s,]/g, '').split('')
    const vals = tokens.map(ch => RANK_VAL[ch]).filter(v => v !== undefined)
    if (vals.length === 0) return { error: '无法识别出牌编码' }
    const needed = new Map()
    for (const v of vals) needed.set(v, (needed.get(v) || 0) + 1)
    const hand = state.players[idx].hand
    const byV = new Map()
    for (const c of hand) { const a = byV.get(c.v) || []; a.push(c); byV.set(c.v, a) }
    const chosen = []
    for (const [v, qty] of needed) {
      if (!byV.has(v) || byV.get(v).length < qty) return { error: '手牌中该点数数量不足' }
      chosen.push(...byV.get(v).slice(0, qty))
    }
    const combo = classifyRanks(chosen.map(c => c.v))
    if (!combo) return { error: '非法的牌型' }
    if (state.table && !beats(combo, state.table.combo)) return { error: '压不过上家' }
    return { cards: chosen, combo }
  }

  function applyPlay(idx, move) {
    const pl = state.players[idx]
    const ids = new Set(move.cards.map(c => c.uid))
    pl.hand = pl.hand.filter(c => !ids.has(c.uid))
    pl.played = { cards: move.cards, combo: move.combo }
    pl.playedDisplay = move.cards.map(cardLabel).join('')
    pl.passed = false
    state.table = { cards: move.cards, combo: move.combo, ownerIdx: idx }
    state.passStreak = 0
    for (const c of move.cards) state.playedCounts[c.v] = (state.playedCounts[c.v] || 0) + 1
    if (pl.hand.length === 0) { state.stage = 'ended'; state.winner = pl.role; return }
    state.currentIdx = nextPlayer(idx)
  }
  function applyPass(idx) {
    const pl = state.players[idx]
    pl.played = null
    pl.playedDisplay = '不出'
    pl.passed = true
    state.passStreak += 1
    if (state.passStreak >= 2 && state.table) {
      state.currentIdx = state.table.ownerIdx
      state.table = null
      state.passStreak = 0
      for (const p of state.players) { p.passed = false; p.playedDisplay = '' }
    } else {
      state.currentIdx = nextPlayer(idx)
    }
  }

  // ---------- bot decision (hybrid: local model first, heuristic fallback) ----------
  function sortGen(hand) { return hand.slice().sort((a, b) => a.v - b.v) }
  function heuristicBot(idx) {
    const hand = state.players[idx].hand
    const cands = generateCandidates(hand)
    let legal
    if (state.table) legal = cands.filter(c => beats(c.combo, state.table.combo))
    else legal = cands.filter(c => c.combo.type !== 'bomb' && c.combo.type !== 'rocket')
    if (!legal || legal.length === 0) return { pass: true }
    if (state.table) legal.sort((a, b) => a.combo.rank - b.combo.rank || a.combo.count - b.combo.count)
    else legal.sort((a, b) => b.combo.count - a.combo.count || a.combo.rank - b.combo.rank)
    return legal[0]
  }

  function buildPrompt(idx) {
    const pl = state.players[idx]
    const hand = sortGen(pl.hand).map(cardLabel).join(' ')
    let p = `你是「${pl.name}」(${pl.role === 'landlord' ? '地主' : '农民'})。你的手牌：${hand}\n`
    if (state.table) p += `上家「${state.players[state.table.ownerIdx].name}」出的牌：${state.table.cards.map(cardLabel).join('')}\n`
    else p += '你是当前第一个出牌的人，可自由出牌。\n'
    p += '其它玩家剩余：' + state.players.map(pl => pl.name + ' ' + pl.hand.length + '张').join('，') + '\n'
    p += '请输出你的出牌编码（只输出答案）：'
    return p
  }

  async function llmMove(idx) {
    const llm = ctx.get('llm')
    const adm = ctx.get('agentDefaultModel')
    if (!llm || !adm) throw new Error('llm unavailable')
    const sel = adm.currentSelection()
    if (!sel || !sel.provider || !sel.model) throw new Error('no model selection')
    const name = state.players[idx].name
    state.thinking = true
    state.thinkName = name
    state.thinkRaw = ''
    state.thinkDeadline = Date.now() + THINK_TIMEOUT_MS
    const msg = { id: 'm' + Math.random().toString(36).slice(2), role: 'user', content: [{ type: 'text', text: buildPrompt(idx) }], source: { kind: 'user' } }
    let ac
    try { ac = new AbortController() } catch (e) { ac = null }
    let timer = 0
    if (ac) timer = setTimeout(() => ac.abort(), THINK_TIMEOUT_MS)
    state.thinkAbort = ac
    refreshBoard()
    let out = ''
    try {
      const stream = llm.stream({ provider: sel.provider, model: sel.model, reasoningEffort: 'high', system: SYSTEM_PROMPT, messages: [msg], temperature: 0.3, signal: ac ? ac.signal : undefined })
      for await (const c of stream) {
        if (c && c.type === 'reasoning-delta') state.thinkRaw = (state.thinkRaw + c.text).slice(-300)
        if (c && c.type === 'text-delta') out += c.text
        const now = Date.now()
        if (now > state.thinkDeadline) throw new Error('model timeout')
      }
      return out.trim()
    } finally {
      if (timer) clearTimeout(timer)
      state.thinking = false
      state.thinkRaw = ''
      state.thinkDeadline = 0
      state.thinkAbort = null
    }
  }

  function parseBotText(text) {
    const t = String(text || '').trim().toLowerCase()
    if (/^(p|pass|不出|过|不要)$/.test(t)) return { pass: true }
    if (/(^|\s)(pass|不出|过|不要)(\s|$)/.test(t)) return { pass: true }
    const token = t.replace(/[^0-9jqka2sx]/g, '')
    if (!token) return null
    const res = parseAndValidate(state.currentIdx, token)
    return res.error ? null : res
  }

  function modelLabel() {
    const adm = ctx.get('agentDefaultModel')
    try { const s = adm && adm.currentSelection(); if (s && s.provider && s.model) return s.model } catch (e) {}
    return ''
  }

  async function decideBotMove(idx) {
    if (botMode !== 'heuristic') {
      try {
        const text = await llmMove(idx)
        const res = parseBotText(text)
        if (res && (res.cards || (res.pass && state.table))) return res
      } catch (e) { /* fallback */ }
    }
    return { ...heuristicBot(idx), fromHeuristic: true }
  }

  // ---------- notifications ----------
  let notifications = null
  function notify(text, tone) {
    if (!notifications) return
    // Best-effort transient notice; quota/refusal is non-fatal by design.
    try {
      notifications.publish({ id: 'ddz-note-' + Math.random().toString(36).slice(2), view: { kind: 'text', content: text, tone: tone || 'default' } })
    } catch (e) { /* host returns structured refusals, never throws */ }
  }

  // ---------- game driver ----------
  let botMode = 'hybrid'
  async function drive() {
    const token = ++driverToken
    if (!state) return
    if (state.stage === 'ended') { if (token === driverToken) { settle(); notify(state.winner === 'landlord' ? '地主获胜！' : '农民获胜！', 'success'); refreshBoard() } return }
    if (state.currentIdx === 0) return
    while (state && state.stage === 'play' && !paused && state.currentIdx !== 0) {
      if (token !== driverToken) break
      const idx = state.currentIdx
      let mv
      try { mv = await decideBotMove(idx) } catch (e) { break }
      if (paused || token !== driverToken || state.stage !== 'play' || state.currentIdx !== idx || !state) break
      const name = state.players[idx].name
      const tag = mv.fromHeuristic ? '（规则AI）' : ''
      if (mv.pass) { applyPass(idx); notify(`${name} 不出${tag}`, 'muted') }
      else { applyPlay(idx, mv); notify(`${name} 出了 ${mv.cards.map(cardLabel).join('')}${tag}`, 'default') }
      refreshBoard()
    }
    if (state && state.stage === 'ended' && token === driverToken) { settle(); notify(state.winner === 'landlord' ? '地主获胜！' : '农民获胜！', 'success'); refreshBoard() }
  }

  // ---------- overlay board ----------
  // Non-capturing: the editor stays focused, the player types /poker <编码>
  // while the board is visible; the board live-refreshes after every move.
  // No user gesture is needed to open a non-capturing overlay.
  let api = null
  let boardHandle = null
  function refreshBoard() {
    if (boardHandle && !boardHandle.closed) {
      try { boardHandle.refresh() } catch (e) { /* rate-limited refresh is non-fatal */ }
    }
  }
  function closeBoard() {
    if (boardHandle && !boardHandle.closed) boardHandle.close()
  }
  function openBoard() {
    if (!api || !api.overlays) return { ok: false, code: 'BLUE_CAPABILITY_ABSENT', message: 'overlays capability unavailable' }
    if (boardHandle && !boardHandle.closed) { refreshBoard(); return { ok: true, value: undefined } }
    const opened = api.overlays.open({
      id: 'doudizhu.board',
      title: '斗地主',
      capturing: false,
      dismissible: true,
      anchor: 'center',
      width: '86%',
      maxHeight: '80%',
      render: boardNode,
    })
    if (!opened.ok) return opened
    boardHandle = opened.value
    return { ok: true, value: undefined }
  }

  // Keep the "thinking" countdown live while the board is visible. The
  // interval is owned by this plugin's Fiber and dies with it.
  ctx.effect(() => {
    const iv = setInterval(() => {
      if (state && state.thinking) refreshBoard()
    }, 1000)
    return () => clearInterval(iv)
  })

  // ---------- leaderboard ----------
  function leaderboardView() {
    const order = [0, 1, 2].sort((a, b) => match.scores[b] - match.scores[a])
    const lines = ['【排行榜】']
    let rank = 1
    for (const i of order) { lines.push(`${rank}. ${NAMES[i]}   ${match.scores[i]} 分`); rank++ }
    lines.push(`（共 ${match.games} 局）`)
    return { kind: 'code', code: lines.join('\n'), language: '' }
  }

  // ---------- command handling ----------
  async function execute(args) {
    if (!args || args.length === 0) { notify('/poker new 开始一局；/poker help 查看说明'); return { ok: true, value: undefined } }
    const first = String(args[0]).toLowerCase()
    if (first === 'new' || first === 'start') {
      cancelDriver(); stopTheThink(); paused = false
      let bidArg
      if (args[1] !== undefined) { const n = Number(args[1]); if (Number.isFinite(n) && n >= 0) bidArg = Math.min(3, Math.floor(n)) }
      const err = startGame(bidArg)
      if (err) { notify(err.error); return { ok: false, code: 'BLUE_ACTION_REJECTED', message: err.error } }
      notify(`新局开始！地主：${state.players[state.landlord].name}；底牌 ${state.bottom.map(cardLabel).join(' ')}。Bot 决策模型：${modelLabel() || '启发式AI'}`, 'success')
      const opened = openBoard()
      if (!opened.ok) notify(`牌面打开失败（${opened.code}），牌局继续；稍后可用 /poker show 重试`, 'warning')
      drive()
      return { ok: true, value: undefined }
    }
    if (first === 'help' || first === 'rules') {
      notify('/poker new 开局；看着牌面直接输入：出牌 /poker <编码>、不出 /poker p（0=10 jqka2 sx=王炸）。/poker hide 收起牌面 / /poker show 展开；/poker pause 暂停 Bot；/poker stop 停止牌局；/poker score 记分；/poker end 排行榜；/poker memo 记牌器；/poker bot 模型Bot', 'muted')
      return { ok: true, value: undefined }
    }
    if (first === 'status') { notify(state ? turnDesc() : '当前无牌局'); return { ok: true, value: undefined } }
    if (first === 'score') { notify(`局分：${match.scores.map((s, i) => NAMES[i] + ' ' + s).join('  |  ')}（共 ${match.games} 局）`, 'muted'); return { ok: true, value: undefined } }
    if (first === 'stop' || first === 'quit' || first === 'exit') {
      cancelDriver(); stopTheThink(); closeBoard()
      state = null; paused = false
      notify('牌局已停止（不计分）。/poker new 开始新一局', 'muted')
      return { ok: true, value: undefined }
    }
    if (first === 'pause') {
      paused = true; stopTheThink()
      notify('已暂停：Bot 停止出牌（牌面保持可见）；/poker resume 恢复', 'muted')
      return { ok: true, value: undefined }
    }
    if (first === 'hide' || first === 'close') {
      closeBoard()
      notify('牌面已收起（牌局继续）；/poker show 重新打开', 'muted')
      return { ok: true, value: undefined }
    }
    if (first === 'show' || first === 'resume') {
      if (first === 'resume') paused = false
      if (!state) {
        if (finalBoard) { const opened = openBoard(); if (!opened.ok) notify(`牌面打开失败（${opened.code}）`, 'warning'); return { ok: true, value: undefined } }
        notify('当前没有进行中的牌局。/poker new 开始一局')
        return { ok: false, code: 'BLUE_ACTION_REJECTED', message: 'no game' }
      }
      const opened = openBoard()
      if (!opened.ok) notify(`牌面打开失败（${opened.code}），牌局继续`, 'warning')
      else notify('牌面已展开', 'success')
      drive()
      return { ok: true, value: undefined }
    }
    if (first === 'end' || first === 'finish') {
      cancelDriver(); stopTheThink()
      finalBoard = leaderboardView()
      const n = match.games
      match = { scores: [0, 0, 0], games: 0 }
      state = null; paused = false
      notify(`比赛结束！共 ${n} 局，排行榜见面板`, 'success')
      const opened = openBoard()
      if (!opened.ok) notify(`排行榜打开失败（${opened.code}）`, 'warning')
      return { ok: true, value: undefined }
    }
    if (first === 'memo') {
      const v = args[1] ? String(args[1]).toLowerCase() : (memoOn ? 'off' : 'on')
      memoOn = v !== 'off'
      notify('记牌器：' + (memoOn ? '开' : '关'), 'muted')
      refreshBoard()
      return { ok: true, value: undefined }
    }
    if (first === 'heuristic' || first === 'bot') { botMode = first === 'heuristic' ? 'heuristic' : 'hybrid'; notify(`Bot 决策模式：${botMode}${botMode === 'hybrid' ? '（模型:' + (modelLabel() || '未配置') + '）' : ''}`, 'muted'); return { ok: true, value: undefined } }
    // default: treat as a move
    if (!state) { notify('还没有牌局，先 /poker new'); return { ok: false, code: 'BLUE_ACTION_REJECTED', message: 'no game' } }
    if (state.stage !== 'play') { notify('牌局已结束'); return { ok: false, code: 'BLUE_ACTION_REJECTED', message: 'ended' } }
    if (paused) { notify('牌局已暂停，/poker resume 恢复'); return { ok: false, code: 'BLUE_ACTION_REJECTED', message: 'paused' } }
    if (state.currentIdx !== 0) { notify(`还不是你的回合（当前 ${state.players[state.currentIdx].name}）`); return { ok: false, code: 'BLUE_ACTION_REJECTED', message: 'not your turn' } }
    const moveStr = args.join('')
    const res = parseAndValidate(0, moveStr)
    if (res.error) { notify(res.error, 'danger'); return { ok: false, code: 'BLUE_ACTION_REJECTED', message: res.error } }
    if (res.pass) { applyPass(0); notify('你选择不出', 'muted'); }
    else { applyPlay(0, res); notify(`你出了 ${res.cards.map(cardLabel).join('')}`, 'success') }
    refreshBoard()
    drive()
    return { ok: true, value: undefined }
  }
  function turnDesc() {
    if (!state) return '无牌局'
    if (state.stage === 'ended') return `已结束：${state.winner === 'landlord' ? '地主胜' : '农民胜'}`
    const cur = state.players[state.currentIdx]
    return `第${state.round}局  轮到：${cur.name}  剩余：` + state.players.map(p => p.name + ' ' + p.hand.length + '张').join('，')
  }

  // ---------- mount ----------
  function mount() {
    const opened = ctx.bluePluginHost.open(ctx, { id: name, api: BLUE_API_RANGE, capabilities: CAPABILITIES })
    if (!opened.ok) {
      if (opened.code === 'BLUE_CAPABILITY_ABSENT') {
        // The Blue frontend attaches the notifications owner slightly after
        // plugin rows load; retry briefly instead of failing the plugin.
        scheduleMountRetry()
        return
      }
      throw new Error(opened.code + ': ' + opened.message)
    }
    api = opened.value
    notifications = api.notifications
    const cmdReg = api.commands.register({ id: 'poker', label: '斗地主牌局', execute })
    if (!cmdReg.ok) throw new Error('command register failed: ' + cmdReg.message)
  }
  let mountRetries = 0
  function scheduleMountRetry() {
    if (mountRetries++ >= 2000) {
      // Never loaded without the Blue frontend owner; give up loudly but
      // without killing the host process.
      ctx.logger(name).error('bluePluginHost capabilities did not become available; plugin disabled')
      return
    }
    const timer = setTimeout(mount, 25)
    ctx.effect(() => () => clearTimeout(timer))
  }
  mount()
}
