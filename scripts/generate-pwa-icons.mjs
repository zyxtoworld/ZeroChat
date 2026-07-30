import { writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const pngSizes = [180, 192, 512]
const appleIconSizes = new Map([
  ['Icon-App-20x20@1x.png', 20],
  ['Icon-App-20x20@2x.png', 40],
  ['Icon-App-20x20@3x.png', 60],
  ['Icon-App-29x29@1x.png', 29],
  ['Icon-App-29x29@2x.png', 58],
  ['Icon-App-29x29@3x.png', 87],
  ['Icon-App-40x40@1x.png', 40],
  ['Icon-App-40x40@2x.png', 80],
  ['Icon-App-40x40@3x.png', 120],
  ['Icon-App-60x60@2x.png', 120],
  ['Icon-App-60x60@3x.png', 180],
  ['Icon-App-76x76@1x.png', 76],
  ['Icon-App-76x76@2x.png', 152],
  ['Icon-App-83.5x83.5@2x.png', 167],
  ['Icon-App-1024x1024@1x.png', 1024],
  ['Icon-Mac-16x16@1x.png', 16],
  ['Icon-Mac-16x16@2x.png', 32],
  ['Icon-Mac-32x32@1x.png', 32],
  ['Icon-Mac-32x32@2x.png', 64],
  ['Icon-Mac-128x128@1x.png', 128],
  ['Icon-Mac-128x128@2x.png', 256],
  ['Icon-Mac-256x256@1x.png', 256],
  ['Icon-Mac-256x256@2x.png', 512],
  ['Icon-Mac-512x512@1x.png', 512],
  ['Icon-Mac-512x512@2x.png', 1024],
])
const windowsSquareAssets = new Map([
  ['Square44x44Logo.png', 44],
  ['Square71x71Logo.png', 71],
  ['Square150x150Logo.png', 150],
  ['Square310x310Logo.png', 310],
  ['StoreLogo.png', 50],
  ['Square44x44Logo.targetsize-16.png', 16],
  ['Square44x44Logo.targetsize-16_altform-unplated.png', 16],
  ['Square44x44Logo.targetsize-24.png', 24],
  ['Square44x44Logo.targetsize-24_altform-unplated.png', 24],
  ['Square44x44Logo.targetsize-32.png', 32],
  ['Square44x44Logo.targetsize-32_altform-unplated.png', 32],
  ['Square44x44Logo.targetsize-48.png', 48],
  ['Square44x44Logo.targetsize-48_altform-unplated.png', 48],
  ['Square44x44Logo.targetsize-256.png', 256],
  ['Square44x44Logo.targetsize-256_altform-unplated.png', 256],
])

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#0F1117"/>
  <circle cx="256" cy="214" r="214" fill="#312E81"/>
  <path d="M96 318c36 86 158 127 267 61" fill="none" stroke="#22D3EE" stroke-linecap="round" stroke-width="20"/>
  <path d="M416 188c-40-68-144-93-241-47" fill="none" stroke="#FACC15" stroke-linecap="round" stroke-width="20"/>
  <path d="M256 111c-89 0-154 62-154 143 0 79 64 140 151 140h11l-38 38c-10 10 2 27 15 19l79-45c57-22 90-80 90-152 0-81-65-143-154-143Zm0 62c52 0 92 34 92 81s-40 81-92 81-92-34-92-81 40-81 92-81Z" fill="#6366F1" fill-rule="evenodd"/>
  <path d="M224 238h67M224 273h43" fill="none" stroke="#EEF2FF" stroke-linecap="round" stroke-width="18"/>
</svg>
`.replace(/>\s+</g, '><').trim()
const androidForegroundXml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#312E81"
        android:pathData="M54,13a41,41 0,1 0,0.1 0z" />
    <path
        android:fillColor="#00000000"
        android:strokeColor="#22D3EE"
        android:strokeWidth="4.8"
        android:strokeLineCap="round"
        android:pathData="M20,67c8,18 33,27 56,13" />
    <path
        android:fillColor="#00000000"
        android:strokeColor="#FACC15"
        android:strokeWidth="4.8"
        android:strokeLineCap="round"
        android:pathData="M88,39c-8,-14 -30,-19 -50,-10" />
    <path
        android:fillColor="#6366F1"
        android:fillType="evenOdd"
        android:pathData="M54,22C35,22 21,35 21,53c0,17 14,30 32,30h2.4l-8,8c-2.2,2.2 0.4,5.8 3.2,4.1l16.7,-9.5C79.5,81 86.5,68.7 86.5,53C86.5,35 72.5,22 54,22ZM54,35c11,0 19.5,7.2 19.5,18S65,71 54,71s-19.5,-7.2 -19.5,-18S43,35 54,35Z" />
    <path
        android:fillColor="#00000000"
        android:strokeColor="#EEF2FF"
        android:strokeWidth="4.4"
        android:strokeLineCap="round"
        android:pathData="M47,50h14M47,57h9" />
</vector>
`
const androidBackgroundXml = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#0F1117" />
</shape>
`

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  return value >>> 0
})

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type)
  const output = Buffer.alloc(12 + data.length)
  output.writeUInt32BE(data.length, 0)
  typeBuffer.copy(output, 4)
  data.copy(output, 8)
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length)
  return output
}

const indexedPaletteColors = [
  [15, 17, 23],
  [30, 27, 75],
  [49, 46, 129],
  [67, 56, 202],
  [99, 102, 241],
  [129, 140, 248],
  [165, 180, 252],
  [238, 242, 255],
  [34, 211, 238],
  [14, 116, 144],
  [250, 204, 21],
  [202, 138, 4],
  [248, 250, 252],
  [17, 24, 39],
  [79, 70, 229],
  [0, 0, 0],
]
function indexedPngColorIndex(color) {
  let bestIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY

  for (let index = 0; index < indexedPaletteColors.length; index += 1) {
    const candidate = indexedPaletteColors[index]
    const distance =
      (color[0] - candidate[0]) ** 2 +
      (color[1] - candidate[1]) ** 2 +
      (color[2] - candidate[2]) ** 2

    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  }

  return bestIndex
}

function hex(value) {
  const normalized = value.replace('#', '')
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
    255,
  ]
}

function mix(a, b, t) {
  const clamped = Math.min(1, Math.max(0, t))
  return [
    a[0] + (b[0] - a[0]) * clamped,
    a[1] + (b[1] - a[1]) * clamped,
    a[2] + (b[2] - a[2]) * clamped,
    a[3] + (b[3] - a[3]) * clamped,
  ]
}

function over(bottom, top) {
  const alpha = top[3] / 255
  const inverse = 1 - alpha
  return [
    top[0] * alpha + bottom[0] * inverse,
    top[1] * alpha + bottom[1] * inverse,
    top[2] * alpha + bottom[2] * inverse,
    255 * (alpha + (bottom[3] / 255) * inverse),
  ]
}

function insideRoundedRect(x, y, left, top, width, height, radius) {
  const px = Math.abs(x - (left + width / 2)) - width / 2 + radius
  const py = Math.abs(y - (top + height / 2)) - height / 2 + radius
  return Math.min(Math.max(px, py), 0) + Math.hypot(Math.max(px, 0), Math.max(py, 0)) <= radius
}

function insideCircle(x, y, cx, cy, radius) {
  return Math.hypot(x - cx, y - cy) <= radius
}

function distanceToSegment(x, y, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(x - (ax + dx * t), y - (ay + dy * t))
}

function insideTriangle(x, y, ax, ay, bx, by, cx, cy) {
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  const s = ((ay - cy) * (x - cx) + (cx - ax) * (y - cy)) / area
  const t = ((cy - by) * (x - cx) + (bx - cx) * (y - cy)) / area
  const u = 1 - s - t
  return s >= 0 && t >= 0 && u >= 0
}

function bubbleShape(x, y) {
  return (
    insideCircle(x, y, 256, 254, 154) ||
    insideRoundedRect(x, y, 126, 142, 260, 214, 80) ||
    insideTriangle(x, y, 232, 350, 218, 438, 314, 362)
  )
}

function iconColorAt(x, y, opaque = false) {
  if (!insideRoundedRect(x, y, 0, 0, 512, 512, 112)) {
    return opaque ? hex('#0F1117') : [0, 0, 0, 0]
  }

  let color = hex('#0F1117')
  if (insideCircle(x, y, 256, 214, 214)) {
    color = hex('#312E81')
  }

  const orbitDistance = Math.abs(Math.hypot((x - 256) / 184, (y - 260) / 150) - 1) * 150
  const orbitAngle = Math.atan2((y - 260) / 150, (x - 256) / 184)
  if (
    orbitDistance < 8 &&
    ((orbitAngle > 0.45 && orbitAngle < 2.55 && y > 238) ||
      (orbitAngle < -0.32 && orbitAngle > -2.65 && y < 246))
  ) {
    color = x < 256 ? hex('#22D3EE') : hex('#FACC15')
  }

  if (bubbleShape(x, y)) {
    color = hex('#6366F1')
  }

  if (distanceToSegment(x, y, 220, 238, 298, 238) < 9 || distanceToSegment(x, y, 220, 274, 274, 274) < 9) {
    color = over(color, hex('#EEF2FF'))
  }

  return color
}

function encodePng(width, height, colorAt, { channels = 4 } = {}) {
  const pixels = Buffer.alloc(width * height * channels)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = colorAt(x, y)
      const offset = (y * width + x) * channels
      pixels[offset] = Math.round(color[0])
      pixels[offset + 1] = Math.round(color[1])
      pixels[offset + 2] = Math.round(color[2])
      if (channels === 4) {
        pixels[offset + 3] = Math.round(color[3])
      }
    }
  }

  const raw = Buffer.alloc(height * (width * channels + 1))
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * channels + 1)
    raw[rowOffset] = 0
    pixels.copy(
      raw,
      rowOffset + 1,
      y * width * channels,
      (y + 1) * width * channels,
    )
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = channels === 3 ? 2 : 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    pngSignature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function encodeIndexedPng(width, height, colorAt) {
  const packedWidth = Math.ceil(width / 2)
  const packedRaw = Buffer.alloc(height * (packedWidth + 1))
  const byteRaw = Buffer.alloc(height * (width + 1))
  const indexes = Buffer.alloc(width * height)
  const usedPaletteIndexes = new Set()

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = indexedPngColorIndex(colorAt(x, y)) & 0x0f
      indexes[y * width + x] = index
      usedPaletteIndexes.add(index)
    }
  }

  const compactPaletteIndexes = [...usedPaletteIndexes].sort((a, b) => a - b)
  const compactPalette = Buffer.from(
    compactPaletteIndexes.flatMap((index) => indexedPaletteColors[index]),
  )
  const compactIndexFor = new Map(
    compactPaletteIndexes.map((index, compactIndex) => [index, compactIndex]),
  )

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (packedWidth + 1)
    const byteRowOffset = y * (width + 1)
    packedRaw[rowOffset] = 0
    byteRaw[byteRowOffset] = 0

    for (let x = 0; x < width; x += 1) {
      const index = compactIndexFor.get(indexes[y * width + x]) ?? 0
      const byteOffset = rowOffset + 1 + Math.floor(x / 2)
      byteRaw[byteRowOffset + 1 + x] = index

      if (x % 2 === 0) {
        packedRaw[byteOffset] = index << 4
      } else {
        packedRaw[byteOffset] |= index
      }
    }
  }

  const packedIdat = deflateSync(packedRaw, { level: 9 })
  const byteIdat = deflateSync(byteRaw, { level: 9 })
  const usePackedIndexes = packedIdat.length <= byteIdat.length

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = usePackedIndexes ? 4 : 8
  ihdr[9] = 3
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    pngSignature,
    chunk('IHDR', ihdr),
    chunk('PLTE', compactPalette),
    chunk('IDAT', usePackedIndexes ? packedIdat : byteIdat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function renderPng(size, { channels = 4, indexed = false, opaque = true } = {}) {
  const samples = indexed ? 1 : size >= 256 ? 2 : 3
  const colorAt = (x, y) => {
      let accumulated = [0, 0, 0, 0]
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const ux = ((x + (sx + 0.5) / samples) / size) * 512
          const uy = ((y + (sy + 0.5) / samples) / size) * 512
          accumulated = accumulated.map((value, index) => value + iconColorAt(ux, uy, opaque)[index])
        }
      }
      const scale = samples * samples
      return accumulated.map((value) => value / scale)
  }

  return indexed
    ? encodeIndexedPng(size, size, colorAt)
    : encodePng(size, size, colorAt, { channels })
}

function renderRectPng(width, height) {
  const iconSize = Math.min(height * 0.72, width * 0.42)
  const left = (width - iconSize) / 2
  const top = (height - iconSize) / 2

  return encodePng(width, height, (x, y) => {
    if (x < left || x > left + iconSize || y < top || y > top + iconSize) {
      return hex('#0F1117')
    }

    const ux = ((x - left) / iconSize) * 512
    const uy = ((y - top) / iconSize) * 512
    return iconColorAt(ux, uy, true)
  })
}

function icoFromPngs(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)

  let imageOffset = 6 + entries.length * 16
  const directories = []
  const images = []

  for (const { size, data } of entries) {
    const directory = Buffer.alloc(16)
    directory[0] = size === 256 ? 0 : size
    directory[1] = size === 256 ? 0 : size
    directory[2] = 0
    directory[3] = 0
    directory.writeUInt16LE(1, 4)
    directory.writeUInt16LE(32, 6)
    directory.writeUInt32LE(data.length, 8)
    directory.writeUInt32LE(imageOffset, 12)
    directories.push(directory)
    images.push(data)
    imageOffset += data.length
  }

  return Buffer.concat([header, ...directories, ...images])
}

async function main() {
  await writeFile('public/favicon.svg', svg)
  const pngs = new Map()
  for (const size of pngSizes) {
    const data = renderPng(size, { indexed: true })
    pngs.set(size, data)
    await writeFile(`public/icon-${size}.png`, data)
  }
  await writeFile(
    'public/favicon.ico',
    icoFromPngs([16, 32, 48].map((size) => ({
      size,
      data: renderPng(size, { indexed: true }),
    }))),
  )
  await writeFile(
    'apps/windows/ZeroChat/ZeroChat.ico',
    icoFromPngs([16, 32, 48, 64, 128, 256].map((size) => ({ size, data: renderPng(size) }))),
  )
  await writeFile(
    'apps/linux/data/icons/hicolor/scalable/apps/app.zerochat.client.svg',
    svg,
  )
  await writeFile(
    'apps/android/app/src/main/res/drawable/ic_launcher_foreground.xml',
    androidForegroundXml,
  )
  await writeFile(
    'apps/android/app/src/main/res/drawable/ic_launcher_background.xml',
    androidBackgroundXml,
  )
  for (const [filename, size] of appleIconSizes) {
    await writeFile(
      `apps/apple/App/Assets.xcassets/AppIcon.appiconset/${filename}`,
      renderPng(size),
    )
  }
  for (const [filename, size] of windowsSquareAssets) {
    await writeFile(`apps/windows/msix/Assets/${filename}`, renderPng(size))
  }
  await writeFile('apps/windows/msix/Assets/Wide310x150Logo.png', renderRectPng(310, 150))
  await writeFile('apps/windows/msix/Assets/SplashScreen.png', renderRectPng(620, 300))
}

await main()
