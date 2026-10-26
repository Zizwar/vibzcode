/**
 * VibzCode Channel Manager
 * Sovereign Multi-Channel Connector Infrastructure
 * Manages integrations: Telegram, Discord (extensible), WhatsApp (extensible)
 */

const path = require('path');
const TelegramConnector = require('./telegram');

class ChannelManager {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.sessionsProvider = options.getSessions || (() => []);
    this.saveSessions = options.saveSessions || (() => {});
    this.dispatchChat = options.dispatchChat || null;

    // Instantiate Telegram Connector
    this.telegram = new TelegramConnector({
      dataDir: options.dataDir || path.join(__dirname, '../../data'),
      getSessions: this.sessionsProvider,
      saveSessions: this.saveSessions,
      dispatchChat: this.dispatchChat,
      logger: this.logger
    });

    this.connectors = {
      telegram: this.telegram
      // Future channels: discord, whatsapp, slack
    };
  }

  init() {
    this.logger.log('[ChannelManager] Initializing notification & bot channels...');
    this.telegram.restartAllListeners();
  }

  async broadcastAgentResponse(session, responseText, meta = {}) {
    if (!session) return;

    // 1. Telegram
    if (session.telegram && session.telegram.enabled) {
      try {
        await this.telegram.notifyAgentResponse(session, responseText, meta);
      } catch (e) {
        this.logger.error('[ChannelManager] Telegram notify failed:', e.message);
      }
    }

    // Future connectors will hook in here cleanly without touching core logic
  }

  stopAll() {
    this.telegram.stopAllListeners();
  }
}

module.exports = ChannelManager;
