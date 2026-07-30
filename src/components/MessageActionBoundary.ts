export type LeafActionResult = void | Promise<void>

export async function runLeafAction<Args extends unknown[]>(
  action: (...args: Args) => LeafActionResult,
  ...args: Args
): Promise<void> {
  try {
    await action(...args)
  } catch {
    // Owning controllers report user-facing action errors; leaf UI must not leak injected callback failures.
  }
}

export type MessageActionResult = LeafActionResult

export { runLeafAction as runMessageAction }
