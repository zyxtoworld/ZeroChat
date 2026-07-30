import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

import { finalizeServiceWorkerBuild } from './scripts/service-worker-finalize.mjs'

function finalizeServiceWorkerPlugin() {
  let outDir = ''

  return {
    name: 'finalize-service-worker',
    apply: 'build' as const,
    configResolved(config: { build: { outDir: string }; root: string }) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    async closeBundle() {
      await finalizeServiceWorkerBuild(outDir)
    },
  }
}

function omitWindowsWebViewCspInDev() {
  return {
    name: 'omit-windows-webview-csp-in-dev',
    apply: 'serve' as const,
    transformIndexHtml: (html: string) =>
      html.replace(
        /\s*<meta\s+data-zerochat-windows-csp\b[^>]*>\s*/u,
        '\n',
      ),
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    omitWindowsWebViewCspInDev(),
    finalizeServiceWorkerPlugin(),
    {
      name: 'compact-html-shell',
      apply: 'build',
      transformIndexHtml: {
        order: 'post',
        handler: (html) =>
          html
    .replace(/<style>([\s\S]*?)<\/style>/g, (_, css: string) =>
      `<style>${css
        .replace(/\s+/g, ' ')
        .replace(/\s*([{}:;,])\s*/g, '$1')
        .replace(/;}/g, '}')
        .trim()}</style>`,
    )
            .replace(/\s+/g, ' ')
            .replace(/>\s+</g, '><')
            .replace(/\s+\/>/g, '/>')
    .replace(/\s+>/g, '>')
    .replace(/\/>/g, '>')
    .replace(/="(true|any|\d+)"/g, '=$1')
            .trim(),
      },
    },
  ],
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'react-dom/client': 'preact/compat/client',
      'react/jsx-runtime': 'preact/jsx-runtime',
    },
  },
  server: {
    watch: {
      ignored: ['**/.codex-*/**', '**/dist/**'],
    },
  },
})
