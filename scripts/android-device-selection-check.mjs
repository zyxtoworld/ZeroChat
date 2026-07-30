import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  androidDeviceCandidates,
  createAndroidDeviceSelectionError,
  isAndroidEmulatorSerial,
  isAndroidDeviceSelectionError,
  selectAndroidDevice,
} from './android-device-selection.mjs'

assert.equal(isAndroidEmulatorSerial('emulator-5554'), true)
assert.equal(isAndroidEmulatorSerial('09051FDD4002SJ'), false)
assert.deepEqual(
  androidDeviceCandidates(['09051FDD4002SJ', 'emulator-5554']),
  ['emulator-5554'],
)
assert.deepEqual(
  androidDeviceCandidates(['09051FDD4002SJ', 'emulator-5554'], {
    allowPhysicalDevice: true,
  }),
  ['emulator-5554', '09051FDD4002SJ'],
)
assert.deepEqual(
  androidDeviceCandidates(['09051FDD4002SJ'], {
    selectedDevice: '09051FDD4002SJ',
  }),
  ['09051FDD4002SJ'],
)
assert.deepEqual(
  androidDeviceCandidates(['emulator-5554'], {
    selectedDevice: 'emulator-5556',
  }),
  [],
)
assert.deepEqual(selectAndroidDevice(['emulator-5554']), {
  device: 'emulator-5554',
  reason: null,
})
assert.deepEqual(selectAndroidDevice(['09051FDD4002SJ']), {
  device: null,
  reason: 'physical-device-requires-explicit-selection',
})
assert.deepEqual(
  selectAndroidDevice(['09051FDD4002SJ'], {
    selectedDevice: '09051FDD4002SJ',
  }),
  { device: '09051FDD4002SJ', reason: null },
)
assert.deepEqual(
  selectAndroidDevice(['emulator-5554'], {
    selectedDevice: 'emulator-5556',
  }),
  { device: null, reason: 'selected-device-not-connected' },
)
assert.equal(
  isAndroidDeviceSelectionError(
    createAndroidDeviceSelectionError('Android target selection failed.'),
  ),
  true,
)

for (const fileName of ['android-ui-smoke.mjs', 'android-cloud-sync-smoke.mjs']) {
  const source = readFileSync(new URL(`./${fileName}`, import.meta.url), 'utf8')
  assert.match(source, /selectAndroidDevice/)
  assert.match(source, /isAndroidDeviceSelectionError/)
  assert.match(source, /device-selection-failure\.json/)
  assert.doesNotMatch(source, /selectedDevice = devices\[0\]/)
}

console.log('Android device-selection checks passed')
