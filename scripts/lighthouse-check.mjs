import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { access, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import lighthouse from 'lighthouse'
import desktopConfig from 'lighthouse/core/config/desktop-config.js'
import { waitForChrome as waitForCdpChrome } from './browser-cdp.mjs'
import { resolveFetchSafeLoopbackPort } from './fetch-safe-loopback-port.mjs'
import { startVitePreviewLoopbackServer } from './vite-loopback-server.mjs'
import {
  removeBrowserProfileWithRetry,
  stopChildProcessTree,
} from './browser-runtime-cleanup.mjs'

const MIN_PERFORMANCE_SCORE = 0.95
const MIN_ACCESSIBILITY_SCORE = 0.95
const MIN_BEST_PRACTICES_SCORE = 0.95
const MAX_FIRST_CONTENTFUL_PAINT_MS = 1200
const MAX_TIME_TO_INTERACTIVE_MS = 2000
const LIGHTHOUSE_RUN_COUNT = 3

async function executableExists(value) {
  if (!value.includes('\\') && !value.includes('/')) {
    return spawnSync(process.platform === 'win32' ? 'where' : 'which', [value], {
      stdio: 'ignore',
    }).status === 0
  }

  try {
    await access(value)
    return true
  } catch {
    return false
  }
}

async function resolveChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.platform === 'win32'
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : undefined,
    process.platform === 'win32'
      ? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
      : undefined,
    process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : undefined,
    process.platform === 'linux' ? 'google-chrome' : undefined,
    process.platform === 'linux' ? 'google-chrome-stable' : undefined,
    process.platform === 'linux' ? 'chromium-browser' : undefined,
    process.platform === 'linux' ? 'chromium' : undefined,
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (await executableExists(candidate)) {
      return candidate
    }
  }

  throw new Error('Chrome or Chromium was not found. Set CHROME_PATH to run Lighthouse checks.')
}

function percent(score) {
  return Math.round((score ?? 0) * 100)
}

function milliseconds(value) {
  return `${Math.round(value)}ms`
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

function scoreSample(categories, key, label) {
  const score = categories[key]?.score

  assert.ok(
    typeof score === 'number' && Number.isFinite(score),
    `${label} did not return a finite score.`,
  )

  return score
}

function metricSample(audits, key, label) {
  const numericValue = audits[key]?.numericValue

  assert.ok(
    typeof numericValue === 'number' && Number.isFinite(numericValue) && numericValue > 0,
    `${label} did not return a positive finite value.`,
  )

  return numericValue
}

function requireScore(score, samples, minimum, label) {
  const formattedSamples = samples.map(percent).join(', ')

  assert.ok(
    typeof score === 'number' && score >= minimum,
    `${label} median score must be at least ${percent(minimum)}; got ${percent(
      score,
    )} from samples [${formattedSamples}].`,
  )

  return score
}

function requireMetric(numericValue, samples, maximum, label) {
  const formattedSamples = samples.map(milliseconds).join(', ')

  assert.ok(
    typeof numericValue === 'number' &&
      Number.isFinite(numericValue) &&
      numericValue > 0 &&
      numericValue <= maximum,
    `${label} median must be at or below ${milliseconds(maximum)}; got ${milliseconds(
      Number(numericValue) || 0,
    )} from samples [${formattedSamples}].`,
  )

  return numericValue
}

await access(path.resolve('dist/index.html')).catch(() => {
  throw new Error('dist/index.html is missing. Run `pnpm run build` before Lighthouse checks.')
})

const chromePort = await resolveFetchSafeLoopbackPort(
  process.env.ZEROCHAT_LIGHTHOUSE_CDP_PORT,
  'Lighthouse Chrome remote debugging',
)
const chromePath = await resolveChromePath()
const chromeProfileDir = path.join(os.tmpdir(), `zerochat-lighthouse-${Date.now()}`)

await mkdir(chromeProfileDir, { recursive: true })

const preview = await startVitePreviewLoopbackServer({
  configuredPort: process.env.ZEROCHAT_LIGHTHOUSE_PORT,
  serverLabel: 'Lighthouse preview server',
})
const previewUrl = preview.url

const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    `--remote-debugging-port=${chromePort}`,
    `--user-data-dir=${chromeProfileDir}`,
    '--disable-gpu',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  {
    stdio: 'ignore',
    windowsHide: true,
  },
)

try {
  await waitForCdpChrome(chromePort, { childProcess: chrome })

  const samples = []

  for (let run = 0; run < LIGHTHOUSE_RUN_COUNT; run += 1) {
    const result = await lighthouse(
      previewUrl,
      {
        port: chromePort,
        formFactor: 'desktop',
        logLevel: 'error',
        onlyCategories: ['performance', 'accessibility', 'best-practices'],
        output: 'json',
        screenEmulation: desktopConfig.settings.screenEmulation,
        throttling: desktopConfig.settings.throttling,
        throttlingMethod: desktopConfig.settings.throttlingMethod,
        chromeFlags: [
          '--headless=new',
          '--disable-gpu',
          '--disable-extensions',
          '--no-first-run',
          '--no-default-browser-check',
          `--user-data-dir=${chromeProfileDir}`,
        ],
      },
      desktopConfig,
    )

    const lhr = result?.lhr

    if (!lhr) {
      throw new Error(`Lighthouse run ${run + 1} did not return a report.`)
    }

    samples.push({
      performance: scoreSample(lhr.categories, 'performance', 'Lighthouse performance'),
      accessibility: scoreSample(lhr.categories, 'accessibility', 'Lighthouse accessibility'),
      bestPractices: scoreSample(
        lhr.categories,
        'best-practices',
        'Lighthouse best-practices',
      ),
      firstContentfulPaint: metricSample(
        lhr.audits,
        'first-contentful-paint',
        'First Contentful Paint',
      ),
      timeToInteractive: metricSample(lhr.audits, 'interactive', 'Time to Interactive'),
    })
  }

  const sampleValues = (key) => samples.map((sample) => sample[key])
  const scores = {
    performance: requireScore(
      median(sampleValues('performance')),
      sampleValues('performance'),
      MIN_PERFORMANCE_SCORE,
      'Lighthouse performance',
    ),
    accessibility: requireScore(
      median(sampleValues('accessibility')),
      sampleValues('accessibility'),
      MIN_ACCESSIBILITY_SCORE,
      'Lighthouse accessibility',
    ),
    bestPractices: requireScore(
      median(sampleValues('bestPractices')),
      sampleValues('bestPractices'),
      MIN_BEST_PRACTICES_SCORE,
      'Lighthouse best-practices',
    ),
  }
  const metrics = {
    firstContentfulPaint: requireMetric(
      median(sampleValues('firstContentfulPaint')),
      sampleValues('firstContentfulPaint'),
      MAX_FIRST_CONTENTFUL_PAINT_MS,
      'First Contentful Paint',
    ),
    timeToInteractive: requireMetric(
      median(sampleValues('timeToInteractive')),
      sampleValues('timeToInteractive'),
      MAX_TIME_TO_INTERACTIVE_MS,
      'Time to Interactive',
    ),
  }

  console.log(
    `Lighthouse checks passed: performance ${percent(scores.performance)}, accessibility ${percent(
      scores.accessibility,
    )}, best-practices ${percent(scores.bestPractices)}, FCP ${milliseconds(
      metrics.firstContentfulPaint,
    )}, TTI ${milliseconds(metrics.timeToInteractive)}; samples performance [${sampleValues(
      'performance',
    )
      .map(percent)
      .join(', ')}], FCP [${sampleValues('firstContentfulPaint')
      .map(milliseconds)
      .join(', ')}], TTI [${sampleValues('timeToInteractive')
      .map(milliseconds)
      .join(', ')}]`,
  )
} finally {
  await preview.close()
  await stopChildProcessTree(chrome)
  const profileRemoved = await removeBrowserProfileWithRetry(chromeProfileDir, 40)
  assert.ok(profileRemoved, `Lighthouse browser profile cleanup failed: ${chromeProfileDir}`)
}
