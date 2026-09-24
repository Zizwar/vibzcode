const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CHAT_LOGS_DIR = path.join(DATA_DIR, 'chats');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');

function ensureChatDir() {
  if (!fs.existsSync(CHAT_LOGS_DIR)) {
    fs.mkdirSync(CHAT_LOGS_DIR, { recursive: true });
  }
}

/**
 * Read chat messages for a specific session
 */
function getSessionChatMessages(sessionId) {
  if (!sessionId) return [];
  ensureChatDir();
  const file = path.join(CHAT_LOGS_DIR, `${sessionId}.json`);
  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(data)) return data;
    } catch (e) {
      console.error(`[ChatLogger] Error reading chat log for session ${sessionId}:`, e.message);
    }
  }
  return [];
}

/**
 * Save chat messages for a specific session
 */
function saveSessionChatMessages(sessionId, messages) {
  if (!sessionId || !Array.isArray(messages)) return false;
  ensureChatDir();
  const file = path.join(CHAT_LOGS_DIR, `${sessionId}.json`);
  try {
    fs.writeFileSync(file, JSON.stringify(messages, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error(`[ChatLogger] Error writing chat log for session ${sessionId}:`, e.message);
    return false;
  }
}

/**
 * Append a single message to a session chat log
 */
function appendSessionChatMessage(sessionId, msg) {
  if (!sessionId || !msg) return false;
  try {
    const list = getSessionChatMessages(sessionId);
    list.push(msg);
    saveSessionChatMessages(sessionId, list);
    return true;
  } catch (e) {
    console.error(`[ChatLogger] Error appending message to session ${sessionId}:`, e.message);
    return false;
  }
}

/**
 * Hydrate missing chat messages for a session from persistent jobs
 */
function hydrateSessionChatFromJobs(sessionId, jobsManager) {
  try {
    if (!sessionId) return [];
    const currentMessages = getSessionChatMessages(sessionId);

    // Collect jobs for this session from memory or disk
    let jobs = [];
    if (jobsManager && jobsManager.jobs && typeof jobsManager.jobs.values === 'function') {
      jobs = Array.from(jobsManager.jobs.values()).filter(j => j.sessionId === sessionId);
    }

    if (jobs.length === 0 && fs.existsSync(JOBS_FILE)) {
      try {
        const raw = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
        if (Array.isArray(raw)) {
          jobs = raw.filter(j => j.sessionId === sessionId);
        }
      } catch (err) {
        console.error('[ChatLogger] Error loading jobs for hydration:', err.message);
      }
    }

    if (jobs.length === 0) {
      return currentMessages;
    }

    // Sort jobs chronologically
    jobs.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));

    let updated = false;
    for (const job of jobs) {
      if (!job.prompt) continue;
      const cleanPrompt = job.prompt.trim();

      // Check if prompt already exists in chat messages
      const promptExists = currentMessages.some(m => 
        m.role === 'user' && (m.content === cleanPrompt || (m.id && job.startTime && Math.abs(m.id - job.startTime) < 5000))
      );

      if (!promptExists) {
        const jobStartTime = job.startTime || Date.now();
        const userTime = new Date(jobStartTime).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
        
        currentMessages.push({
          id: jobStartTime,
          role: 'user',
          sender: 'ChatGPT / Gemini (MCP)',
          content: cleanPrompt,
          time: userTime
        });

        // If job completed or failed with response/error, add assistant message
        if (job.response || job.error || job.status === 'completed' || job.status === 'failed') {
          const durationSeconds = job.elapsedSeconds || (job.endTime && job.startTime ? Number(((job.endTime - job.startTime) / 1000).toFixed(2)) : null);
          const endTime = job.endTime || (jobStartTime + Math.round((durationSeconds || 1) * 1000));
          const assistantTime = new Date(endTime).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

          let responseText = job.response;
          if (!responseText) {
            responseText = job.error ? `**خطأ:** ${job.error}` : 'تم تنفيذ المهمة.';
          }

          currentMessages.push({
            id: endTime,
            role: 'assistant',
            content: responseText,
            conversationId: job.conversationId || null,
            duration: durationSeconds,
            isError: job.status === 'failed' || !!job.error,
            time: assistantTime
          });
        }

        updated = true;
      }
    }

    if (updated || currentMessages.length > 0) {
      // Sort messages by timestamp
      currentMessages.sort((a, b) => (a.id || 0) - (b.id || 0));
      saveSessionChatMessages(sessionId, currentMessages);
    }

    return currentMessages;
  } catch (err) {
    console.error(`[ChatLogger] Error hydrating chat for session ${sessionId}:`, err.message);
    return getSessionChatMessages(sessionId);
  }
}

/**
 * Hydrates all sessions from jobs and synchronizes session statistics
 */
function hydrateAllSessionsFromJobs(sessions, jobsManager, saveSessions) {
  try {
    if (!Array.isArray(sessions)) return;
    let anySessionUpdated = false;

    for (const session of sessions) {
      if (!session || !session.id) continue;
      const messages = hydrateSessionChatFromJobs(session.id, jobsManager);
      
      const userCount = messages.filter(m => m.role === 'user').length;
      if (!session.stats) session.stats = { messagesCount: 0 };
      
      if (userCount > (session.stats.messagesCount || 0)) {
        session.stats.messagesCount = userCount;
        anySessionUpdated = true;
      }

      // Update lastActive if messages exist and lastActive is outdated
      if (messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.id) {
          const lastMsgIso = new Date(lastMsg.id).toISOString();
          if (!session.lastActive || new Date(lastMsgIso) > new Date(session.lastActive)) {
            session.lastActive = lastMsgIso;
            anySessionUpdated = true;
          }
        }
      }
    }

    if (anySessionUpdated && typeof saveSessions === 'function') {
      saveSessions(sessions);
      console.log('[ChatLogger] 🔄 Synchronized session message counts and activity from past jobs.');
    }
  } catch (err) {
    console.error('[ChatLogger] Error in hydrateAllSessionsFromJobs:', err.message);
  }
}

module.exports = {
  CHAT_LOGS_DIR,
  ensureChatDir,
  getSessionChatMessages,
  saveSessionChatMessages,
  appendSessionChatMessage,
  hydrateSessionChatFromJobs,
  hydrateAllSessionsFromJobs
};
