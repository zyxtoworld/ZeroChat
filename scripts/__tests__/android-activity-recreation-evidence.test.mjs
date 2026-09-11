import { describe, expect, it } from 'vitest'

import {
  androidActivityLifecycleEventsAfterCursor,
  assertAndroidActivityRecreation,
  assertAndroidActivityRecreationEvents,
  firstAndroidActivityRecreationEvents,
} from '../android-activity-recreation-evidence.mjs'

const validLog = `
I/ZeroChatActivityLifecycle( 4242): event=destroyed instance=7 pid=4242 changingConfigurations=true
I/ZeroChatActivityLifecycle( 4242): event=created instance=8 pid=4242
`

describe('Android Activity recreation evidence', () => {
  it('accepts one configuration-change recreation inside the expected process', () => {
    expect(
      assertAndroidActivityRecreation({
        expectedPid: 4242,
        output: validLog,
      }),
    ).toEqual({
      configurationChangeDestroyed: true,
      eventCount: 2,
      expectedPid: 4242,
      previousInstanceId: 7,
      recreatedInstanceId: 8,
      sameProcess: true,
    })
  })

  it('rejects a recreation that moved to another process', () => {
    expect(() =>
      assertAndroidActivityRecreation({
        expectedPid: 4242,
        output: validLog.replace('instance=8 pid=4242', 'instance=8 pid=9001'),
      }),
    ).toThrow(/same process/u)
  })

  it('rejects a reused Activity instance id', () => {
    expect(() =>
      assertAndroidActivityRecreation({
        expectedPid: 4242,
        output: validLog.replace('instance=8', 'instance=7'),
      }),
    ).toThrow(/distinct Activity instance/u)
  })

  it('rejects a destroy event that is not a configuration change', () => {
    expect(() =>
      assertAndroidActivityRecreation({
        expectedPid: 4242,
        output: validLog.replace('changingConfigurations=true', 'changingConfigurations=false'),
      }),
    ).toThrow(/configuration-change destruction/u)
  })

  it('rejects malformed tagged lifecycle output instead of silently ignoring it', () => {
    expect(() =>
      assertAndroidActivityRecreation({
        expectedPid: 4242,
        output: `${validLog}I/ZeroChatActivityLifecycle( 4242): instance=?\n`,
      }),
    ).toThrow(/malformed lifecycle event/u)
  })

  it('rejects extra create or destroy events that make the injected transition ambiguous', () => {
    expect(() =>
      assertAndroidActivityRecreation({
        expectedPid: 4242,
        output: `${validLog}I/ZeroChatActivityLifecycle( 4242): event=created instance=9 pid=4242\n`,
      }),
    ).toThrow(/exactly one Activity creation/u)
  })

  it('accepts parsed events when the logcat prefix was pruned after the cursor', () => {
    expect(
      assertAndroidActivityRecreationEvents({
        expectedPid: 4242,
        events: [
          {
            event: 'destroyed',
            instanceId: 7,
            pid: 4242,
            changingConfigurations: true,
          },
          {
            event: 'created',
            instanceId: 8,
            pid: 4242,
          },
        ],
      }),
    ).toEqual({
      configurationChangeDestroyed: true,
      eventCount: 2,
      expectedPid: 4242,
      previousInstanceId: 7,
      recreatedInstanceId: 8,
      sameProcess: true,
    })
  })

  it('selects the first recreation when the device emits a trailing transition before polling', () => {
    const events = [
      {
        event: 'destroyed',
        instanceId: 7,
        pid: 4242,
        changingConfigurations: true,
      },
      {
        event: 'created',
        instanceId: 8,
        pid: 4242,
      },
      {
        event: 'destroyed',
        instanceId: 8,
        pid: 4242,
        changingConfigurations: true,
      },
      {
        event: 'created',
        instanceId: 9,
        pid: 4242,
      },
    ]

    expect(firstAndroidActivityRecreationEvents(events)).toEqual(events.slice(0, 2))
  })

  it('keeps the baseline Activity destruction while advancing creation events', () => {
    const events = [
      { event: 'created', instanceId: 1, pid: 4242 },
      { event: 'destroyed', instanceId: 1, pid: 4242, changingConfigurations: true },
      { event: 'created', instanceId: 2, pid: 4242 },
      { event: 'destroyed', instanceId: 2, pid: 4242, changingConfigurations: true },
      { event: 'created', instanceId: 3, pid: 4242 },
    ]

    expect(androidActivityLifecycleEventsAfterCursor(events, 1)).toEqual(events.slice(1))
  })
})
