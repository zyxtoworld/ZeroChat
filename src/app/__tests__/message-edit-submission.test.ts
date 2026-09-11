import { describe, expect, it, vi } from 'vitest'

import {
  commitMessageEdit,
  reportMessageEditFailure,
} from '../messageEditSubmission'

describe('message edit submission', () => {
  it('keeps the editor open when the draft is blank', async () => {
    const onEdit = vi.fn(async () => false)
    const clearEditing = vi.fn()
    const onFailure = vi.fn()

    await expect(
      commitMessageEdit(
        { id: 'message-1', draft: ' \n\t' },
        onEdit,
        clearEditing,
        onFailure,
      ),
    ).resolves.toBe(false)

    expect(onEdit).toHaveBeenCalledOnce()
    expect(onEdit).toHaveBeenCalledWith('message-1', '')
    expect(clearEditing).not.toHaveBeenCalled()
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('clears the editor only after the trimmed edit is accepted', async () => {
    const onEdit = vi.fn(async () => true)
    const clearEditing = vi.fn()
    const onFailure = vi.fn()

    await expect(
      commitMessageEdit(
        { id: 'message-1', draft: '  revised message  ' },
        onEdit,
        clearEditing,
        onFailure,
      ),
    ).resolves.toBe(true)

    expect(onEdit).toHaveBeenCalledOnce()
    expect(onEdit).toHaveBeenCalledWith('message-1', 'revised message')
    expect(clearEditing).toHaveBeenCalledOnce()
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('keeps the editor open when the edit action is rejected', async () => {
    const onEdit = vi.fn(async () => false)
    const clearEditing = vi.fn()
    const onFailure = vi.fn()

    await expect(
      commitMessageEdit(
        { id: 'message-1', draft: 'busy edit' },
        onEdit,
        clearEditing,
        onFailure,
      ),
    ).resolves.toBe(false)

    expect(onEdit).toHaveBeenCalledWith('message-1', 'busy edit')
    expect(clearEditing).not.toHaveBeenCalled()
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('contains a rejected edit without clearing the editor or leaking a rejection', async () => {
    const failure = new Error('edit request failed')
    const onEdit = vi.fn(async () => {
      throw failure
    })
    const clearEditing = vi.fn()
    const onFailure = vi.fn()

    await expect(
      commitMessageEdit(
        { id: 'message-1', draft: 'keep this draft' },
        onEdit,
        clearEditing,
        onFailure,
      ),
    ).resolves.toBe(false)

    expect(clearEditing).not.toHaveBeenCalled()
    expect(onFailure).toHaveBeenCalledOnce()
    expect(onFailure).toHaveBeenCalledWith(failure)
  })

  it('contains a failure reporter that throws', async () => {
    const onEdit = vi.fn(async () => {
      throw new Error('edit request failed')
    })
    const clearEditing = vi.fn()
    const onFailure = vi.fn(() => {
      throw new Error('notification channel failed')
    })

    await expect(
      commitMessageEdit(
        { id: 'message-1', draft: 'keep this draft' },
        onEdit,
        clearEditing,
        onFailure,
      ),
    ).resolves.toBe(false)

    expect(clearEditing).not.toHaveBeenCalled()
    expect(onFailure).toHaveBeenCalledOnce()
  })

  it('reports a rejected edit with one localized notice without exposing the raw error', () => {
    const sentinel = 'C:\\private\\edit sk-secret-1234567890'
    const failure = new Error(sentinel)
    const translate = vi.fn(() => 'Send failed')
    const notify = vi.fn()
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    reportMessageEditFailure(failure, translate, notify)

    expect(translate).toHaveBeenCalledOnce()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('Send failed', 'error')
    expect(notify.mock.calls.flat().join(' ')).not.toContain(sentinel)
    expect(consoleError).toHaveBeenCalledWith('[app] edited message submission failed')
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(sentinel)
  })
})
