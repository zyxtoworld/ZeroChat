export const ANDROID_ACTIVITY_LIFECYCLE_LOG_TAG = 'ZeroChatActivityLifecycle'

const lifecycleEventPattern =
  /\bevent=(created|destroyed) instance=(\d+) pid=(\d+)(?: changingConfigurations=(true|false))?\s*$/u

function positiveInteger(value, label) {
  const parsed = Number(value)

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected ${label} to be a positive integer.`)
  }

  return parsed
}

export function parseAndroidActivityLifecycleEvents(output) {
  const taggedLines = String(output ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.includes(ANDROID_ACTIVITY_LIFECYCLE_LOG_TAG))

  if (taggedLines.length === 0) {
    throw new Error('Expected Android Activity lifecycle events in logcat output.')
  }

  return taggedLines.map((line) => {
    const match = line.match(lifecycleEventPattern)

    if (!match) {
      throw new Error('Android logcat contained a malformed lifecycle event.')
    }

    const event = match[1]
    const changingConfigurations = match[4]

    if (
      (event === 'created' && changingConfigurations !== undefined) ||
      (event === 'destroyed' && changingConfigurations === undefined)
    ) {
      throw new Error('Android logcat contained a malformed lifecycle event.')
    }

    return {
      event,
      instanceId: positiveInteger(match[2], 'Activity instance id'),
      pid: positiveInteger(match[3], 'Activity process id'),
      ...(event === 'destroyed'
        ? { changingConfigurations: changingConfigurations === 'true' }
        : {}),
    }
  })
}

export function firstAndroidActivityRecreationEvents(events) {
  if (!Array.isArray(events)) {
    return []
  }

  for (let index = 0; index < events.length - 1; index += 1) {
    const destroyed = events[index]
    const created = events[index + 1]

    if (
      destroyed?.event === 'destroyed' &&
      destroyed.changingConfigurations === true &&
      created?.event === 'created' &&
      destroyed.pid === created.pid
    ) {
      return [destroyed, created]
    }
  }

  return []
}

export function androidActivityLifecycleEventsAfterCursor(events, lastInstanceId) {
  const cursorInstanceId = positiveInteger(lastInstanceId, 'Android lifecycle cursor instance id')

  if (!Array.isArray(events)) {
    return []
  }

  return events.filter((event) =>
    event?.instanceId > cursorInstanceId ||
    (event?.event === 'destroyed' && event.instanceId === cursorInstanceId),
  )
}

export function assertAndroidActivityRecreation({ expectedPid, output }) {
  return assertAndroidActivityRecreationEvents({
    expectedPid,
    events: parseAndroidActivityLifecycleEvents(output),
  })
}

export function assertAndroidActivityRecreationEvents({ expectedPid, events }) {
  const requiredPid = positiveInteger(expectedPid, 'expected Android process id')

  if (!Array.isArray(events)) {
    throw new Error('Expected parsed Android Activity lifecycle events.')
  }

  for (const event of events) {
    if (
      !event ||
      (event.event !== 'created' && event.event !== 'destroyed') ||
      (event.event === 'created' && event.changingConfigurations !== undefined) ||
      (event.event === 'destroyed' && typeof event.changingConfigurations !== 'boolean')
    ) {
      throw new Error('Expected parsed Android Activity lifecycle events.')
    }

    positiveInteger(event.instanceId, 'Activity instance id')
    positiveInteger(event.pid, 'Activity process id')
  }

  const destroyedEvents = events.filter((event) => event.event === 'destroyed')
  const createdEvents = events.filter((event) => event.event === 'created')

  if (
    destroyedEvents.length !== 1 ||
    destroyedEvents[0].changingConfigurations !== true
  ) {
    throw new Error('Expected exactly one configuration-change destruction event.')
  }

  if (createdEvents.length !== 1) {
    throw new Error('Expected exactly one Activity creation event.')
  }

  const destroyed = destroyedEvents[0]
  const created = createdEvents[0]

  if (events.indexOf(destroyed) >= events.indexOf(created)) {
    throw new Error('Expected Activity destruction to precede recreation.')
  }

  if (events.some((event) => event.pid !== requiredPid)) {
    throw new Error('Expected Activity recreation to remain in the same process.')
  }

  if (destroyed.instanceId === created.instanceId) {
    throw new Error('Expected a distinct Activity instance after recreation.')
  }

  return {
    configurationChangeDestroyed: true,
    eventCount: events.length,
    expectedPid: requiredPid,
    previousInstanceId: destroyed.instanceId,
    recreatedInstanceId: created.instanceId,
    sameProcess: true,
  }
}
