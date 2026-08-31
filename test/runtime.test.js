/** Packed-runtime, capability fallback, lifecycle, and width tests. */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as blueApi from '@dsh-blue/blue-api'
import { validateBluePluginManifestV1 } from '@dsh-blue/blue-api/protocol/v1'
import { BlueComponentsService, compileBlueUiNode, visibleWidth } from '@dsh-blue/blue-core'
import { DARK_COLORS } from '@dsh-blue/blue-core/theme-dark'
import * as plugin from '../src/index.js'
import { RANK_CHAR, createGame } from '../src/domain.js'
import { projectRuntime } from '../src/projection.js'
import { createBoardView } from '../src/view.js'

const widths = [20, 40, 80, 120, 200]

function nextTurn() {
  return new Promise(resolve => setImmediate(resolve))
}

test('ships one canonical manifest whose entry is public', async () => {
  const [manifest, packageManifest] = await Promise.all([
    readFile(new URL('../blue.plugin.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
  ])
  const parsed = validateBluePluginManifestV1(manifest)
  assert.equal(parsed.ok, true)
  assert.equal(manifest.entry, '.')
  assert.equal(packageManifest.exports['.'], './src/index.js')
  assert.deepEqual(manifest.capabilities.required[0].resources.names, ['poker'])
})

test('compiles the projected board without width overflow', () => {
  const created = createGame({ round: 1, startUid: 0, humanBid: 3, random: () => 0.5 })
  assert.equal(created.ok, true)
  const model = projectRuntime({
    game: created.game,
    match: { scores: [0, 0, 0], games: 0 },
    memoOn: true,
    paused: false,
    botMode: 'hybrid',
    finalRanking: null,
    thinkTimeoutMs: 30_000,
  })
  for (const width of widths) {
    const components = new BlueComponentsService(new Context(), { theme: { colors: DARK_COLORS }, tui: {} })
    const compiled = compileBlueUiNode(createBoardView(model, 0), {
      components,
      colors: DARK_COLORS,
      getViewport: () => ({ columns: width, rows: Number.MAX_SAFE_INTEGER }),
      screenMode: 'main',
      emit: () => {},
    })
    assert.equal(compiled.ok, true)
    for (const row of compiled.value.component.render(width)) assert.ok(visibleWidth(row) <= width, `${visibleWidth(row)} > ${width}: ${row}`)
  }
})

test('admits without optional notifications and unloads every contribution', async () => {
  const ctx = new Context()
  await ctx.plugin(blueApi)
  const lease = ctx.bluePluginControl.attachCapabilities(ctx, ['commands', 'overlays'])
  const fiber = await ctx.plugin(plugin)
  const mounted = lease.snapshot()
  assert.equal(mounted.ok, true)
  assert.deepEqual(mounted.value.commands.map(command => command.id), ['poker'])
  const started = await mounted.value.commands[0].execute(['new', '3'], {})
  assert.equal(started.ok, true)
  await nextTurn()
  const playing = lease.snapshot()
  assert.equal(playing.ok, true)
  assert.equal(playing.value.overlays.length, 1)
  assert.equal(playing.value.overlays[0].request.render().kind, 'stack')
  await fiber.dispose()
  const unloaded = lease.snapshot()
  assert.equal(unloaded.value.commands.length, 0)
  assert.equal(unloaded.value.overlays.length, 0)
  await ctx.fiber.dispose()

  const fallback = new Context()
  await fallback.plugin(blueApi)
  const fallbackFiber = await fallback.plugin(plugin)
  await fallbackFiber.dispose()
  await fallback.fiber.dispose()
})

test('keeps the complete command workflow available through structured actions', async () => {
  const ctx = new Context()
  await ctx.plugin(blueApi)
  const lease = ctx.bluePluginControl.attachCapabilities(ctx, ['commands', 'overlays', 'notifications.publish'])
  const originalRandom = Math.random
  Math.random = () => 0.5
  try {
    const fiber = await ctx.plugin(plugin)
    const command = lease.snapshot().value.commands[0]
    for (const args of [
      [],
      ['help'],
      ['new', '3'],
      ['memo'],
      ['score'],
      ['status'],
      ['pause'],
      ['hide'],
      ['show'],
      ['resume'],
      ['heuristic'],
      ['bot'],
      ['end'],
      ['show'],
      ['stop'],
    ]) assert.equal((await command.execute(args, {})).ok, true, args.join(' '))
    assert.equal((await command.execute(['show'], {})).ok, true)
    assert.equal((await command.execute(['new', '3'], {})).ok, true)
    assert.equal((await command.execute(['stop'], {})).ok, true)
    assert.equal((await command.execute(['show'], {})).ok, false)
    assert.equal((await command.execute(['3'], {})).ok, false)
    await fiber.dispose()
  } finally {
    Math.random = originalRandom
    await ctx.fiber.dispose()
  }
})

test('aborts an active model stream and rejects its late chunk on unload', async () => {
  const ctx = new Context()
  await ctx.plugin(blueApi)
  let startedResolve
  const started = new Promise(resolve => { startedResolve = resolve })
  let observedSignal
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'fixture', model: 'fixture-model' }) })
  ctx.provide('llm', {
    async * stream(request) {
      observedSignal = request.signal
      startedResolve()
      if (!request.signal.aborted) await new Promise(resolve => request.signal.addEventListener('abort', resolve, { once: true }))
      yield { type: 'text-delta', text: '3' }
    },
  })
  const lease = ctx.bluePluginControl.attachCapabilities(ctx, ['commands', 'overlays'])
  const originalRandom = Math.random
  Math.random = () => 0.5
  let fiber
  try {
    fiber = await ctx.plugin(plugin)
    const command = lease.snapshot().value.commands[0]
    assert.equal((await command.execute(['new', '3'], {})).ok, true)
    let moved = false
    for (const rank of RANK_CHAR.map(value => value.toLowerCase())) {
      const result = await command.execute([rank], {})
      if (result.ok) {
        moved = true
        break
      }
    }
    assert.equal(moved, true)
    await Promise.race([
      started,
      new Promise((_, reject) => setTimeout(() => reject(new Error('model stream did not start')), 2000)),
    ])
    await fiber.dispose()
    await nextTurn()
    assert.equal(observedSignal.aborted, true)
    const unloaded = lease.snapshot()
    assert.equal(unloaded.value.commands.length, 0)
    assert.equal(unloaded.value.overlays.length, 0)
  } finally {
    Math.random = originalRandom
    if (fiber?.uid !== null) await fiber.dispose()
    await ctx.fiber.dispose()
  }
})
