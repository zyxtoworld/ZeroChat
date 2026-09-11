import { spawnSync } from 'node:child_process'
import { rm } from 'node:fs/promises'

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function childIsRunning(child) {
  return child?.exitCode === null && child?.signalCode === null
}

function childProcessExists(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}

function childExitEvidence(child, platform = process.platform, exitedByEvent = false) {
  const childExited =
    exitedByEvent ||
    !childIsRunning(child) ||
    (platform === 'win32' && Number.isInteger(child?.pid) && !childProcessExists(child.pid))
  return {
    childPid: Number.isInteger(child?.pid) ? child.pid : undefined,
    childExited,
  }
}

function createProcessTreeError(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.childQuiesced = false
  return error
}

function createCleanupAggregate(errors, message) {
  const error = new AggregateError(errors, message)
  error.childQuiesced = false
  return error
}

function defaultProcessGroupExists(pid, processKill) {
  try {
    processKill(-Math.abs(pid), 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') {
      return false
    }
    return true
  }
}

async function waitForChildExit(child, timeoutMs) {
  if (!childIsRunning(child)) {
    return true
  }

  await new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      child.off?.('exit', onExit)
      reject(new Error(`Child process did not exit after ${timeoutMs}ms.`))
    }, timeoutMs)

    const onExit = () => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolve(true)
    }

    child.once('exit', onExit)
    if (!childIsRunning(child)) {
      onExit()
      return
    }

  })
}

async function waitForProcessGroupGone(pid, timeoutMs, processGroupExists, sleepImpl) {
  const deadline = Date.now() + timeoutMs

  while (processGroupExists(pid)) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      return false
    }
    await sleepImpl(Math.min(25, remaining))
  }

  return true
}

async function terminateUngroupedChildRoot(child, timeoutMs, processKill, platform) {
  const termGraceMs = Math.max(10, Math.floor(timeoutMs / 2))
  let rootTerminationError
  let rootExited = !childIsRunning(child)

  if (childIsRunning(child)) {
    try {
      processKill(child.pid, 'SIGTERM')
    } catch (error) {
      if (error?.code !== 'ESRCH') rootTerminationError = error
    }

    if (!rootTerminationError) {
      try {
        rootExited = await waitForChildExit(child, termGraceMs)
      } catch (error) {
        rootTerminationError = error
      }
    }
  }

  if (childIsRunning(child)) {
    try {
      processKill(child.pid, 'SIGKILL')
    } catch (error) {
      if (error?.code !== 'ESRCH') rootTerminationError = rootTerminationError ?? error
    }

    try {
      rootExited = await waitForChildExit(child, Math.max(10, timeoutMs - termGraceMs))
    } catch (error) {
      rootTerminationError = rootTerminationError ?? error
    }
  }

  const cleanupError = createProcessTreeError(
    rootTerminationError
      ? 'Child root was terminated, but its descendant tree could not be proven owned.'
      : 'Child is not a detached process-group leader; descendant cleanup is unverified.',
    rootTerminationError,
  )
  Object.assign(cleanupError, childExitEvidence(child, platform, rootExited))
  throw cleanupError
}

export async function stopChildProcessTree(
  child,
  timeoutMs = 5000,
  {
    platform = process.platform,
    processKill = process.kill.bind(process),
    processGroupExists = (pid) => defaultProcessGroupExists(pid, processKill),
    spawnSyncImpl = spawnSync,
    ownedProcessTree = false,
    processGroupLeader = child?.zerochatProcessGroupLeader === true,
    sleepImpl = sleep,
  } = {},
) {
  if (!child) {
    return { childQuiesced: true }
  }

  if (!child.pid) {
    throw createProcessTreeError('Child process has no PID; process-tree cleanup is unverified.')
  }

  if (platform === 'win32') {
    if (ownedProcessTree) {
      try {
        if (childIsRunning(child)) {
          child.kill()
        }
      } catch (error) {
        throw createProcessTreeError(
          'Unable to terminate the owned Windows process launcher.',
          error,
        )
      }

      let childExited
      try {
        childExited = await waitForChildExit(child, timeoutMs)
      } catch (error) {
        const cleanupError = createProcessTreeError(
          'Owned Windows process launcher did not close after termination.',
          error,
        )
        Object.assign(cleanupError, childExitEvidence(child, platform))
        throw cleanupError
      }

      return {
        childQuiesced: true,
        ...childExitEvidence(child, platform, childExited),
        processTreeConfirmed: true,
      }
    }

    const result = spawnSyncImpl('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      timeout: Math.min(timeoutMs, 10_000),
      windowsHide: true,
    })

    if (result?.error || result?.status !== 0 || result?.signal) {
      if (childIsRunning(child)) {
        try {
          await waitForChildExit(child, timeoutMs)
        } catch {
          // Preserve the original taskkill failure and its unconfirmed exit evidence.
        }
      }
      const cleanupError = createProcessTreeError(
        `taskkill did not confirm the child process tree was terminated (status ${
          result?.status ?? 'unknown'
        }).`,
        result?.error,
      )
      Object.assign(cleanupError, childExitEvidence(child, platform))
      throw cleanupError
    }

    let childExited
    try {
      childExited = await waitForChildExit(child, timeoutMs)
    } catch (error) {
      const cleanupError = createProcessTreeError(
        'Child process tree did not close after taskkill.',
        error,
      )
      Object.assign(cleanupError, childExitEvidence(child, platform))
      throw cleanupError
    }

    return {
      childQuiesced: true,
      ...childExitEvidence(child, platform, childExited),
      processTreeConfirmed: true,
    }
  }

  const groupId = -Math.abs(child.pid)
  const groupExists = processGroupExists(child.pid)
  if (!processGroupLeader || (childIsRunning(child) && !groupExists)) {
    await terminateUngroupedChildRoot(child, timeoutMs, processKill, platform)
  }

  if (!childIsRunning(child) && !groupExists) {
    return { childQuiesced: true, ...childExitEvidence(child, platform), processTreeConfirmed: true }
  }

  try {
    processKill(groupId, 'SIGTERM')
  } catch (error) {
    if (error?.code !== 'ESRCH' || processGroupExists(child.pid)) {
      const cleanupError = createProcessTreeError(
        'Unable to terminate the child process group.',
        error,
      )
      Object.assign(cleanupError, childExitEvidence(child, platform))
      throw cleanupError
    }
  }

  const termGraceMs = Math.max(10, Math.floor(timeoutMs / 2))
  let groupGone = await waitForProcessGroupGone(
    child.pid,
    termGraceMs,
    processGroupExists,
    sleepImpl,
  )

  if (!groupGone) {
    try {
      processKill(groupId, 'SIGKILL')
    } catch (error) {
      if (error?.code !== 'ESRCH' || processGroupExists(child.pid)) {
        const cleanupError = createProcessTreeError(
          'Unable to force-terminate the child process group.',
          error,
        )
        Object.assign(cleanupError, childExitEvidence(child, platform))
        throw cleanupError
      }
    }

    groupGone = await waitForProcessGroupGone(
      child.pid,
      Math.max(10, timeoutMs - termGraceMs),
      processGroupExists,
      sleepImpl,
    )
  }

  if (!groupGone) {
    const cleanupError = createProcessTreeError(
      'Child process group remained alive after bounded termination.',
    )
    Object.assign(cleanupError, childExitEvidence(child, platform))
    throw cleanupError
  }

  let childExited
  try {
    childExited = await waitForChildExit(child, timeoutMs)
  } catch (error) {
    const cleanupError = createProcessTreeError(
      'Child process root did not close after group termination.',
      error,
    )
    Object.assign(cleanupError, childExitEvidence(child, platform))
    throw cleanupError
  }

  return {
    childQuiesced: true,
    ...childExitEvidence(child, platform, childExited),
    processTreeConfirmed: true,
  }
}

export async function settleBrowserRuntimeCleanup({
  platform = process.platform,
  child,
  profilePath,
  stopProcessTree,
  removeProfile,
  additionalCleanup = [],
}) {
  let processTreeError
  let processTreeResult
  try {
    processTreeResult = await stopProcessTree()
  } catch (error) {
    processTreeError = error
  }

  let profileRemoved = false
  let profileError
  let profileResult
  try {
    profileRemoved = await removeProfile()
    profileResult = profileRemoved
    profileRemoved =
      profileResult === true ||
      (profileResult && typeof profileResult === 'object' && profileResult.profileRemoved === true)
    if (!profileRemoved) {
      profileError = createProcessTreeError('Browser profile cleanup did not remove its directory.')
    }
  } catch (error) {
    profileError = error
  }

  const additionalErrors = []
  for (const cleanup of additionalCleanup) {
    try {
      await cleanup()
    } catch (error) {
      additionalErrors.push(error)
    }
  }

  const expectedChildPid = Number.isInteger(child?.pid) ? child.pid : undefined
  const reportedChildPid = processTreeResult?.childPid ?? processTreeError?.childPid
  const childIdentityConfirmed =
    Number.isInteger(reportedChildPid) &&
    (expectedChildPid === undefined || reportedChildPid === expectedChildPid)
  const childExitConfirmed =
    processTreeResult?.childExited === true || processTreeError?.childExited === true
  const profileSweepConfirmed =
    profileResult &&
    typeof profileResult === 'object' &&
    profileResult.profileRemoved === true &&
    profileResult.exactProfileProcessesGone === true &&
    typeof profileResult.profilePath === 'string' &&
    (profilePath === undefined || profileResult.profilePath === profilePath)
  const windowsRecoveryConfirmed =
    platform === 'win32' &&
    Boolean(processTreeError) &&
    childIdentityConfirmed &&
    childExitConfirmed &&
    profileSweepConfirmed
  const processTreeErrorNeedsReporting =
    processTreeError &&
    (processTreeError?.childQuiesced !== false || !windowsRecoveryConfirmed)

  const errors = []
  if (profileError) {
    if (processTreeError) errors.push(processTreeError)
    errors.push(profileError)
  } else if (
    processTreeErrorNeedsReporting
  ) {
    errors.push(processTreeError)
  }
  errors.push(...additionalErrors)

  if (errors.length > 0) {
    if (errors.length === 1) {
      const [error] = errors
      if (error && typeof error === 'object') {
        error.childQuiesced = false
      }
      throw error
    }
    throw createCleanupAggregate(errors, 'Browser runtime cleanup failed.')
  }

  return {
    childQuiesced: true,
    profileRemoved: true,
    recoveredByProfileSweep: windowsRecoveryConfirmed,
  }
}

export function buildWindowsProfileProcessCleanupScript() {
  return [
    "$ErrorActionPreference = 'Stop'",
    '$profile = $env:ZEROCHAT_BROWSER_PROFILE_TO_STOP',
    "if ([string]::IsNullOrWhiteSpace($profile)) { throw 'Browser profile path is missing.' }",
    'function Normalize-ProfilePath([string] $value) {',
    '  if ([string]::IsNullOrWhiteSpace($value)) { return "" }',
    '  try {',
    '    $full = [System.IO.Path]::GetFullPath([string]$value)',
    '    if ($full.Length -gt 3) { return $full.TrimEnd([char]92, [char]47) }',
    '    return $full',
    '  } catch {',
    '    return ""',
    '  }',
    '}',
    '$targetProfile = Normalize-ProfilePath $profile',
    "$commandLineToArgvSource = @'",
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class ZeroChatCommandLine {',
    '  [DllImport("shell32.dll", SetLastError = true)]',
    '  private static extern IntPtr CommandLineToArgvW(',
    '    [MarshalAs(UnmanagedType.LPWStr)] string commandLine,',
    '    out int argc);',
    '  [DllImport("kernel32.dll")]',
    '  private static extern IntPtr LocalFree(IntPtr memory);',
    '  public static string[] Parse(string commandLine) {',
    '    if (String.IsNullOrWhiteSpace(commandLine)) return new string[0];',
    '    int argc;',
    '    IntPtr argv = CommandLineToArgvW(commandLine, out argc);',
    '    if (argv == IntPtr.Zero || argc <= 0) return new string[0];',
    '    try {',
    '      string[] result = new string[argc];',
    '      for (int index = 0; index < argc; index++) {',
    '        IntPtr value = Marshal.ReadIntPtr(argv, index * IntPtr.Size);',
    '        result[index] = Marshal.PtrToStringUni(value) ?? String.Empty;',
    '      }',
    '      return result;',
    '    } finally {',
    '      LocalFree(argv);',
    '    }',
    '  }',
    '}',
    "'@",
    'Add-Type -TypeDefinition $commandLineToArgvSource -Language CSharp',
    'function Read-UserDataDir([string] $commandLine) {',
    '  if ([string]::IsNullOrWhiteSpace($commandLine)) { return $null }',
    '  $arguments = [ZeroChatCommandLine]::Parse($commandLine)',
    '  $candidate = $null',
    '  for ($index = 1; $index -lt $arguments.Length; $index += 1) {',
    '    $argument = $arguments[$index]',
    '    if ($argument.StartsWith("--user-data-dir=", [System.StringComparison]::OrdinalIgnoreCase)) {',
    '      if ($null -ne $candidate) { return $null }',
    '      $candidate = $argument.Substring("--user-data-dir=".Length)',
    '      continue',
    '    }',
    '    if ($argument.Equals("--user-data-dir", [System.StringComparison]::OrdinalIgnoreCase)) {',
    '      if ($null -ne $candidate -or $index + 1 -ge $arguments.Length) { return $null }',
    '      $index += 1',
    '      $candidate = $arguments[$index]',
    '    }',
    '  }',
    '  return $candidate',
    '}',
    '$all = @(Get-CimInstance Win32_Process)',
    '$childrenByParent = @{}',
    'foreach ($process in $all) {',
    '  $parentId = [int]$process.ParentProcessId',
    '  if (-not $childrenByParent.ContainsKey($parentId)) {',
    '    $childrenByParent[$parentId] = [System.Collections.Generic.List[int]]::new()',
    '  }',
    '  $childrenByParent[$parentId].Add([int]$process.ProcessId)',
    '}',
    '$profileSeedIds = [System.Collections.Generic.HashSet[int]]::new()',
    'foreach ($process in $all) {',
    '  if ([string]$process.Name -notmatch \'^(chrome|msedge|chromium)\\.exe$\') { continue }',
    '  $candidateProfile = Read-UserDataDir ([string]$process.CommandLine)',
    '  if ([string]::IsNullOrWhiteSpace($candidateProfile)) { continue }',
    '  $normalizedCandidate = Normalize-ProfilePath $candidateProfile',
    '  if (-not [string]::Equals($normalizedCandidate, $targetProfile, [System.StringComparison]::OrdinalIgnoreCase)) { continue }',
    '  $profileSeedIds.Add([int]$process.ProcessId) | Out-Null',
    '}',
    '$processById = @{}',
    'foreach ($process in $all) { $processById[[int]$process.ProcessId] = $process }',
    '$targetIds = [System.Collections.Generic.HashSet[int]]::new()',
    '$pending = [System.Collections.Generic.Queue[int]]::new()',
    'foreach ($seedId in $profileSeedIds) {',
    '  if ($targetIds.Add($seedId)) { $pending.Enqueue($seedId) }',
    '}',
    'while ($pending.Count -gt 0) {',
    '  $parentId = $pending.Dequeue()',
    '  $children = $childrenByParent[$parentId]',
    '  if ($null -eq $children) { continue }',
    '  foreach ($childId in $children) {',
    '    if ($targetIds.Add($childId)) { $pending.Enqueue($childId) }',
    '  }',
    '}',
    '$targetRoots = [System.Collections.Generic.List[int]]::new()',
    'foreach ($targetId in ($targetIds | Sort-Object)) {',
    '  $process = $processById[[int]$targetId]',
    '  $parentId = 0',
    '  if ($null -ne $process) { $parentId = [int]$process.ParentProcessId }',
    '  if (-not $targetIds.Contains($parentId)) { $targetRoots.Add([int]$targetId) | Out-Null }',
    '}',
    '$order = [System.Collections.Generic.List[int]]::new()',
    '$visited = [System.Collections.Generic.HashSet[int]]::new()',
    'function Add-PostOrder([int] $processId) {',
    '  if (-not $targetIds.Contains($processId)) { return }',
    '  if (-not $visited.Add($processId)) { return }',
    '  $children = $childrenByParent[$processId]',
    '  if ($null -ne $children) {',
    '    foreach ($childId in ($children | Sort-Object)) { Add-PostOrder ([int]$childId) }',
    '  }',
    '  $order.Add($processId) | Out-Null',
    '}',
    'foreach ($rootId in ($targetRoots | Sort-Object)) { Add-PostOrder ([int]$rootId) }',
    'foreach ($targetId in ($targetIds | Sort-Object)) {',
    '  if (-not $visited.Contains([int]$targetId)) { Add-PostOrder ([int]$targetId) }',
    '}',
    'if ($order.Count -eq 0) { exit 0 }',
    '$targetProcessIds = @($order)',
    'for ($attempt = 0; $attempt -lt 30; $attempt += 1) {',
    '  $remainingCount = 0',
    '  foreach ($processId in $targetProcessIds) {',
    '    $process = Get-Process -Id ([int]$processId) -ErrorAction SilentlyContinue',
    '    if ($null -eq $process -or $process.HasExited) { continue }',
    '    $remainingCount += 1',
    '    Stop-Process -Id ([int]$processId) -Force -ErrorAction SilentlyContinue',
    '  }',
    '  if ($remainingCount -eq 0) { exit 0 }',
    '  Start-Sleep -Milliseconds 100',
    '}',
    'exit 3',
  ].join('\n')
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
      buildWindowsProfileProcessCleanupScript(),
    ],
    {
      env: {
        ...process.env,
        ZEROCHAT_BROWSER_PROFILE_TO_STOP: directory,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
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
    await prepareProfileRemoval()
    await sleep(250)
  }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true })
      return true
    } catch {
      if (process.platform === 'win32' && prepareProfileRemoval) {
        // Re-enumerate after a failed delete: descendants may have appeared
        // after the initial snapshot or released their handles late.
        await prepareProfileRemoval()
        await sleep(250)
      }
      // Chromium's child processes can retain profile handles briefly after
      // taskkill reports the browser tree as terminated on Windows.
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
    if (!stopWindowsProcessesUsingProfile(target)) {
      throw createProcessTreeError(
        'Windows browser profile process cleanup did not confirm quiescence.',
      )
    }
  })
}
