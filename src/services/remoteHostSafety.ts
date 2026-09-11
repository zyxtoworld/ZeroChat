function hostnameWithoutBrackets(value: string): string {
  return value.toLowerCase().replace(/^\[|\]$|\.+$/g, '')
}

function parseIpv4(value: string): number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    return null
  }

  const octets = value.split('.').map(Number)

  return octets.every((octet) => octet <= 255)
    ? octets
    : null
}

function isDisallowedIpv4([first, second, third]: number[]): boolean {
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && (second >> 4) === 1) ||
    (first === 192 && second === 0 && (third === 0 || third === 2)) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 &&
      ((second >> 1) === 9 || (second === 51 && third === 100))) ||
    (first === 203 && second === 0 && third === 113) ||
    (first === 100 && (second >> 6) === 1) ||
    first >= 224
  )
}

function allZero(hextets: number[], start: number, end: number): boolean {
  return !hextets.slice(start, end).some(Boolean)
}

function parseIpv6Hextets(value: string): number[] | null {
  try {
    const [left, right] = new URL(`https://[${value}]`)
      .hostname.slice(1, -1)
      .split('::')
      .map((side) =>
        side ? side.split(':').map((part) => parseInt(part, 16)) : [],
      )
    return [...left, ...Array(8 - left.length - right.length).fill(0), ...right]
  } catch {
    return null
  }
}

function embeddedIpv4FromIpv6(hextets: number[]): number[] | null {
  const fromWords = (firstWord: number, secondWord: number): number[] => [
    firstWord >> 8,
    firstWord & 255,
    secondWord >> 8,
    secondWord & 255,
  ]

  if (
    allZero(hextets, 0, 5) &&
    (hextets[5] === 0 || hextets[5] === 0xffff)
  ) {
    return fromWords(hextets[6], hextets[7])
  }

  if (
    hextets[0] === 0x64 &&
    hextets[1] === 0xff9b &&
    (allZero(hextets, 2, 6) ||
      (hextets[2] === 1 && allZero(hextets, 3, 6)))
  ) {
    return fromWords(hextets[6], hextets[7])
  }

  if (hextets[0] === 0x2002) {
    return fromWords(hextets[1], hextets[2])
  }

  return null
}

export function isDisallowedRemoteHost(hostname: string): boolean {
  const normalized = hostnameWithoutBrackets(hostname)
  const ipv4 = parseIpv4(normalized)

  if (/(?:^|\.)(?:localhost|local|lan|home\.arpa)$/u.test(normalized)) {
    return true
  }

  if (ipv4) {
    return normalized !== ipv4.join('.') || isDisallowedIpv4(ipv4)
  }

  if (!normalized.includes(':')) {
    return (
      !normalized.includes('.') ||
      /^(?:[0-9]+|0x[0-9a-f]+)(?:\.(?:[0-9]+|0x[0-9a-f]+))+$/iu.test(
        normalized,
      )
    )
  }

  const ipv6 = parseIpv6Hextets(normalized)
  if (!ipv6) {
    return false
  }

  const embeddedIpv4 = embeddedIpv4FromIpv6(ipv6)

  if (embeddedIpv4 && isDisallowedIpv4(embeddedIpv4)) {
    return true
  }

  const first = ipv6[0]

  return (
    normalized === '::' ||
    normalized === '::1' ||
    (first === 0x100 && allZero(ipv6, 1, 4)) ||
    (first === 0x2001 && ipv6[1] === 0x0db8) ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00
  )
}
