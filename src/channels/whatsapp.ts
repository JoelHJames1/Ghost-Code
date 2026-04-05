/**
 * WhatsApp channel — talk to Gemma via WhatsApp.
 *
 * Uses Baileys (reverse-engineered WhatsApp Web) — zero API keys.
 * Just scan a QR code with your phone and you're connected.
 *
 * Features:
 * - QR code login in terminal
 * - Direct messages and group chats
 * - @mention detection in groups (tag @ghost to trigger)
 * - Image/media receiving
 * - Text chunking (4000 char WhatsApp limit)
 * - Typing indicator while thinking
 * - Session persistence (reconnects without re-scanning)
 *
 * Usage:
 *   ghost --whatsapp           Start WhatsApp mode
 *   /whatsapp                  Connect from REPL
 *
 * Based on OpenClaw's WhatsApp implementation pattern.
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WASocket,
  type BaileysEventMap,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

import { createConversation, runAgent, type AgentOptions } from '../agent.js'
import { startSession, endSession } from '../identity/bridge.js'
import type { ServerConfig } from '../api.js'
import { logEvent } from '../eventlog.js'

// ── Config ───────────────────────────────────────────────────────────────

const AUTH_DIR = join(homedir(), '.local', 'share', 'ghost-code', 'whatsapp-auth')
const MAX_MESSAGE_LENGTH = 4000
const TYPING_DELAY_MS = 500

// ── State ────────────────────────────────────────────────────────────────

let sock: WASocket | null = null
let botJid: string | null = null
let botPhone: string | null = null
let isConnected = false
let serverConfig: ServerConfig | null = null

// Per-chat conversations (each chat gets its own context)
const chatConversations = new Map<string, ReturnType<typeof createConversation>>()

// ── Connection ───────────────────────────────────────────────────────────

/**
 * Start WhatsApp connection. Prints QR code to terminal.
 * Returns once connected.
 */
export async function connectWhatsApp(
  config: ServerConfig,
  onLog?: (msg: string) => void,
): Promise<boolean> {
  serverConfig = config

  if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR, { recursive: true })

  const logger = pino({ level: 'silent' })
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()

  onLog?.('Connecting to WhatsApp...')

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    printQRInTerminal: true,  // Shows QR code in terminal
    browser: ['Ghost Code', 'Desktop', '1.0.0'],
    generateHighQualityLinkPreview: false,
  })

  // Save credentials on update
  sock.ev.on('creds.update', saveCreds)

  // Handle connection events
  return new Promise((resolve) => {
    sock!.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        onLog?.('Scan the QR code above with WhatsApp on your phone')
        onLog?.('WhatsApp → Settings → Linked Devices → Link a Device')
      }

      if (connection === 'open') {
        isConnected = true
        botJid = sock!.user?.id || null
        botPhone = botJid?.split(':')[0]?.split('@')[0] || null
        onLog?.(`Connected to WhatsApp as ${botPhone || 'unknown'}`)
        logEvent('session_start', 'whatsapp', { phone: botPhone })

        // Start listening for messages
        setupMessageHandler(onLog)
        resolve(true)
      }

      if (connection === 'close') {
        isConnected = false
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut

        if (shouldReconnect) {
          onLog?.('Disconnected, reconnecting...')
          connectWhatsApp(config, onLog)
        } else {
          onLog?.('Logged out from WhatsApp. Scan QR again to reconnect.')
          resolve(false)
        }
      }
    })
  })
}

// ── Message handling ─────────────────────────────────────────────────────

/**
 * Set up the inbound message handler.
 */
function setupMessageHandler(onLog?: (msg: string) => void): void {
  if (!sock) return

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const msg of messages) {
      // Skip our own messages
      if (msg.key.fromMe) continue

      // Extract text
      const text = extractMessageText(msg)
      if (!text) continue

      const chatId = msg.key.remoteJid!
      const isGroup = chatId.endsWith('@g.us')
      const senderName = msg.pushName || 'Unknown'
      const senderId = isGroup ? msg.key.participant! : chatId

      // In groups, only respond to @mentions
      if (isGroup) {
        const mentioned = isBotMentioned(msg)
        if (!mentioned) continue
      }

      onLog?.(`[WhatsApp] ${senderName}: ${text.slice(0, 80)}`)
      logEvent('user_message', 'whatsapp', { from: senderName, chat: chatId, text: text.slice(0, 200) })

      // Process the message
      await handleIncomingMessage(chatId, senderId, senderName, text, onLog)
    }
  })
}

/**
 * Extract text from a WhatsApp message.
 */
function extractMessageText(msg: any): string | null {
  const message = msg.message
  if (!message) return null

  // Text message
  if (message.conversation) return message.conversation
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text

  // Image with caption
  if (message.imageMessage?.caption) return `[Image] ${message.imageMessage.caption}`

  // Document
  if (message.documentMessage?.caption) return `[Document] ${message.documentMessage.caption}`

  return null
}

/**
 * Check if the bot is mentioned in a group message.
 */
function isBotMentioned(msg: any): boolean {
  if (!botJid && !botPhone) return false

  const text = extractMessageText(msg)?.toLowerCase() || ''

  // Check @mentions in message metadata
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
  if (botJid && mentioned.some((jid: string) => jid.includes(botPhone || ''))) {
    return true
  }

  // Check text for @ghost or bot's phone number
  if (text.includes('@ghost') || text.includes('ghost')) {
    return true
  }
  if (botPhone && text.includes(botPhone)) {
    return true
  }

  return false
}

/**
 * Handle an incoming message — run it through the agent and respond.
 */
async function handleIncomingMessage(
  chatId: string,
  senderId: string,
  senderName: string,
  text: string,
  onLog?: (msg: string) => void,
): Promise<void> {
  if (!sock || !serverConfig) return

  // Clean up mentions from text
  let cleanText = text
    .replace(/@\d+/g, '')
    .replace(/@ghost/gi, '')
    .replace(/ghost,?\s*/i, '')
    .trim()

  if (!cleanText) cleanText = 'Hello!'

  // Get or create conversation for this chat
  if (!chatConversations.has(chatId)) {
    chatConversations.set(chatId, createConversation())
  }
  const conversation = chatConversations.get(chatId)!

  // Show typing indicator
  await sock.presenceSubscribe(chatId)
  await sock.sendPresenceUpdate('composing', chatId)

  try {
    // Run the agent
    let fullResponse = ''

    await runAgent(conversation, `[${senderName}]: ${cleanText}`, {
      stream: false,
      config: serverConfig,
      onToolStart: (name) => {
        onLog?.(`  [WhatsApp] ⚡ ${name}`)
      },
      onToolEnd: () => {},
    })

    // Get the last assistant message
    const lastMsg = conversation.filter(m => m.role === 'assistant').pop()
    fullResponse = (typeof lastMsg?.content === 'string' ? lastMsg.content : '') || 'I processed your request.'

    // Send response (chunked if needed)
    await sendResponse(chatId, fullResponse)
    onLog?.(`[WhatsApp] → ${fullResponse.slice(0, 80)}`)

  } catch (e: any) {
    await sendResponse(chatId, `Error: ${e.message?.slice(0, 200) || 'Something went wrong'}`)
    onLog?.(`[WhatsApp] Error: ${e.message}`)
  }

  // Clear typing indicator
  await sock.sendPresenceUpdate('paused', chatId)
}

/**
 * Send a response, chunking if needed (WhatsApp 4000 char limit).
 */
async function sendResponse(chatId: string, text: string): Promise<void> {
  if (!sock) return

  const chunks = chunkText(text, MAX_MESSAGE_LENGTH)

  for (const chunk of chunks) {
    await sock.sendMessage(chatId, { text: chunk })
    // Small delay between chunks
    if (chunks.length > 1) {
      await new Promise(r => setTimeout(r, TYPING_DELAY_MS))
    }
  }
}

/**
 * Chunk text respecting word boundaries.
 */
function chunkText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining)
      break
    }

    // Find a good break point
    let breakPoint = remaining.lastIndexOf('\n', maxLen)
    if (breakPoint < maxLen * 0.5) {
      breakPoint = remaining.lastIndexOf(' ', maxLen)
    }
    if (breakPoint < maxLen * 0.5) {
      breakPoint = maxLen
    }

    chunks.push(remaining.slice(0, breakPoint))
    remaining = remaining.slice(breakPoint).trimStart()
  }

  return chunks
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Disconnect from WhatsApp.
 */
export function disconnectWhatsApp(): void {
  if (sock) {
    sock.end(undefined)
    sock = null
    isConnected = false
    botJid = null
    botPhone = null
  }
}

/**
 * Check if WhatsApp is connected.
 */
export function isWhatsAppConnected(): boolean {
  return isConnected
}

/**
 * Check if auth exists (can reconnect without QR).
 */
export function hasWhatsAppAuth(): boolean {
  return existsSync(join(AUTH_DIR, 'creds.json'))
}

/**
 * Send a message to a specific chat (for proactive messaging).
 */
export async function sendWhatsAppMessage(chatId: string, text: string): Promise<boolean> {
  if (!sock || !isConnected) return false
  try {
    await sendResponse(chatId, text)
    return true
  } catch {
    return false
  }
}

/**
 * Get WhatsApp status info.
 */
export function getWhatsAppStatus(): {
  connected: boolean
  phone: string | null
  hasAuth: boolean
  activeChats: number
} {
  return {
    connected: isConnected,
    phone: botPhone,
    hasAuth: hasWhatsAppAuth(),
    activeChats: chatConversations.size,
  }
}
