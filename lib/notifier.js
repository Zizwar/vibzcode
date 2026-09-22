const { defaultClient: memoryz } = require('./memoryzClient');

/**
 * VibzCode Notification and Webhook Dispatcher
 */
async function sendNotification({ channel = 'webhook', to, message, jobData = null, subject = 'VibzCode Notification' } = {}) {
  const result = { channel, success: false, target: to, error: null };

  try {
    if (channel === 'telegram') {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = to || process.env.TELEGRAM_CHAT_ID;

      if (!botToken || !chatId) {
        throw new Error('Telegram bot token or chat ID not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)');
      }

      const text = `🤖 *VibzCode Orchestrator Alert*\n\n${message}${jobData?.jobId ? `\n\n🆔 *Job:* \`${jobData.jobId}\`` : ''}`;

      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'Markdown'
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.description || `HTTP ${res.status}`);
      }
      result.success = true;
    } else if (channel === 'webhook') {
      const webhookUrl = to;
      if (!webhookUrl || !webhookUrl.startsWith('http')) {
        throw new Error('Valid webhook URL required (must start with http:// or https://)');
      }

      const payload = {
        event: jobData ? 'job_finished' : 'notification',
        message,
        job: jobData,
        timestamp: new Date().toISOString()
      };

      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'VibzCode-Orchestrator/2.0'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(`Webhook target responded with HTTP ${res.status}: ${res.statusText}`);
      }
      result.success = true;
    } else {
      throw new Error(`Unsupported notification channel: ${channel}`);
    }

    // Ephemeral log in MemoryZ
    await memoryz.logStore({
      message: `Notification sent [${channel}] to ${to}: ${message.slice(0, 100)}`,
      level: 'info',
      source: 'vibzcode:notifier'
    }).catch(() => {});

  } catch (err) {
    result.error = err.message;
    await memoryz.logStore({
      message: `Notification failed [${channel}] to ${to}: ${err.message}`,
      level: 'warn',
      source: 'vibzcode:notifier'
    }).catch(() => {});
  }

  return result;
}

module.exports = {
  sendNotification
};
