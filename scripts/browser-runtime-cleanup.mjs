import { spawnSync } from 'node:child_process'
import { rm } from 'node:fs/promises'

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function stopChildProcessTree(child, timeoutMs = 5000) {
  if (!child) {
    return
  }

  const exited = new Promise((resolve) => {
    child.once('exit', resolve)
  })

  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      timeout: Math.min(timeoutMs, 10_000),
      windowsHide: true,
    })
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill()
      } catch {
        // The process exited between taskkill and the direct-root fallback.
      }
    }
  } else if (child.exitCode === null && child.signalCode === null) {
    child.kill()
  }

  if (child.exitCode === null && child.signalCode === null) {
    await Promise.race([exited, sleep(timeoutMs)])
  }
}

export function stopWindowsProcessesUsingProfile(directory) {
  if (process.platform !== 'win32') {
    return true
  }

  const result = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      [
        "$ErrorActionPreference = 'Stop'",
        '$profile = $env:ZEROCHAT_BROWSER_PROFILE_TO_STOP',
        "if ([string]::IsNullOrWhiteSpace($profile)) { throw 'Browser profile path is missing.' }",
        '$browserProcesses = @(',
        "  Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='msedge.exe' OR Name='chromium.exe'\"",
        ')',
        '$roots = @($browserProcesses | Where-Object {',
        "  $_.Name -match '^(chrome|msedge|chromium)(\\.exe)?$' -and",
        '  $_.CommandLine -and',
        '  $_.CommandLine.IndexOf($profile, [System.StringComparison]::OrdinalIgnoreCase) -ge 0',
        '})',
        'if ($roots.Count -eq 0) { exit 0 }',
        '$all = @(Get-CimInstance Win32_Process)',
        '$targetIds = [System.Collections.Generic.HashSet[int]]::new()',
        '$queue = [System.Collections.Generic.Queue[int]]::new()',
        '$order = [System.Collections.Generic.List[int]]::new()',
        'foreach ($root in $roots) {',
        '  if ($targetIds.Add([int]$root.ProcessId)) {',
        '    $queue.Enqueue([int]$root.ProcessId)',
        '    $order.Add([int]$root.ProcessId)',
        '  }',
        '}',
        'while ($queue.Count -gt 0) {',
        '  $parentId = $queue.Dequeue()',
        '  foreach ($child in @($all | Where-Object { $_.ParentProcessId -eq $parentId })) {',
        '    if ($targetIds.Add([int]$child.ProcessId)) {',
        '      $queue.Enqueue([int]$child.ProcessId)',
        '      $order.Add([int]$child.ProcessId)',
        '    }',
        '  }',
        '}',
        '$order.Reverse()',
        '$targetProcessIds = @($order)',
        'for ($attempt = 0; $attempt -lt 30; $attempt += 1) {',
        '  $remaining = @(Get-Process -Id $targetProcessIds -ErrorAction SilentlyContinue)',
        '  if ($remaining.Count -eq 0) { exit 0 }',
        '  foreach ($process in $remaining) {',
        '    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue',
        '  }',
        '  Start-Sleep -Milliseconds 100',
        '}',
        'exit 3',
      ].join('\n'),
    ],
    {
      env: {
        ...process.env,
        ZEROCHAT_BROWSER_PROFILE_TO_STOP: directory,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
      windowsHide: true,
    },
  )

  if (result.error) {
    throw result.error
  }

  if (result.status === 3) {
    return false
  }

  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`
    throw new Error(`Windows browser profile process cleanup failed: ${detail}`)
  }

  return true
}

async function removeDirectoryWithRetryInternal(target, attempts, prepareProfileRemoval) {
  if (process.platform === 'win32' && prepareProfileRemoval) {
    // On Windows, taskkill can report Chrome's root process before every
    // descendant has released the profile directory handle.
    await prepareProfileRemoval()
    await sleep(250)
  }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true })
      return true
    } catch {
      // Chromium's child processes can retain profile handles briefly after
      // taskkill reports the browser tree as terminated on Windows.
      await prepareProfileRemoval?.()
      await sleep(Math.min(1500, 200 + attempt * 100))
    }
  }

  try {
    await prepareProfileRemoval?.()
    await rm(target, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

export async function removeDirectoryWithRetry(target, attempts = 30) {
  return removeDirectoryWithRetryInternal(target, attempts)
}

export async function removeBrowserProfileWithRetry(target, attempts = 30) {
  return removeDirectoryWithRetryInternal(target, attempts, () => {
    stopWindowsProcessesUsingProfile(target)
  })
}
