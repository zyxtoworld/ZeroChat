import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runWebProductionBuild } from './web-production-build.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const node = process.execPath

function fromRoot(path) {
  return resolve(root, path)
}

function display(command, args) {
  const commandText = isAbsolute(command) ? relative(root, command) || command : command
  const argsText = args
    .map((arg) => (isAbsolute(arg) ? relative(root, arg) || arg : arg))
    .join(' ')

  return `${commandText}${argsText ? ` ${argsText}` : ''}`
}

function printHelp() {
  console.log(`ZeroChat Cloudflare Pages deploy

Usage:
  pnpm run deploy:cf
  pnpm run deploy:cf -- --dry-run
  pnpm run deploy:cf -- --branch preview

What it does:
  1. Generates the current Service Worker source artifact.
  2. Runs TypeScript and builds the Web/PWA into dist/.
  3. Runs Wrangler Pages direct upload for dist/.

Options:
  --dry-run    Build locally and print the Wrangler command without uploading.
  --skip-build Reuse existing dist/ for a dry-run after another gate already built it.
  --help       Show this help.

Extra arguments after -- are passed to Wrangler Pages deploy.`)
}

async function run(label, command, args) {
  console.log(`\n==> ${label}`)
  console.log(display(command, args))

  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    })

    child.on('error', rejectRun)
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolveRun()
        return
      }

      rejectRun(
        new Error(
          signal
            ? `${label} stopped by signal ${signal}`
            : `${label} failed with exit code ${code}`,
        ),
      )
    })
  })
}

async function commandAvailable(command) {
  const probe = process.platform === 'win32' ? 'where' : 'which'

  try {
    await new Promise((resolveProbe, rejectProbe) => {
      const child = spawn(probe, [command], {
        cwd: root,
        env: process.env,
        stdio: 'ignore',
        windowsHide: true,
      })

      child.on('error', rejectProbe)
      child.on('exit', (code) => {
        if (code === 0) {
          resolveProbe()
        } else {
          rejectProbe(new Error(`${command} was not found on PATH.`))
        }
      })
    })

    return true
  } catch {
    return false
  }
}

function packageManagerExec(extraArgs) {
  const execPath = process.env.npm_execpath ?? ''
  const userAgent = process.env.npm_config_user_agent ?? ''
  const packageManagerHint = `${execPath} ${userAgent}`.toLowerCase()

  if (execPath && packageManagerHint.includes('pnpm')) {
    return {
      command: node,
      args: [execPath, 'dlx', 'wrangler@latest', 'pages', 'deploy', 'dist', ...extraArgs],
    }
  }

  if (execPath && packageManagerHint.includes('yarn')) {
    return {
      command: node,
      args: [execPath, 'dlx', 'wrangler@latest', 'pages', 'deploy', 'dist', ...extraArgs],
    }
  }

  if (execPath && packageManagerHint.includes('npm')) {
    return {
      command: node,
      args: [
        execPath,
        'exec',
        '--yes',
        'wrangler@latest',
        '--',
        'pages',
        'deploy',
        'dist',
        ...extraArgs,
      ],
    }
  }

  return {
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['--yes', 'wrangler@latest', 'pages', 'deploy', 'dist', ...extraArgs],
  }
}

const userArgs = process.argv.slice(2)
const help = userArgs.includes('--help') || userArgs.includes('-h')
const dryRun = userArgs.includes('--dry-run')
const skipBuild = userArgs.includes('--skip-build')
const wranglerArgs = userArgs.filter(
  (arg) => !['--', '--dry-run', '--skip-build', '--help', '-h'].includes(arg),
)

if (help) {
  printHelp()
  process.exit(0)
}

try {
  if (skipBuild && !dryRun) {
    throw new Error('--skip-build is only allowed with --dry-run; real uploads always build fresh.')
  }

  if (skipBuild) {
    await access(fromRoot('dist/index.html')).catch(() => {
      throw new Error('Missing dist/index.html. Run pnpm run build first or omit --skip-build.')
    })
    console.log('Skipping local build; using existing dist/ for dry-run.')
  } else {
    await runWebProductionBuild()
  }

  const wrangler = packageManagerExec(wranglerArgs)

  if (dryRun) {
    console.log('\n==> Cloudflare Pages deploy')
    console.log(display(wrangler.command, wrangler.args))
    if (
      !process.env.npm_execpath &&
      !(await commandAvailable(process.platform === 'win32' ? 'npx.cmd' : 'npx'))
    ) {
      console.log('Note: npx was not found on PATH. Run this through pnpm, for example `pnpm run deploy:cf`, before uploading.')
    }
    console.log('Dry run: build succeeded and upload was skipped.')
  } else {
    await run('Cloudflare Pages deploy', wrangler.command, wrangler.args)
  }
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
