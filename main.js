const { app, BrowserWindow, ipcMain } = require("electron")
const path = require("path")
const express = require("express")
const http = require("http")
const socketIo = require("socket.io")
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js")
const qrcode = require("qrcode")
const qrcodeTerminal = require("qrcode-terminal")
const fs = require("fs")
const mime = require("mime-types")

// Mantener una referencia global del objeto window para evitar que la ventana
// se cierre automáticamente cuando el objeto JavaScript sea recogido por el recolector de basura.
let mainWindow

// Directorio de datos de la aplicación
const APP_DATA_DIR = path.join(app.getPath("userData"), "whatsapp-crm-data")
const SESSIONS_DIR = path.join(APP_DATA_DIR, "sessions")
const MEDIA_DIR = path.join(APP_DATA_DIR, "media")
const SESSIONS_METADATA_FILE = path.join(SESSIONS_DIR, "metadata.json")

// Crear directorios si no existen
if (!fs.existsSync(APP_DATA_DIR)) {
  fs.mkdirSync(APP_DATA_DIR, { recursive: true })
}
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true })
}
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true })
}

// Cargar metadatos de sesiones
let sessionsMetadata = {}
if (fs.existsSync(SESSIONS_METADATA_FILE)) {
  try {
    const data = fs.readFileSync(SESSIONS_METADATA_FILE, "utf8")
    sessionsMetadata = JSON.parse(data)
    console.log("Metadata de sesiones cargada:", Object.keys(sessionsMetadata).length, "sesiones")
  } catch (err) {
    console.error("Error al cargar metadata de sesiones:", err)
    sessionsMetadata = {}
  }
}

// Guardar metadatos de sesiones
function saveSessionsMetadata() {
  try {
    fs.writeFileSync(SESSIONS_METADATA_FILE, JSON.stringify(sessionsMetadata, null, 2), "utf8")
    console.log("Metadata de sesiones guardada")
  } catch (err) {
    console.error("Error al guardar metadata de sesiones:", err)
  }
}

// Inicializar Express y Socket.io
const expressApp = express()
const server = http.createServer(expressApp)
const io = socketIo(server)

// Servir archivos estáticos
expressApp.use(express.static(path.join(__dirname, "public")))
expressApp.use("/media", express.static(MEDIA_DIR))
expressApp.use(express.json())

// Store active WhatsApp sessions
const sessions = {}

// Store chats and messages for each session
const sessionData = {}

// Debug route to check server status
expressApp.get("/api/status", (req, res) => {
  const status = {
    server: "running",
    sessions: Object.keys(sessions).map((id) => ({
      id,
      status: sessionData[id]?.status || "unknown",
      chatsCount: sessionData[id]?.chats?.length || 0,
      name: sessionsMetadata[id]?.name || `Sesión ${id.split("_")[1] || id}`,
    })),
    totalChats: Object.values(sessionData).reduce((total, data) => total + (data.chats?.length || 0), 0),
  }
  res.json(status)
})

// API endpoint to update session name
expressApp.post("/api/sessions/:sessionId/name", (req, res) => {
  const { sessionId } = req.params
  const { name } = req.body

  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "Nombre inválido" })
  }

  // Update session metadata
  if (!sessionsMetadata[sessionId]) {
    sessionsMetadata[sessionId] = {}
  }

  sessionsMetadata[sessionId].name = name
  saveSessionsMetadata()

  // Update session data
  if (sessionData[sessionId]) {
    sessionData[sessionId].name = name
  }

  // Notify clients
  io.emit("session_update", {
    id: sessionId,
    name: name,
  })

  res.json({ success: true, name })
})

// Guardar archivo multimedia
async function saveMedia(buffer, extension, sessionId, messageId) {
  // Crear directorio para la sesión si no existe
  const sessionMediaDir = path.join(MEDIA_DIR, sessionId)
  if (!fs.existsSync(sessionMediaDir)) {
    fs.mkdirSync(sessionMediaDir, { recursive: true })
  }

  // Generar nombre de archivo único
  const filename = `${messageId}.${extension}`
  const filePath = path.join(sessionMediaDir, filename)

  // Guardar archivo
  fs.writeFileSync(filePath, buffer)

  // Devolver ruta relativa para acceso web
  return `/media/${sessionId}/${filename}`
}

// Create a new WhatsApp session
function createWhatsAppSession(sessionId) {
  console.log(`Creando nueva sesión: ${sessionId}`)

  const sessionDir = path.join(SESSIONS_DIR, sessionId)

  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true })
  }

  // Get session name from metadata or use default
  const sessionName = sessionsMetadata[sessionId]?.name || `Sesión ${sessionId.split("_")[1] || sessionId}`

  // Initialize session data
  sessionData[sessionId] = {
    chats: [],
    messages: {},
    statusUpdates: [],
    qrCode: null,
    status: "initializing",
    name: sessionName,
  }

  // Create WhatsApp client
  const client = new Client({
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
      ],
      executablePath: getPuppeteerExecutablePath(),
    },
    authStrategy: new LocalAuth({
      clientId: sessionId,
      dataPath: sessionDir,
    }),
  })

  // QR code event
  client.on("qr", async (qr) => {
    console.log(`[${sessionId}] Código QR generado`)
    qrcodeTerminal.generate(qr, { small: true })

    try {
      const qrImage = await qrcode.toDataURL(qr)
      sessionData[sessionId].qrCode = qrImage
      sessionData[sessionId].status = "qr_ready"

      // Emit to all clients
      io.emit("session_update", {
        id: sessionId,
        status: "qr_ready",
        qrCode: qrImage,
        name: sessionData[sessionId].name,
      })
    } catch (err) {
      console.error(`[${sessionId}] Error al generar QR:`, err)
    }
  })

  // Ready event
  client.on("ready", async () => {
    console.log(`[${sessionId}] Cliente listo y conectado`)
    sessionData[sessionId].status = "connected"
    sessionData[sessionId].qrCode = null

    // Get client info
    try {
      const info = await client.getWid()
      sessionData[sessionId].phoneNumber = info.user

      // Update name if not already set by user
      if (!sessionsMetadata[sessionId] || !sessionsMetadata[sessionId].name) {
        sessionData[sessionId].name = `+${info.user}`

        // Save to metadata
        if (!sessionsMetadata[sessionId]) {
          sessionsMetadata[sessionId] = {}
        }
        sessionsMetadata[sessionId].name = `+${info.user}`
        saveSessionsMetadata()
      }

      console.log(`[${sessionId}] Número de teléfono: +${info.user}`)
    } catch (err) {
      console.error(`[${sessionId}] Error al obtener información:`, err)
    }

    // Emit to all clients
    io.emit("session_update", {
      id: sessionId,
      status: "connected",
      name: sessionData[sessionId].name,
    })

    // Load chats
    loadChats(sessionId)
  })

  // Authentication failure
  client.on("auth_failure", (msg) => {
    console.error(`[${sessionId}] Error de autenticación:`, msg)
    sessionData[sessionId].status = "auth_failure"

    io.emit("session_update", {
      id: sessionId,
      status: "auth_failure",
      error: msg,
      name: sessionData[sessionId].name,
    })
  })

  // Disconnected
  client.on("disconnected", (reason) => {
    console.log(`[${sessionId}] Cliente desconectado:`, reason)
    sessionData[sessionId].status = "disconnected"

    io.emit("session_update", {
      id: sessionId,
      status: "disconnected",
      reason: reason,
      name: sessionData[sessionId].name,
    })

    // Clean up
    client.destroy()
    delete sessions[sessionId]
  })

  // New message
  client.on("message", async (msg) => {
    console.log(`[${sessionId}] Nuevo mensaje de ${msg.from}: ${msg.body}`)

    // Store message
    if (!sessionData[sessionId].messages[msg.from]) {
      sessionData[sessionId].messages[msg.from] = []
    }

    // Procesar mensaje según su tipo
    let mediaUrl = null
    let mediaType = null

    try {
      // Verificar si el mensaje tiene contenido multimedia
      if (msg.hasMedia) {
        console.log(`[${sessionId}] Mensaje con contenido multimedia detectado`)
        
        // Descargar el contenido multimedia
        const media = await msg.downloadMedia()
        
        if (media) {
          const buffer = Buffer.from(media.data, "base64")
          
          // Determinar la extensión del archivo basado en el mimetype
          let extension = mime.extension(media.mimetype)
          if (!extension) {
            // Fallback para tipos comunes
            if (media.mimetype.startsWith("image/")) {
              extension = "jpg"
            } else if (media.mimetype.startsWith("audio/")) {
              extension = "mp3"
            } else if (media.mimetype.startsWith("video/")) {
              extension = "mp4"
            } else {
              extension = "bin"
            }
          }
          
          // Guardar el archivo
          mediaUrl = await saveMedia(buffer, extension, sessionId, msg.id.id)
          mediaType = media.mimetype
          
          console.log(`[${sessionId}] Archivo multimedia guardado: ${mediaUrl}`)
        }
      }
    } catch (err) {
      console.error(`[${sessionId}] Error al procesar contenido multimedia:`, err)
    }

    const messageData = {
      id: msg.id.id,
      from: msg.from,
      body: msg.body,
      timestamp: msg.timestamp,
      fromMe: false,
      sessionId: sessionId,
      mediaUrl: mediaUrl,
      mediaType: mediaType,
    }

    sessionData[sessionId].messages[msg.from].push(messageData)

    // Update chat preview
    let previewText = msg.body
    if (!previewText && mediaType) {
      if (mediaType.startsWith("image/")) {
        previewText = "📷 Imagen"
      } else if (mediaType.startsWith("audio/")) {
        previewText = "🔊 Audio"
      } else if (mediaType.startsWith("video/")) {
        previewText = "🎥 Video"
      } else {
        previewText = "📎 Archivo"
      }
    }
    
    updateChatPreview(sessionId, msg.from, previewText, msg.timestamp)

    // Emit message to clients
    io.emit("message", messageData)

    // Auto-reply if it contains hello/hi
    if (
      msg.body.toLowerCase().includes("hola") ||
      msg.body.toLowerCase().includes("buenos días") ||
      msg.body.toLowerCase().includes("buenas")
    ) {
      setTimeout(async () => {
        const reply = "¡Hola! Gracias por comunicarte. ¿En qué podemos ayudarte hoy?"

        try {
          const sentMessage = await client.sendMessage(msg.from, reply)

          // Store sent message
          const sentMessageData = {
            id: sentMessage.id.id,
            from: msg.from,
            body: reply,
            timestamp: Math.floor(Date.now() / 1000),
            fromMe: true,
            sessionId: sessionId,
          }

          sessionData[sessionId].messages[msg.from].push(sentMessageData)

          // Emit message to clients
          io.emit("message", sentMessageData)
        } catch (err) {
          console.error(`[${sessionId}] Error al enviar respuesta:`, err)
        }
      }, 1000)
    }
  })

  // Initialize client
  console.log(`[${sessionId}] Inicializando cliente...`)
  client.initialize().catch((err) => {
    console.error(`[${sessionId}] Error al inicializar:`, err)
    sessionData[sessionId].status = "error"

    io.emit("session_update", {
      id: sessionId,
      status: "error",
      error: err.message,
      name: sessionData[sessionId].name,
    })
  })

  // Store client in sessions
  sessions[sessionId] = client

  return sessionId
}

// Load chats for a session
async function loadChats(sessionId) {
  const client = sessions[sessionId]
  if (!client) {
    console.error(`[${sessionId}] No se puede cargar chats: cliente no encontrado`)
    return
  }

  try {
    console.log(`[${sessionId}] Cargando chats...`)
    const whatsappChats = await client.getChats()
    console.log(`[${sessionId}] ${whatsappChats.length} chats encontrados`)

    // Filter for individual chats (not groups)
    const individualChats = whatsappChats.filter((chat) => !chat.isGroup)
    console.log(`[${sessionId}] ${individualChats.length} chats individuales`)

    // Clear existing chats
    sessionData[sessionId].chats = []

    // Map to simpler objects
    individualChats.forEach((chat) => {
      const chatData = {
        id: chat.id._serialized,
        name: chat.name,
        lastMessage: chat.lastMessage ? chat.lastMessage.body : null,
        timestamp: chat.lastMessage ? chat.lastMessage.timestamp : null,
        sessionId: sessionId,
      }

      sessionData[sessionId].chats.push(chatData)
      console.log(
        `[${sessionId}] Chat añadido: ${chatData.name || chatData.id} - Último mensaje: ${chatData.lastMessage}`,
      )
    })

    // Sort chats by timestamp (newest first)
    sessionData[sessionId].chats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))

    console.log(`[${sessionId}] Cargados ${sessionData[sessionId].chats.length} chats`)

    // Emit chats to clients
    io.emit("chats", {
      sessionId: sessionId,
      chats: sessionData[sessionId].chats,
    })

    // Also emit all chats combined
    emitAllChats()
  } catch (err) {
    console.error(`[${sessionId}] Error al cargar chats:`, err)
  }
}

// Update chat preview
function updateChatPreview(sessionId, chatId, message, timestamp) {
  if (!sessionData[sessionId]) {
    console.error(`[${sessionId}] No se puede actualizar chat: sesión no encontrada`)
    return
  }

  const chatIndex = sessionData[sessionId].chats.findIndex((c) => c.id === chatId)

  if (chatIndex !== -1) {
    // Update existing chat
    sessionData[sessionId].chats[chatIndex].lastMessage = message
    sessionData[sessionId].chats[chatIndex].timestamp = timestamp
    console.log(`[${sessionId}] Chat actualizado: ${sessionData[sessionId].chats[chatIndex].name || chatId}`)
  } else {
    // New chat, add to list
    const newChat = {
      id: chatId,
      name: chatId.split("@")[0],
      lastMessage: message,
      timestamp: timestamp,
      sessionId: sessionId,
    }
    sessionData[sessionId].chats.push(newChat)
    console.log(`[${sessionId}] Nuevo chat añadido: ${newChat.name || chatId}`)
  }

  // Sort chats by timestamp (newest first)
  sessionData[sessionId].chats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))

  // Emit updated chats
  io.emit("chats", {
    sessionId: sessionId,
    chats: sessionData[sessionId].chats,
  })

  // Also emit all chats combined
  emitAllChats()
}

// Emit all chats from all sessions combined
function emitAllChats() {
  // Combine all chats from all sessions
  let allChats = []

  Object.keys(sessionData).forEach((sessionId) => {
    if (sessionData[sessionId].chats && sessionData[sessionId].chats.length > 0) {
      allChats = allChats.concat(sessionData[sessionId].chats)
    }
  })

  // Sort all chats by timestamp
  allChats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))

  console.log(`Emitiendo ${allChats.length} chats combinados`)

  // Emit combined chats
  io.emit("all_chats", allChats)
}

// Socket.io connection
io.on("connection", (socket) => {
  console.log("Nuevo cliente conectado")

  // Send current sessions
  const currentSessions = Object.keys(sessionData).map((id) => ({
    id,
    status: sessionData[id].status,
    name: sessionData[id].name,
    qrCode: sessionData[id].qrCode,
  }))

  console.log(`Enviando ${currentSessions.length} sesiones al cliente`)
  socket.emit("sessions", currentSessions)

  // Send all chats combined
  emitAllChats()

  // Create new session
  socket.on("create_session", (callback) => {
    const sessionId = "session_" + Date.now()
    createWhatsAppSession(sessionId)

    if (callback) callback(sessionId)
  })

  // Get session status
  socket.on("get_session", (sessionId, callback) => {
    if (sessionData[sessionId]) {
      callback({
        id: sessionId,
        status: sessionData[sessionId].status,
        name: sessionData[sessionId].name,
        qrCode: sessionData[sessionId].qrCode,
      })
    } else {
      callback(null)
    }
  })

  // Update session name
  socket.on("update_session_name", ({ sessionId, name }, callback) => {
    if (!sessionData[sessionId]) {
      if (callback) callback({ success: false, error: "Sesión no encontrada" })
      return
    }

    // Update session name
    sessionData[sessionId].name = name

    // Update metadata
    if (!sessionsMetadata[sessionId]) {
      sessionsMetadata[sessionId] = {}
    }
    sessionsMetadata[sessionId].name = name
    saveSessionsMetadata()

    // Notify clients
    io.emit("session_update", {
      id: sessionId,
      name: name,
    })

    if (callback) callback({ success: true })
  })

  // Delete session
  socket.on("delete_session", (sessionId, callback) => {
    if (sessions[sessionId]) {
      sessions[sessionId].destroy()
      delete sessions[sessionId]
      delete sessionData[sessionId]

      // Remove from metadata
      if (sessionsMetadata[sessionId]) {
        delete sessionsMetadata[sessionId]
        saveSessionsMetadata()
      }

      io.emit("session_deleted", sessionId)

      if (callback) callback(true)
    } else {
      if (callback) callback(false)
    }
  })

  // Get chats for a session
  socket.on("get_session_chats", (sessionId, callback) => {
    console.log(`Cliente solicitó chats para sesión ${sessionId}`)
    if (sessionData[sessionId] && sessionData[sessionId].chats) {
      console.log(`Enviando ${sessionData[sessionId].chats.length} chats para sesión ${sessionId}`)
      callback(sessionData[sessionId].chats)
    } else {
      console.log(`No hay chats para sesión ${sessionId}`)
      callback([])
    }
  })

  // Get all chats from all sessions
  socket.on("get_all_chats", (callback) => {
    let allChats = []

    Object.keys(sessionData).forEach((sessionId) => {
      if (sessionData[sessionId].chats && sessionData[sessionId].chats.length > 0) {
        allChats = allChats.concat(sessionData[sessionId].chats)
      }
    })

    // Sort all chats by timestamp
    allChats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))

    console.log(`Cliente solicitó todos los chats. Enviando ${allChats.length} chats combinados`)
    callback(allChats)
  })

  // Get messages for a chat
  socket.on("get_messages", ({ sessionId, chatId }, callback) => {
    console.log(`Cliente solicitó mensajes para chat ${chatId} de sesión ${sessionId}`)
    if (sessionData[sessionId] && sessionData[sessionId].messages[chatId]) {
      console.log(`Enviando ${sessionData[sessionId].messages[chatId].length} mensajes`)
      callback(sessionData[sessionId].messages[chatId])
    } else {
      console.log(`No hay mensajes para chat ${chatId} de sesión ${sessionId}`)
      callback([])
    }
  })

  // Send message
  socket.on("send_message", async (data, callback) => {
    const { sessionId, to, message } = data

    if (!sessions[sessionId]) {
      console.error(`No se puede enviar mensaje: sesión ${sessionId} no encontrada`)
      if (callback) callback({ success: false, error: "Sesión no encontrada" })
      return
    }

    try {
      console.log(`[${sessionId}] Enviando mensaje a ${to}: ${message}`)
      const client = sessions[sessionId]
      const sentMessage = await client.sendMessage(to, message)

      // Store sent message
      if (!sessionData[sessionId].messages[to]) {
        sessionData[sessionId].messages[to] = []
      }

      const messageData = {
        id: sentMessage.id.id,
        from: to,
        body: message,
        timestamp: Math.floor(Date.now() / 1000),
        fromMe: true,
        sessionId: sessionId,
      }

      sessionData[sessionId].messages[to].push(messageData)

      // Update chat preview
      updateChatPreview(sessionId, to, message, messageData.timestamp)

      // Emit message to all clients
      io.emit("message", messageData)

      if (callback) callback({ success: true })
    } catch (err) {
      console.error(`[${sessionId}] Error al enviar mensaje:`, err)
      if (callback) callback({ success: false, error: err.message })
    }
  })

  // Force refresh chats
  socket.on("refresh_chats", (sessionId, callback) => {
    console.log(`Cliente solicitó actualización de chats para sesión ${sessionId}`)

    if (sessionId && sessions[sessionId]) {
      loadChats(sessionId)
      if (callback) callback(true)
    } else if (!sessionId) {
      // Refresh all sessions
      Object.keys(sessions).forEach((id) => {
        loadChats(id)
      })
      if (callback) callback(true)
    } else {
      if (callback) callback(false)
    }
  })

  // Disconnect
  socket.on("disconnect", () => {
    console.log("Cliente desconectado")
  })
})

// Función para obtener la ruta del ejecutable de Chromium en Electron
function getPuppeteerExecutablePath() {
  // En producción, usar el Chromium incluido en Electron
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "node_modules",
      "puppeteer",
      ".local-chromium",
      "win64-982053",
      "chrome-win",
      "chrome.exe",
    )
  }

  // En desarrollo, dejar que puppeteer use su propio Chromium
  return null
}

// Crear la ventana principal
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    icon: path.join(__dirname, "public", "icon.ico"),
  })

  // Iniciar el servidor Express en un puerto disponible
  const PORT = process.env.PORT || 0 // El puerto 0 hace que el sistema operativo asigne un puerto disponible
  server.listen(PORT, () => {
    const serverPort = server.address().port
    console.log(`Servidor ejecutándose en http://localhost:${serverPort}`)

    // Cargar la aplicación desde el servidor local
    mainWindow.loadURL(`http://localhost:${serverPort}`)

    // Abrir DevTools en desarrollo
    if (!app.isPackaged && process.argv.includes("--dev")) {
      mainWindow.webContents.openDevTools()
    }
  })

  // Evento cuando la ventana se cierra
  mainWindow.on("closed", () => {
    mainWindow = null
  })
}

// Cuando Electron está listo, crear la ventana
app.whenReady().then(() => {
  createWindow()

  // En macOS, es común volver a crear una ventana cuando
  // se hace clic en el icono del dock y no hay otras ventanas abiertas.
  app.on("activate", () => {
    if (mainWindow === null) createWindow()
  })

  // Restaurar sesiones existentes
  fs.readdir(SESSIONS_DIR, (err, files) => {
    if (err) {
      console.error("Error al leer directorio de sesiones:", err)
      return
    }

    // Filter out non-directory files and metadata.json
    const sessionDirs = files.filter(
      (file) => file !== "metadata.json" && fs.statSync(path.join(SESSIONS_DIR, file)).isDirectory(),
    )

    console.log(`Encontradas ${sessionDirs.length} sesiones guardadas`)

    // Restore each session
    sessionDirs.forEach((dir) => {
      console.log(`Restaurando sesión: ${dir}`)
      createWhatsAppSession(dir)
    })
  })
})

// Salir cuando todas las ventanas estén cerradas, excepto en macOS
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

// Manejar el cierre de la aplicación
app.on("before-quit", () => {
  // Cerrar todas las sesiones de WhatsApp
  Object.keys(sessions).forEach((sessionId) => {
    try {
      console.log(`Cerrando sesión: ${sessionId}`)
      sessions[sessionId].destroy()
    } catch (err) {
      console.error(`Error al cerrar sesión ${sessionId}:`, err)
    }
  })
})
