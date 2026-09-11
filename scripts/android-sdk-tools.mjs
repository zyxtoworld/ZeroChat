import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  symlinkSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function hasNonAscii(value) {
  return /[^\x00-\x7F]/u.test(value)
}

export function asciiSdkRoot(
  sdk,
  {
    platform = process.platform,
    tempDirectory = os.tmpdir(),
    fs = {
      exists: existsSync,
      lstat: lstatSync,
      mkdir: mkdirSync,
      readlink: readlinkSync,
      symlink: symlinkSync,
    },
  } = {},
) {
  if (typeof sdk !== 'string' || !sdk) {
    return null
  }

  if (platform !== 'win32' || !hasNonAscii(sdk)) {
    return sdk
  }

  if (!fs.exists(sdk)) {
    return null
  }

  const linkRoot = path.join(tempDirectory, 'zerochat-android-sdk-junctions')
  const linkName = createHash('sha256').update(path.resolve(sdk)).digest('hex').slice(0, 16)
  const linkPath = path.join(linkRoot, linkName)

  try {
    fs.mkdir(linkRoot, { recursive: true })

    if (fs.exists(linkPath)) {
      const link = fs.lstat(linkPath)
      if (!link.isSymbolicLink()) {
        return null
      }

      const target = fs.readlink(linkPath)
      return path.resolve(target).toLowerCase() === path.resolve(sdk).toLowerCase()
        ? linkPath
        : null
    }

    fs.symlink(sdk, linkPath, 'junction')
    return linkPath
  } catch {
    return null
  }
}
