import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const cargoVersion = spawnSync('cargo', ['--version'], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
})

if (cargoVersion.error?.code === 'ENOENT') {
  console.log('Linux Rustfmt check skipped: cargo is not installed on this host.')
  process.exit(0)
}

if (cargoVersion.status !== 0) {
  process.stderr.write(cargoVersion.stderr || cargoVersion.stdout || '')
  process.exit(cargoVersion.status ?? 1)
}

const rustfmt = spawnSync(
  'cargo',
  ['fmt', '--manifest-path', 'apps/linux/Cargo.toml', '--check'],
  {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  },
)

if (rustfmt.error) {
  console.error(`Linux Rustfmt check failed to start: ${rustfmt.error.message}`)
  process.exit(1)
}

if (rustfmt.status !== 0) {
  process.exit(rustfmt.status ?? 1)
}

console.log('Linux Rustfmt checks passed')
