# Blue Plugin Manifest v1 Migration Record

## Domain

`src/domain.js` owns card encoding, combination classification, comparison,
candidate generation, bidding, game creation, structured state transitions,
settlement, and the heuristic fallback. It has no Blue, Harness, renderer, or
terminal dependency.

## Projection

`src/projection.js` derives a deep-frozen snapshot from the active game and
match. It copies cards, combinations, players, scores, thinking facts, and the
final ranking; renderer code never retains mutable domain objects.

## Action

The `poker` command maps `new`, move, pass, pause, resume, stop, end, memo, and
bot-mode inputs onto domain transitions and returns structured `BlueResult`
values. UI rendering never mutates game state.

## Interaction Model

`src/index.js` owns command routing, driver generations, notices, and the
non-capturing overlay. One captured game plus one generation token fences every
async decision.

## Renderer UI

`src/view.js` consumes only readonly projections and constructs public Blue
wire nodes through `@dsh-blue/blue-ui`. It has no pi-tui, ANSI, raw-terminal,
React, DOM, Agent, or Session dependency.

## Composition Rows

`cordis.patch.yml` retains one package row. There is no implicit ordering or
private Blue package import.

## Scope

Game, match, ranking, model adapter, overlay handle, abort controller, and
driver generation are local to `apply(ctx)`. Module state contains only the
validated immutable distribution manifest and constants.

## Capabilities

`commands` is required and restricted to `poker`; `overlays` is required;
`notifications.publish` is optional. The persistent entry imports and parses
the shipped `blue.plugin.json`, then uses `opened.value.api` from canonical
host admission.

## Fallback

Missing notifications are silent. Missing, unloaded, or failing model services
fall back to the heuristic Bot without delaying plugin admission or the Agent
loop. Missing required Blue capabilities leave the plugin inert.

## Fixtures

The release gate includes domain/projection tests, canonical package discovery,
optional-capability fallback, 20/40/80/120 width compilation through Blue core,
Fiber unload, model-stream abort and late-chunk rejection, script-disabled pack,
current (`0.1.1-rc.2`) and previous (`0.1.1-rc.1`) Harness packed-install fixtures, and an isolated real
profile installed from the published exact npm version.

## Deletion Condition

The legacy inline manifest, flat capability array, old `opened.value` facet
shape, undeclared `ctx.get()` model reads, and 25 ms mount retry were deleted in
the 0.3.0 migration. They must not return after fixture and profile acceptance.
