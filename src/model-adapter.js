/**
 * Narrow optional adapter for Harness model-selection and LLM services.
 *
 * @module @dsh-blue/blue-doudizhu/model-adapter
 */

/**
 * Activate a model adapter only while both Harness services are available.
 * The parent remains usable with its heuristic fallback during service gaps.
 */
export function mountModelAdapter(ctx, listener) {
  let disposed = false
  let current
  const fiber = ctx.inject(['llm', 'agentDefaultModel'], modelCtx => {
    if (disposed) return
    const adapter = Object.freeze({
      currentSelection: () => modelCtx.agentDefaultModel.currentSelection(),
      stream: request => modelCtx.llm.stream(request),
    })
    current = adapter
    listener(adapter)
    modelCtx.effect(() => () => {
      if (current !== adapter) return
      current = undefined
      if (!disposed) listener(undefined)
    })
  })
  ctx.effect(() => () => {
    disposed = true
    current = undefined
    void fiber.dispose()
  })
}
