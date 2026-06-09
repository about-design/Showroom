const { app, BrowserWindow, shell } = require('electron')
const path = require('path')
const http = require('http')
const fs = require('fs')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
const PORT = 5050

/** Pfad zum dist-Ordner: im Dev Projektroot/dist, gepackt in app.asar neben electron/ */
function getDistPath() {
  if (isDev) {
    return path.join(app.getAppPath(), 'dist')
  }
  return path.join(__dirname, '..', 'dist')
}

/** Einfacher Static-File-Server für dist/ */
function createServer(distPath) {
  const mime = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.glb': 'model/gltf-binary',
    '.usdz': 'model/vnd.usdz+zip',
  }

  return http.createServer((req, res) => {
    let urlPath = req.url.split('?')[0] || '/'
    if (urlPath === '/') urlPath = '/index.html'
    const filePath = path.join(distPath, urlPath.replace(/^\//, '').replace(/\.\./g, ''))
    const ext = path.extname(filePath)

    fs.readFile(filePath, (err, data) => {
      if (err) {
        if (urlPath === '/' || urlPath === '') {
          const index = path.join(distPath, 'index.html')
          return fs.readFile(index, (e, d) => {
            if (e) { res.writeHead(404); res.end('Not found'); return }
            res.setHeader('Content-Type', 'text/html')
            res.end(d)
          })
        }
        res.writeHead(404)
        res.end('Not found')
        return
      }
      res.setHeader('Content-Type', mime[ext] || 'application/octet-stream')
      res.end(data)
    })
  })
}

let mainWindow = null
let server = null

function createWindow() {
  const distPath = getDistPath()
  const distExists = fs.existsSync(distPath)
  if (!distExists) {
    console.error('Dist-Ordner nicht gefunden:', distPath)
    app.quit()
    return
  }

  server = createServer(distPath)
  server.listen(PORT, '127.0.0.1', () => {
    const iconPath = path.join(__dirname, 'icon.ico')
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
      icon: fs.existsSync(iconPath) ? iconPath : undefined,
      show: false,
    })

    mainWindow.loadURL(`http://127.0.0.1:${PORT}/`)
    mainWindow.once('ready-to-show', () => mainWindow.show())
    mainWindow.on('closed', () => { mainWindow = null })

    // Links zu Dashboard/Konverter im gleichen Fenster; externe Links im Browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const u = new URL(url)
        if (u.hostname === '127.0.0.1' && u.port === String(PORT)) {
          mainWindow.loadURL(url)
          return { action: 'deny' }
        }
      } catch (_) {}
      shell.openExternal(url)
      return { action: 'deny' }
    })
  })

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
        show: false,
      })
      mainWindow.loadURL(`http://127.0.0.1:${PORT}/`)
      mainWindow.once('ready-to-show', () => mainWindow.show())
      mainWindow.on('closed', () => { mainWindow = null })
    }
  })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (server) server.close()
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
