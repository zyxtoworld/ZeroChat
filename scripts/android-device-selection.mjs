export function isAndroidEmulatorSerial(serial) {
  return typeof serial === 'string' && /^emulator-\d+$/.test(serial.trim())
}

function normalizedDevices(devices) {
  return [
    ...new Set(
      (Array.isArray(devices) ? devices : [])
        .map((device) => (typeof device === 'string' ? device.trim() : ''))
        .filter(Boolean),
    ),
  ]
}

function deviceCandidates(
  devices,
  selectedDevice,
  allowPhysicalDevice,
) {
  if (selectedDevice) {
    return devices.includes(selectedDevice) ? [selectedDevice] : []
  }

  const emulators = devices.filter(isAndroidEmulatorSerial)
  if (!allowPhysicalDevice) {
    return emulators
  }

  return [
    ...emulators,
    ...devices.filter((device) => !isAndroidEmulatorSerial(device)),
  ]
}

export function androidDeviceCandidates(
  devices,
  { selectedDevice = null, allowPhysicalDevice = false } = {},
) {
  const availableDevices = normalizedDevices(devices)
  const normalizedSelection = selectedDevice?.trim() || null

  return deviceCandidates(
    availableDevices,
    normalizedSelection,
    allowPhysicalDevice,
  )
}

export function selectAndroidDevice(
  devices,
  { selectedDevice = null, allowPhysicalDevice = false } = {},
) {
  const availableDevices = normalizedDevices(devices)
  const normalizedSelection = selectedDevice?.trim() || null

  if (normalizedSelection && !availableDevices.includes(normalizedSelection)) {
    return { device: null, reason: 'selected-device-not-connected' }
  }

  const candidates = deviceCandidates(
    availableDevices,
    normalizedSelection,
    allowPhysicalDevice,
  )

  if (candidates.length) {
    return { device: candidates[0], reason: null }
  }

  if (availableDevices.some((device) => !isAndroidEmulatorSerial(device))) {
    return { device: null, reason: 'physical-device-requires-explicit-selection' }
  }

  return { device: null, reason: 'no-eligible-device' }
}

export function createAndroidDeviceSelectionError(message) {
  const error = new Error(message)
  error.name = 'AndroidDeviceSelectionError'
  return error
}

export function isAndroidDeviceSelectionError(error) {
  return error instanceof Error && error.name === 'AndroidDeviceSelectionError'
}
