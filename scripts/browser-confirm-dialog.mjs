export async function runActionWithExpectedConfirm(
  cdp,
  action,
  {
    expectedMessageFragments = [],
    timeoutMs = 5_000,
  } = {},
) {
  let timeout
  let resolveDialog
  const dialogPromise = new Promise((resolve, reject) => {
    resolveDialog = resolve
    timeout = setTimeout(
      () => reject(new Error('Timed out waiting for the expected confirmation dialog')),
      timeoutMs,
    )
  })
  const unsubscribe = cdp.on('Page.javascriptDialogOpening', resolveDialog)
  const actionPromise = Promise.resolve().then(action)
  const actionFailurePromise = new Promise((_, reject) => {
    void actionPromise.catch(reject)
  })

  try {
    const dialog = await Promise.race([
      dialogPromise,
      actionFailurePromise,
    ])
    const message = typeof dialog?.message === 'string' ? dialog.message : ''
    const valid =
      dialog?.type === 'confirm' &&
      message.trim().length > 0 &&
      (expectedMessageFragments.length === 0 ||
        expectedMessageFragments.some((fragment) => message.includes(fragment)))
    await cdp.send('Page.handleJavaScriptDialog', { accept: valid })
    if (!valid) {
      throw new Error('Unexpected JavaScript dialog while confirming the action')
    }
    await actionPromise
    return dialog
  } finally {
    clearTimeout(timeout)
    unsubscribe()
  }
}
