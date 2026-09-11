import type { ReactNode } from 'react'

export function RuntimeFailureSmoke(): ReactNode {
  throw new Error('runtime-failure-smoke-sentinel')
}
