import { createServerModuleRunnerTransport } from 'vite'
import {
  ESModulesEvaluator,
  ModuleRunner,
  createNodeImportMeta,
} from 'vite/module-runner'

export const VITE_SSR_MODULE_TRANSPORT_TIMEOUT_MS = 180_000

export function createBoundedViteSsrModuleTransport(hotChannel) {
  const transport = createServerModuleRunnerTransport({ channel: hotChannel })
  transport.timeout = VITE_SSR_MODULE_TRANSPORT_TIMEOUT_MS
  return transport
}

export function createBoundedViteSsrModuleRunner(server) {
  const hotChannel = server?.environments?.ssr?.hot

  if (!hotChannel) {
    throw new Error('Vite SSR environment hot channel is unavailable.')
  }

  return new ModuleRunner(
    {
      transport: createBoundedViteSsrModuleTransport(hotChannel),
      createImportMeta: createNodeImportMeta,
      sourcemapInterceptor: false,
      hmr: false,
    },
    new ESModulesEvaluator(),
  )
}
