import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { inflateSync } from 'node:zlib'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function paethPredictor(left, up, upperLeft) {
  const estimate = left + up - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upperLeftDistance = Math.abs(estimate - upperLeft)
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left
  if (upDistance <= upperLeftDistance) return up
  return upperLeft
}

function pngChannels(colorType) {
  if (colorType === 0 || colorType === 3) return 1
  if (colorType === 2) return 3
  if (colorType === 4) return 2
  if (colorType === 6) return 4
  throw new Error(`Unsupported PNG color type: ${colorType}`)
}

function parsePng(buffer) {
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('Screenshot is not a PNG')
  }
  let offset = 8
  let header = null
  let palette = null
  const idat = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
    const start = offset + 8
    const end = start + length
    if (end + 4 > buffer.length) throw new Error(`PNG chunk is truncated: ${type}`)
    const data = buffer.subarray(start, end)
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
      }
    } else if (type === 'PLTE') {
      palette = data
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset = end + 4
  }
  if (!header || idat.length === 0) throw new Error('PNG is missing image data')
  return { ...header, idat: Buffer.concat(idat), palette }
}

function samplePixel(row, x, channels, colorType, palette) {
  const offset = x * channels
  if (colorType === 0) return `${row[offset]},${row[offset]},${row[offset]},255`
  if (colorType === 2) return `${row[offset]},${row[offset + 1]},${row[offset + 2]},255`
  if (colorType === 3) {
    const paletteOffset = row[offset] * 3
    if (!palette || paletteOffset + 2 >= palette.length) return '0,0,0,255'
    return `${palette[paletteOffset]},${palette[paletteOffset + 1]},${palette[paletteOffset + 2]},255`
  }
  if (colorType === 4) return `${row[offset]},${row[offset]},${row[offset]},${row[offset + 1]}`
  return `${row[offset]},${row[offset + 1]},${row[offset + 2]},${row[offset + 3]}`
}

export function analyzePngScreenshot(buffer, viewport, name) {
  const png = parsePng(buffer)
  assert.equal(png.width, viewport.width, `${name} width must match the viewport`)
  assert.equal(png.height, viewport.height, `${name} height must match the viewport`)
  assert.equal(png.bitDepth, 8, `${name} must use 8-bit PNG samples`)

  const channels = pngChannels(png.colorType)
  const rowLength = png.width * channels
  const inflated = inflateSync(png.idat)
  const expectedLength = (rowLength + 1) * png.height
  assert.ok(inflated.length >= expectedLength, `${name} PNG payload is truncated`)

  const sampleStep = Math.max(1, Math.floor((png.width * png.height) / 8000))
  const colors = new Set()
  let previousRow = Buffer.alloc(rowLength)
  let offset = 0
  let pixel = 0
  for (let y = 0; y < png.height; y += 1) {
    const filter = inflated[offset]
    offset += 1
    const source = inflated.subarray(offset, offset + rowLength)
    offset += rowLength
    const row = Buffer.alloc(rowLength)
    for (let x = 0; x < rowLength; x += 1) {
      const left = x >= channels ? row[x - channels] : 0
      const up = previousRow[x] ?? 0
      const upperLeft = x >= channels ? previousRow[x - channels] : 0
      if (filter === 0) row[x] = source[x]
      else if (filter === 1) row[x] = (source[x] + left) & 0xff
      else if (filter === 2) row[x] = (source[x] + up) & 0xff
      else if (filter === 3) row[x] = (source[x] + Math.floor((left + up) / 2)) & 0xff
      else if (filter === 4) row[x] = (source[x] + paethPredictor(left, up, upperLeft)) & 0xff
      else throw new Error(`${name} uses unsupported PNG filter ${filter}`)
    }
    for (let x = 0; x < png.width; x += 1) {
      if (pixel % sampleStep === 0) colors.add(samplePixel(row, x, channels, png.colorType, png.palette))
      pixel += 1
      if (colors.size >= 256) break
    }
    previousRow = row
  }
  assert.ok(colors.size >= 16, `${name} appears blank (${colors.size} sampled colors)`)
  return { bytes: buffer.length, distinctSampledColors: colors.size }
}

export async function writeVisualGallery(directory, records) {
  const cards = records.map((record) => {
    const title = `${String(record.index).padStart(2, '0')}. ${record.name}`
    const viewport = `${record.viewport.width}x${record.viewport.height}`
    const quality = `${record.analysis.distinctSampledColors} colors · ${Math.round(record.analysis.bytes / 1024)} KB`
    return `<figure class="shot"><a href="${escapeHtml(record.file)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(record.file)}" alt="${escapeHtml(title)}" loading="lazy"></a><figcaption><strong>${escapeHtml(title)}</strong><span>${escapeHtml(`${viewport} · ${quality}`)}</span></figcaption></figure>`
  }).join('\n')
  await writeFile(path.join(directory, 'visual-audit-gallery.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ZeroChat visual audit</title><style>:root{color-scheme:dark;font-family:system-ui;background:#101511;color:#e5ece5}body{margin:0;padding:24px}header{max-width:1120px;margin:0 auto 20px}h1{font-size:22px;letter-spacing:0}p{color:#aeb8ad;line-height:1.5}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px;max-width:1900px;margin:auto}.shot{margin:0;border:1px solid #283229;border-radius:8px;background:#151b16;overflow:hidden}.shot a{display:block;background:#0b0f0c}.shot img{display:block;width:100%;height:300px;object-fit:contain}figcaption{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;font-size:13px;line-height:1.35}figcaption span{color:#9aa699;white-space:nowrap}</style></head><body><header><h1>ZeroChat visual audit</h1><p>Inspect desktop, mobile, compact, RTL, language, settings, chat, and recovery states from the current production page.</p></header><main class="grid">${cards}</main></body></html>`, 'utf8')
}

export async function writeVisualContactSheet(cdp, directory, evaluate) {
  const galleryUrl = pathToFileURL(path.join(directory, 'visual-audit-gallery.html')).href
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1960, height: 1100, deviceScaleFactor: 1, mobile: false })
  await cdp.send('Page.navigate', { url: galleryUrl })
  await evaluate(`new Promise((resolve) => { const done = () => resolve(document.readyState); if (document.readyState === 'complete') done(); else window.addEventListener('load', done, { once: true }) })`, true)
  await evaluate(`Promise.all(Array.from(document.images).map((image) => { image.loading = 'eager'; if (image.complete && image.naturalWidth > 0) return true; return new Promise((resolve, reject) => { image.addEventListener('load', () => resolve(true), { once: true }); image.addEventListener('error', () => reject(new Error('visual gallery image failed')), { once: true }) }) }))`, true)
  const metrics = await cdp.send('Page.getLayoutMetrics')
  const { width, height } = metrics.cssContentSize
  const result = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 82, fromSurface: true, captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.ceil(width), height: Math.ceil(height), scale: 1 } })
  const contactSheet = Buffer.from(result.data, 'base64')
  const contactSheetPath = path.join(directory, 'visual-audit-contact-sheet.jpg')
  await writeFile(contactSheetPath, contactSheet)
  return {
    path: path.resolve(contactSheetPath),
    bytes: contactSheet.length,
    sha256: createHash('sha256').update(contactSheet).digest('hex').toUpperCase(),
    width: Math.ceil(width),
    height: Math.ceil(height),
  }
}
