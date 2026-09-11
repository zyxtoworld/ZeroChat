import assert from 'node:assert/strict'
import test from 'node:test'

import {
  collectStaticImportClosure,
  staticImportSpecifiers,
} from '../bundle-static-imports.mjs'

test('collects recursive static imports but excludes dynamic imports', async () => {
  const assets = new Map([
    [
      'index.js',
      'import{a}from"./static.js";import*as importedNs from"./namespace.js";export{b}from"./reexport.js";export*from"./star.js";export*as exportedNs from"./namespace-reexport.js";import("./lazy.js");',
    ],
    ['static.js', 'import * as nested from "./nested.js";'],
    ['namespace.js', 'export const namespace = true;'],
    ['nested.js', 'export const nested = true;'],
    ['reexport.js', 'export{reexported}from"./reexport-nested.js";'],
    ['reexport-nested.js', 'export const reexported = true;'],
    ['namespace-reexport.js', 'export*as nestedNs from"./namespace-nested.js";'],
    ['namespace-nested.js', 'export const nestedNamespace = true;'],
    ['star.js', 'export const star = true;'],
    ['lazy.js', 'export const lazy = true;'],
  ])

  const closure = await collectStaticImportClosure({
    entryFiles: ['index.js'],
    readAsset: async (file) => assets.get(file) ?? '',
  })

  assert.deepEqual(closure, [
    'index.js',
    'static.js',
    'namespace.js',
    'reexport.js',
    'star.js',
    'namespace-reexport.js',
    'nested.js',
    'reexport-nested.js',
    'namespace-nested.js',
  ])
})

test('recognizes side-effect static imports without treating import calls as static', () => {
  assert.deepEqual(
    staticImportSpecifiers(
      'const source = "export{fake}from\\"./fake.js\\""; import "./side-effect.js"; import("./dynamic.js");',
    ),
    ['./side-effect.js'],
  )
})
