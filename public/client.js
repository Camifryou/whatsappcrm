// Connect to Socket.io server
const socket = io()

// DOM Elements
const chatsList = document.getElementById("chats-tab")
const messagesContainer = document.getElementById("messages-container")
const messageInput = document.getElementById("message-input")
const sendButton = document.getElementById("send-button")
const greetingButton = document.getElementById("greeting-button")
const endChatButton = document.getElementById("end-chat-button")
const tabButtons = document.querySelectorAll(".tab-button")
const tabContents = {
  chats: document.getElementById("chats-tab"),
  sessions: document.getElementById("sessions-tab"),
}
const statusElement = document.getElementById("connection-status")
const sessionsContainer = document.getElementById("sessions-container")
const addSessionBtn = document.getElementById("add-session-btn")
const qrModal = document.getElementById("qr-modal")
const modalQrcode = document.getElementById("modal-qrcode")
const closeModal = document.querySelector(".close-modal")

// Store sessions, chats and unread messages
let sessions = []
let allChats = []
const unreadMessages = {}

// Current active chat
let activeChat = null

// Session colors mapping
const sessionColors = {
  0: "session-color-1",
  1: "session-color-2",
  2: "session-color-3",
  3: "session-color-4",
}

// Debug info
const debugInfo = {
  socketConnected: false,
  lastSocketEvent: null,
  sessionsReceived: 0,
  chatsReceived: 0,
  errors: [],
}

// Format timestamp to readable time
function formatTime(timestamp) {
  const date = new Date(timestamp * 1000)
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

// Format date for chat list
function formatDate(timestamp) {
  const date = new Date(timestamp * 1000)
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === now.toDateString()) {
    return formatTime(timestamp)
  } else if (date.toDateString() === yesterday.toDateString()) {
    return "Ayer"
  } else {
    return date.toLocaleDateString([], { day: "2-digit", month: "2-digit" })
  }
}

// Get session color class
function getSessionColorClass(sessionId) {
  const index = sessions.findIndex((s) => s.id === sessionId)
  return sessionColors[index % Object.keys(sessionColors).length]
}

// Update connection status
function updateStatus(status, message) {
  if (statusElement) {
    statusElement.className = `status-indicator ${status}`
    statusElement.textContent = message
  }
}

// Show debug info
function showDebugInfo() {
  console.log("=== DEBUG INFO ===")
  console.log("Socket conectado:", debugInfo.socketConnected)
  console.log("Último evento de socket:", debugInfo.lastSocketEvent)
  console.log("Sesiones recibidas:", debugInfo.sessionsReceived)
  console.log("Chats recibidos:", debugInfo.chatsReceived)
  console.log("Sesiones:", sessions)
  console.log("Chats:", allChats)
  console.log("Errores:", debugInfo.errors)

  // Show in UI
  const debugModal = document.createElement("div")
  debugModal.className = "modal"
  debugModal.style.display = "block"

  debugModal.innerHTML = `
    <div class="modal-content" style="width: 80%; max-width: 800px; overflow: auto; max-height: 80vh;">
      <span class="close-modal">&times;</span>
      <h2>Información de Depuración</h2>
      <pre style="background: #f5f5f5; padding: 15px; border-radius: 5px; overflow: auto; max-height: 60vh;">
Socket conectado: ${debugInfo.socketConnected}
Último evento de socket: ${debugInfo.lastSocketEvent}
Sesiones recibidas: ${debugInfo.sessionsReceived}
Chats recibidos: ${debugInfo.chatsReceived}

Sesiones: ${JSON.stringify(sessions, null, 2)}

Chats: ${JSON.stringify(allChats, null, 2)}

Errores: ${JSON.stringify(debugInfo.errors, null, 2)}
      </pre>
      <button id="refresh-debug" style="margin-top: 15px; padding: 8px 16px; background: #007aff; color: white; border: none; border-radius: 5px; cursor: pointer;">Actualizar datos</button>
      <button id="force-refresh-chats" style="margin-top: 15px; margin-left: 10px; padding: 8px 16px; background: #34c759; color: white; border: none; border-radius: 5px; cursor: pointer;">Forzar actualización de chats</button>
    </div>
  `

  document.body.appendChild(debugModal)

  // Close button
  const closeBtn = debugModal.querySelector(".close-modal")
  closeBtn.addEventListener("click", () => {
    document.body.removeChild(debugModal)
  })

  // Refresh button
  const refreshBtn = document.getElementById("refresh-debug")
  refreshBtn.addEventListener("click", () => {
    document.body.removeChild(debugModal)
    showDebugInfo()
  })

  // Force refresh chats
  const forceRefreshBtn = document.getElementById("force-refresh-chats")
  forceRefreshBtn.addEventListener("click", () => {
    socket.emit("refresh_chats", null, (success) => {
      alert(success ? "Actualización de chats iniciada" : "Error al actualizar chats")
    })
  })
}

// Edit session name
function editSessionName(sessionId, currentName) {
  const newName = prompt("Ingresa un nuevo nombre para la sesión:", currentName)

  if (newName && newName.trim() !== "") {
    // Update via API
    fetch(`/api/sessions/${sessionId}/name`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: newName.trim() }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          console.log("Nombre de sesión actualizado:", data.name)
        } else {
          console.error("Error al actualizar nombre de sesión:", data.error)
          alert("Error al actualizar nombre: " + data.error)
        }
      })
      .catch((error) => {
        console.error("Error en la solicitud:", error)
        alert("Error en la solicitud: " + error.message)
      })
  }
}

// Handle tab switching
tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const tabName = button.getAttribute("data-tab")

    // Update active button
    tabButtons.forEach((btn) => btn.classList.remove("active"))
    button.classList.add("active")

    // Show active tab content
    Object.keys(tabContents).forEach((tab) => {
      if (tab === tabName) {
        tabContents[tab].classList.remove("hidden")
      } else {
        tabContents[tab].classList.add("hidden")
      }
    })
  })
})

// Socket connection events
socket.on("connect", () => {
  console.log("Conectado al servidor")
  updateStatus("connected", "Conectado")
  debugInfo.socketConnected = true
  debugInfo.lastSocketEvent = "connect"

  // Request data on connect
  socket.emit("get_all_chats", (chats) => {
    console.log("Chats recibidos:", chats.length)
    allChats = chats
    debugInfo.chatsReceived = chats.length
    renderChats()
  })
})

socket.on("disconnect", () => {
  console.log("Desconectado del servidor")
  updateStatus("error", "Desconectado del servidor")
  debugInfo.socketConnected = false
  debugInfo.lastSocketEvent = "disconnect"
  debugInfo.errors.push({
    time: new Date().toISOString(),
    type: "socket_disconnect",
  })
})

socket.on("error", (error) => {
  console.error("Error:", error)
  updateStatus("error", "Error: " + error)
  debugInfo.lastSocketEvent = "error"
  debugInfo.errors.push({
    time: new Date().toISOString(),
    type: "socket_error",
    error,
  })
})

// Listen for sessions
socket.on("sessions", (receivedSessions) => {
  console.log("Sesiones recibidas:", receivedSessions)
  sessions = receivedSessions
  debugInfo.sessionsReceived = receivedSessions.length
  debugInfo.lastSocketEvent = "sessions"
  renderSessions()
})

// Listen for session updates
socket.on("session_update", (session) => {
  console.log("Actualización de sesión:", session)
  debugInfo.lastSocketEvent = "session_update"

  // Update session in the list
  const index = sessions.findIndex((s) => s.id === session.id)
  if (index !== -1) {
    sessions[index] = { ...sessions[index], ...session }
  } else {
    sessions.push(session)
  }

  renderSessions()

  // If this is a QR code update and the modal is open for this session, update the QR
  if (session.qrCode && qrModal.style.display === "block" && qrModal.dataset.sessionId === session.id) {
    modalQrcode.innerHTML = `<img src="${session.qrCode}" alt="WhatsApp QR Code" style="width: 100%; max-width: 280px;">`
  }

  // If session is connected, request chats
  if (session.status === "connected") {
    socket.emit("get_session_chats", session.id, (chats) => {
      console.log(`Chats recibidos para sesión ${session.id}:`, chats.length)
    })
  }
})

// Listen for session deletion
socket.on("session_deleted", (sessionId) => {
  console.log("Sesión eliminada:", sessionId)
  debugInfo.lastSocketEvent = "session_deleted"

  // Remove session from the list
  sessions = sessions.filter((s) => s.id !== sessionId)
  renderSessions()

  // Close modal if open for this session
  if (qrModal.style.display === "block" && qrModal.dataset.sessionId === sessionId) {
    qrModal.style.display = "none"
  }

  // Update chats list
  socket.emit("get_all_chats", (chats) => {
    allChats = chats
    debugInfo.chatsReceived = chats.length
    renderChats()
  })
})

// Listen for chats from a specific session
socket.on("chats", (data) => {
  console.log(`Chats recibidos para sesión ${data.sessionId}:`, data.chats.length)
  debugInfo.lastSocketEvent = "chats"

  // Request all chats to update the combined list
  socket.emit("get_all_chats", (chats) => {
    allChats = chats
    debugInfo.chatsReceived = chats.length
    renderChats()
  })
})

// Listen for all chats
socket.on("all_chats", (chats) => {
  console.log("Todos los chats recibidos:", chats.length)
  allChats = chats
  debugInfo.chatsReceived = chats.length
  debugInfo.lastSocketEvent = "all_chats"
  renderChats()
})

// Listen for new messages
socket.on("message", (message) => {
  console.log("Mensaje recibido:", message)
  debugInfo.lastSocketEvent = "message"

  // If this is the active chat, add message to the UI
  if (activeChat && message.from === activeChat.id && message.sessionId === activeChat.sessionId) {
    addMessage(message)
    scrollToBottom()

    // Mark as read if it's the active chat
    if (unreadMessages[`${message.sessionId}_${message.from}`]) {
      unreadMessages[`${message.sessionId}_${message.from}`] = 0
      renderChats() // Update UI to remove unread indicator
    }
  } else {
    // Mark as unread if it's not the active chat
    const key = `${message.sessionId}_${message.from}`
    if (!unreadMessages[key]) {
      unreadMessages[key] = 0
    }
    unreadMessages[key]++
    renderChats() // Update UI to show unread indicator
  }

  // Request updated chats
  socket.emit("get_all_chats", (chats) => {
    allChats = chats
    debugInfo.chatsReceived = chats.length
    renderChats()
  })
})

// Render sessions in the sessions tab
function renderSessions() {
  if (!sessionsContainer) return

  sessionsContainer.innerHTML = ""

  if (sessions.length === 0) {
    sessionsContainer.innerHTML = `
      <div class="no-sessions-message">
        <p>No hay sesiones disponibles. Crea una nueva sesión para comenzar.</p>
      </div>
    `
    return
  }

  sessions.forEach((session, index) => {
    const sessionCard = document.createElement("div")
    sessionCard.className = "session-card"

    // Determine status class and text
    let statusClass = "connecting"
    let statusText = "Conectando..."

    if (session.status === "connected") {
      statusClass = "connected"
      statusText = "Conectado"
    } else if (session.status === "qr_ready") {
      statusClass = "connecting"
      statusText = "Esperando escaneo de QR"
    } else if (session.status === "auth_failure" || session.status === "error") {
      statusClass = "error"
      statusText = "Error de conexión"
    } else if (session.status === "disconnected") {
      statusClass = "error"
      statusText = "Desconectado"
    }

    // Session color
    const colorClass = sessionColors[index % Object.keys(sessionColors).length]

    sessionCard.innerHTML = `
      <div class="session-header">
        <div class="session-name-container">
          <div class="session-name">${session.name || `Sesión ${index + 1}`}</div>
          <button class="session-edit-btn" title="Editar nombre">
            <i class="fas fa-edit"></i>
          </button>
        </div>
        <div class="session-actions">
          <button class="session-action-btn refresh" title="Actualizar">
            <i class="fas fa-sync-alt"></i>
          </button>
          <button class="session-action-btn delete" title="Eliminar">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
      <div class="session-status">
        <div class="session-status-indicator ${statusClass}"></div>
        <div class="session-status-text">${statusText}</div>
      </div>
      ${
        session.status === "qr_ready"
          ? `<button class="session-qr-btn" data-session-id="${session.id}">
              <i class="fas fa-qrcode"></i> Ver código QR
             </button>`
          : ""
      }
      ${
        session.status === "connected"
          ? `<button class="session-refresh-btn" data-session-id="${session.id}">
              <i class="fas fa-sync"></i> Actualizar chats
             </button>`
          : ""
      }
    `

    // Add event listeners
    const editBtn = sessionCard.querySelector(".session-edit-btn")
    if (editBtn) {
      editBtn.addEventListener("click", () => {
        editSessionName(session.id, session.name || `Sesión ${index + 1}`)
      })
    }

    const qrBtn = sessionCard.querySelector(".session-qr-btn")
    if (qrBtn) {
      qrBtn.addEventListener("click", () => {
        showQRModal(session.id)
      })
    }

    const refreshBtn = sessionCard.querySelector(".session-refresh-btn")
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        socket.emit("refresh_chats", session.id, (success) => {
          alert(success ? "Actualización de chats iniciada" : "Error al actualizar chats")
        })
      })
    }

    const deleteBtn = sessionCard.querySelector(".session-action-btn.delete")
    if (deleteBtn) {
      deleteBtn.addEventListener("click", () => {
        if (confirm(`¿Estás seguro de que deseas eliminar la sesión ${session.name || index + 1}?`)) {
          socket.emit("delete_session", session.id)
        }
      })
    }

    const refreshSessionBtn = sessionCard.querySelector(".session-action-btn.refresh")
    if (refreshSessionBtn) {
      refreshSessionBtn.addEventListener("click", () => {
        socket.emit("get_session", session.id, (updatedSession) => {
          if (updatedSession) {
            // Update session in the list
            const index = sessions.findIndex((s) => s.id === updatedSession.id)
            if (index !== -1) {
              sessions[index] = updatedSession
            }
            renderSessions()
          }
        })
      })
    }

    sessionsContainer.appendChild(sessionCard)
  })
}

// Render chats in the sidebar
function renderChats() {
  if (!chatsList) return

  chatsList.innerHTML = ""

  if (allChats.length === 0) {
    chatsList.innerHTML = `
      <div class="no-chats-message">
        <p>No hay conversaciones disponibles</p>
        <button id="debug-btn" class="debug-btn">
          <i class="fas fa-bug"></i> Mostrar información de depuración
        </button>
      </div>
    `

    // Add event listener to debug button
    const debugBtn = document.getElementById("debug-btn")
    if (debugBtn) {
      debugBtn.addEventListener("click", showDebugInfo)
    }

    return
  }

  // Add debug button at the top
  const debugContainer = document.createElement("div")
  debugContainer.className = "debug-container"
  debugContainer.innerHTML = `
    <button id="debug-btn" class="debug-btn">
      <i class="fas fa-bug"></i> Depuración
    </button>
    <button id="refresh-chats-btn" class="refresh-btn">
      <i class="fas fa-sync-alt"></i> Actualizar chats
    </button>
  `
  chatsList.appendChild(debugContainer)

  // Add event listener to debug button
  const debugBtn = document.getElementById("debug-btn")
  if (debugBtn) {
    debugBtn.addEventListener("click", showDebugInfo)
  }

  // Add event listener to refresh button
  const refreshBtn = document.getElementById("refresh-chats-btn")
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      socket.emit("refresh_chats", null, (success) => {
        alert(success ? "Actualización de chats iniciada" : "Error al actualizar chats")
      })
    })
  }

  allChats.forEach((chat) => {
    const key = `${chat.sessionId}_${chat.id}`
    const isUnread = unreadMessages[key] && unreadMessages[key] > 0
    const isActive = activeChat && chat.id === activeChat.id && chat.sessionId === activeChat.sessionId

    const chatItem = document.createElement("div")
    chatItem.className = `chat-item ${isUnread ? "unread" : ""} ${isActive ? "active" : ""}`
    chatItem.dataset.id = chat.id
    chatItem.dataset.sessionId = chat.sessionId

    // Get session color
    const colorClass = getSessionColorClass(chat.sessionId)

    // Format timestamp
    const timeDisplay = chat.timestamp ? formatDate(chat.timestamp) : ""

    chatItem.innerHTML = `
      <div class="session-indicator ${colorClass}"></div>
      <div class="chat-info">
        <div class="chat-name">${chat.name || chat.id.split("@")[0]}</div>
        <div class="chat-preview">${chat.lastMessage || "Sin mensajes"}</div>
        ${chat.timestamp ? `<div class="chat-time">${timeDisplay}</div>` : ""}
      </div>
    `

    chatItem.addEventListener("click", () => {
      setActiveChat(chat)
    })

    chatsList.appendChild(chatItem)
  })
}

// Set active chat
function setActiveChat(chat) {
  activeChat = chat

  // Update UI
  document.querySelectorAll(".chat-item").forEach((item) => {
    if (item.dataset.id === chat.id && item.dataset.sessionId === chat.sessionId) {
      item.classList.add("active")
      item.classList.remove("unread") // Remove unread indicator
    } else {
      item.classList.remove("active")
    }
  })

  // Update chat header
  const chatHeaderName = document.querySelector(".chat-header-name")
  const chatHeaderStatus = document.querySelector(".chat-header-status")

  const displayName = chat.name || chat.id.split("@")[0]
  chatHeaderName.textContent = displayName

  // Find session name
  const session = sessions.find((s) => s.id === chat.sessionId)
  chatHeaderStatus.textContent = session ? `${session.name || "Sesión desconocida"}` : "En línea"

  // Reset unread counter
  const key = `${chat.sessionId}_${chat.id}`
  unreadMessages[key] = 0

  // Load messages
  socket.emit("get_messages", { sessionId: chat.sessionId, chatId: chat.id }, (messages) => {
    messagesContainer.innerHTML = ""

    if (!messages || messages.length === 0) {
      messagesContainer.innerHTML = `
        <div class="welcome-message">
          <i class="fas fa-comments"></i>
          <p>No hay mensajes en esta conversación</p>
        </div>
      `
      return
    }

    messages.forEach((message) => {
      addMessage(message)
    })

    scrollToBottom()
  })
}

// Add a message to the chat
function addMessage(message) {
  const messageElement = document.createElement("div")
  messageElement.className = `message ${message.fromMe ? "message-outgoing" : "message-incoming"}`

  const time = formatTime(message.timestamp)

  // Get session name for display
  const session = sessions.find((s) => s.id === message.sessionId)
  const sessionName = session ? session.name || `Sesión ${message.sessionId.split("_")[1]}` : "Desconocido"

  messageElement.innerHTML = `
    ${message.body}
    <div class="message-time">${time}</div>
  `

  messagesContainer.appendChild(messageElement)
}

// Scroll messages container to bottom
function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight
}

// Send message
function sendMessage() {
  if (!activeChat) return

  const message = messageInput.value.trim()
  if (message === "") return

  socket.emit("send_message", {
    sessionId: activeChat.sessionId,
    to: activeChat.id,
    message: message,
  })

  // Clear input
  messageInput.value = ""
}

// Show QR code modal
function showQRModal(sessionId) {
  // Get session
  const session = sessions.find((s) => s.id === sessionId)
  if (!session) return

  // Set modal session ID
  qrModal.dataset.sessionId = sessionId

  // Show modal
  qrModal.style.display = "block"

  // Set QR code if available
  if (session.qrCode) {
    modalQrcode.innerHTML = `<img src="${session.qrCode}" alt="WhatsApp QR Code" style="width: 100%; max-width: 280px;">`
  } else {
    modalQrcode.innerHTML = `
      <div class="loading-qr">
        <i class="fas fa-spinner fa-spin"></i>
        <p>Generando código QR...</p>
      </div>
    `
  }
}

// Event listeners
sendButton.addEventListener("click", sendMessage)

messageInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    sendMessage()
  }
})

// Quick reply buttons
greetingButton.addEventListener("click", () => {
  if (!activeChat) return

  messageInput.value = "¡Hola! Gracias por comunicarte. ¿En qué podemos ayudarte hoy?"
})

endChatButton.addEventListener("click", () => {
  if (!activeChat) return

  messageInput.value = "¡Gracias por preferirnos 🚀! Que tengas un gran día."
})

// Add session button
addSessionBtn.addEventListener("click", () => {
  socket.emit("create_session", (sessionId) => {
    console.log("Nueva sesión creada:", sessionId)
    // Switch to sessions tab to see the new session
    document.querySelector('.tab-button[data-tab="sessions"]').click()
  })
})

// Close modal
closeModal.addEventListener("click", () => {
  qrModal.style.display = "none"
})

// Close modal when clicking outside
window.addEventListener("click", (event) => {
  if (event.target === qrModal) {
    qrModal.style.display = "none"
  }
})

// Initial setup - get sessions and chats
socket.emit("sessions", (receivedSessions) => {
  if (receivedSessions) {
    sessions = receivedSessions
    debugInfo.sessionsReceived = receivedSessions.length
    renderSessions()
  }
})

socket.emit("get_all_chats", (chats) => {
  if (chats) {
    allChats = chats
    debugInfo.chatsReceived = chats.length
    renderChats()
  }
})

// Initial setup - show chats tab by default
document.querySelector('.tab-button[data-tab="chats"]').click()
