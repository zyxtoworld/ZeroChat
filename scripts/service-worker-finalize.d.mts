export interface FinalizedServiceWorkerBuild {
  assetPaths: string[]
  cacheVersion: string
}

export function collectStaticAssetPaths(outDir: string): Promise<string[]>

export function createStaticAssetVersion(
  outDir: string,
  assetPaths: string[],
  serviceWorkerTemplate?: string,
): Promise<string>

export function finalizeServiceWorkerTemplate(
  template: string,
  assetPaths: string[],
  cacheVersion: string,
): string

export function finalizeServiceWorkerBuild(
  outDir: string,
): Promise<FinalizedServiceWorkerBuild>
