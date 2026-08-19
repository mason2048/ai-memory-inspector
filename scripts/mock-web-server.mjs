import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

const host = process.env.MOCK_WEB_HOST ?? '127.0.0.1'
const port = Number(process.env.MOCK_WEB_PORT ?? 4399)
const distRoot = resolve(process.cwd(), 'dist')

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.webmanifest', 'application/manifest+json'],
])

const securityHeaders = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'none'",
    "font-src 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
  ].join('; '),
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
}

function isInsideDist(filePath) {
  return filePath === distRoot || filePath.startsWith(`${distRoot}${sep}`)
}

async function resolveRequestPath(pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const candidate = resolve(distRoot, decoded === '/' ? 'index.html' : decoded.slice(1))
  if (!isInsideDist(candidate)) return null
  try {
    const details = await stat(candidate)
    if (details.isFile()) return candidate
  } catch {
    // Unknown application paths are served by the static SPA entry point.
  }
  return extname(decoded) ? null : resolve(distRoot, 'index.html')
}

const server = createServer(async (request, response) => {
  Object.entries(securityHeaders).forEach(([name, value]) => response.setHeader(name, value))
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' })
    response.end('Method not allowed')
    return
  }

  const requestUrl = new URL(request.url ?? '/', `http://${host}:${port}`)
  const filePath = await resolveRequestPath(requestUrl.pathname)
  if (!filePath) {
    response.writeHead(404)
    response.end('Not found')
    return
  }

  try {
    const body = await readFile(filePath)
    const extension = extname(filePath)
    response.writeHead(200, {
      'Cache-Control':
        extension === '.html'
          ? 'no-cache, no-store, must-revalidate'
          : 'public, max-age=31536000, immutable',
      'Content-Type': contentTypes.get(extension) ?? 'application/octet-stream',
    })
    response.end(request.method === 'HEAD' ? undefined : body)
  } catch {
    response.writeHead(500)
    response.end('Static artifact is unavailable')
  }
})

server.listen(port, host, () => {
  process.stdout.write(`Mock production web server listening at http://${host}:${port}\n`)
})

const stop = () => server.close(() => process.exit(0))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
