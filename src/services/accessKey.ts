const encoder = new TextEncoder()
const ACCESS_KEY_PREFIX = 'zerochat-access:v1:'

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

export async function accessKeyFromPassword(password: string): Promise<string> {
  if (!password) {
    return ''
  }

  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`${ACCESS_KEY_PREFIX}${password}`),
  )

  return bytesToBase64Url(new Uint8Array(digest))
}
