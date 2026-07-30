import { readFile, writeFile } from 'node:fs/promises'

import { build } from 'vite'

const outputPath = 'public/sw.js'
const checkOnly = process.argv.includes('--check')
const result = await build({
  configFile: false,
  logLevel: 'silent',
  publicDir: false,
  build: {
    minify: 'oxc',
    target: 'es2022',
    write: false,
    rollupOptions: {
      input: 'scripts/service-worker-source.js',
      output: {
        entryFileNames: 'sw.js',
        format: 'iife',
      },
    },
  },
})
const outputs = Array.isArray(result)
  ? result.flatMap((buildResult) => buildResult.output)
  : result.output
const chunks = outputs.filter((output) => output.type === 'chunk')
const assets = outputs.filter((output) => output.type === 'asset')

if (chunks.length !== 1 || assets.length !== 0) {
  throw new Error(
    `Service worker build must emit exactly one JavaScript chunk and no assets; got ${chunks.length} chunks and ${assets.length} assets.`,
  )
}

const generated = `${chunks[0].code.trimEnd()}\n`
const current = await readFile(outputPath, 'utf8').catch(() => '')

if (checkOnly) {
  if (current !== generated) {
    throw new Error(
      `${outputPath} is stale; run pnpm run build:service-worker.`,
    )
  }

  console.log('Generated service worker is current')
} else if (current !== generated) {
  await writeFile(outputPath, generated)
  console.log(`Generated ${outputPath}`)
}
