import { describe, expect, it } from 'vitest'

import { planAndroidProviderEditorStep } from '../android-provider-editor-navigation.mjs'

const baseState = {
  editorVisible: false,
  listTopVisible: false,
  providerKeyVisible: false,
  providerNameEditorVisible: false,
  providerNameVisible: false,
  providerSpecificExpandVisible: false,
  showMoreVisible: false,
  taggedExpandVisible: false,
  targetEditorObserved: false,
}

describe('Android Provider editor navigation', () => {
  it('does not mistake a collapsed Provider summary for an expanded editor', () => {
    expect(
      planAndroidProviderEditorStep({
        ...baseState,
        phase: 'scan',
        providerNameVisible: true,
      }),
    ).toEqual({
      action: 'scan-forward',
      targetEditorObserved: false,
    })
  })

  it('requires a post-click editor observation before resolving', () => {
    const tapStep = planAndroidProviderEditorStep({
      ...baseState,
      phase: 'scan',
      providerSpecificExpandVisible: true,
    })

    expect(tapStep).toEqual({
      action: 'tap-provider-specific-expand',
      captureCompactEvidence: true,
      targetEditorObserved: false,
    })

    expect(
      planAndroidProviderEditorStep({
        ...baseState,
        phase: 'scan',
        targetEditorObserved: tapStep.targetEditorObserved,
      }),
    ).toEqual({
      action: 'scan-forward',
      targetEditorObserved: false,
    })
  })

  it('captures the compact card before using its tagged expand fallback', () => {
    expect(
      planAndroidProviderEditorStep({
        ...baseState,
        phase: 'scan',
        providerNameVisible: true,
        taggedExpandVisible: true,
      }),
    ).toEqual({
      action: 'tap-tagged-expand',
      captureCompactEvidence: true,
      targetEditorObserved: false,
    })
  })

  it('resolves only after the target editor and credential field are observed', () => {
    expect(
      planAndroidProviderEditorStep({
        ...baseState,
        editorVisible: true,
        phase: 'scan',
        providerKeyVisible: true,
      }),
    ).toEqual({
      action: 'resolved',
      targetEditorObserved: true,
    })
  })

  it('tracks the editable Provider name until its credential field scrolls into view', () => {
    const editorHeaderStep = planAndroidProviderEditorStep({
      ...baseState,
      phase: 'scan',
      providerNameEditorVisible: true,
    })

    expect(editorHeaderStep).toEqual({
      action: 'scan-forward',
      targetEditorObserved: true,
    })
    expect(
      planAndroidProviderEditorStep({
        ...baseState,
        phase: 'scan',
        providerKeyVisible: true,
        targetEditorObserved: editorHeaderStep.targetEditorObserved,
      }),
    ).toEqual({
      action: 'resolved',
      targetEditorObserved: true,
    })
  })

  it('expands hidden Providers before continuing the forward scan', () => {
    expect(
      planAndroidProviderEditorStep({
        ...baseState,
        phase: 'scan',
        showMoreVisible: true,
      }),
    ).toEqual({
      action: 'tap-show-more',
      targetEditorObserved: false,
    })
  })

  it('rewinds only until the top of the Provider list is visible', () => {
    expect(
      planAndroidProviderEditorStep({
        ...baseState,
        phase: 'rewind',
      }),
    ).toEqual({
      action: 'rewind',
      targetEditorObserved: false,
    })

    expect(
      planAndroidProviderEditorStep({
        ...baseState,
        listTopVisible: true,
        phase: 'rewind',
      }),
    ).toEqual({
      action: 'scan-forward',
      targetEditorObserved: false,
    })
  })
})
