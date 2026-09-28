const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_SERVER_URL = 'https://memoryz.wino.deno.net';
const CONFIG_FILE = path.join(os.homedir(), '.memoryz', 'config.json');

function resolveCredentials() {
  let token = process.env.MEMORYZ_TOKEN || process.env.MEMORYZ_API_KEY || null;
  let url = process.env.MEMORYZ_URL || null;

  if (!token || !url) {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const conf = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        if (!token && conf.token) token = conf.token;
        if (!url && conf.url) url = conf.url;
      }
    } catch (e) {}
  }

  return {
    url: (url || DEFAULT_SERVER_URL).replace(/\/$/, ''),
    token: token || ''
  };
}

class MemoryzClient {
  constructor(options = {}) {
    const creds = resolveCredentials();
    this.url = (options.url || creds.url).replace(/\/$/, '');
    this.token = options.token || creds.token;
  }

  async _fetch(endpoint, options = {}) {
    const fullUrl = `${this.url}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': this.token,
      ...(options.headers || {})
    };

    const res = await fetch(fullUrl, {
      ...options,
      headers
    });

    const contentType = res.headers.get('content-type') || '';
    let data = null;
    if (contentType.includes('application/json')) {
      data = await res.json().catch(() => null);
    } else {
      data = await res.text().catch(() => null);
    }

    if (!res.ok) {
      const errMsg = (data && data.error) ? data.error : `HTTP ${res.status}: ${res.statusText}`;
      const err = new Error(errMsg);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  }

  // Exact Hash Lookup (MemoryZ v3)
  async getMemory(hash, { includeLinks = false } = {}) {
    if (!hash) throw new Error('Memory hash is required');
    const q = includeLinks ? '?include_links=true' : '';
    return await this._fetch(`/api/memories/${encodeURIComponent(hash)}${q}`, { method: 'GET' });
  }

  // Semantic Vector Recall with namespace support (MemoryZ v3)
  async recallMemory({ query, namespace, type, limit = 5, format = 'full' } = {}) {
    const body = {
      query: query || 'all',
      namespace: namespace || undefined,
      type: type || undefined,
      limit: Number(limit) || 5,
      format
    };
    return await this._fetch('/api/memories/recall', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  // Store Memory Atom with namespace & provenance (MemoryZ v3)
  async storeMemory({ content, title, type = 'note', namespace = 'default', agentId = 'vibzcode', source = 'orchestrator', metadata = {} } = {}) {
    if (!content) throw new Error('Content is required to store memory');
    const body = {
      content,
      title: title || undefined,
      type,
      namespace,
      agent_id: agentId,
      source,
      metadata
    };
    return await this._fetch('/api/memories', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  // Update Memory & re-embed (MemoryZ v3)
  async updateMemory(hash, { content, title, metadata } = {}) {
    if (!hash) throw new Error('Memory hash is required');
    return await this._fetch(`/api/memories/${encodeURIComponent(hash)}`, {
      method: 'PUT',
      body: JSON.stringify({ content, title, metadata })
    });
  }

  // Delete Memory (Soft-delete)
  async deleteMemory(hash) {
    if (!hash) throw new Error('Memory hash is required');
    return await this._fetch(`/api/memories/${encodeURIComponent(hash)}`, {
      method: 'DELETE'
    });
  }

  // Hierarchical Tasks (MemoryZ v3)
  async createTask({ title, parentId, status = 'todo', priority = 'medium', assignee, description, namespace = 'default', metadata = {} } = {}) {
    if (!title) throw new Error('Task title is required');
    const body = {
      title,
      parent_id: parentId || undefined,
      status,
      priority,
      assignee,
      description,
      namespace,
      metadata
    };
    return await this._fetch('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  async listTasks({ status, parentId, assignee, namespace = 'default', format = 'json', limit } = {}) {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (parentId) params.set('parent_id', parentId);
    if (assignee) params.set('assignee', assignee);
    if (namespace) params.set('namespace', namespace);
    if (format) params.set('format', format);
    if (limit) params.set('limit', String(limit));

    const qs = params.toString() ? `?${params.toString()}` : '';
    return await this._fetch(`/api/tasks${qs}`, { method: 'GET' });
  }

  async getTaskTree({ status, namespace = 'default', format = 'json' } = {}) {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (namespace) params.set('namespace', namespace);
    if (format) params.set('format', format);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return await this._fetch(`/api/tasks/tree${qs}`, { method: 'GET' });
  }

  // Atomic Task Claiming / Releasing (MemoryZ v3)
  async claimTask({ taskId, agentId = 'vibzcode', release = false } = {}) {
    if (!taskId) throw new Error('taskId is required');
    return await this._fetch(`/api/tasks/${encodeURIComponent(taskId)}/claim`, {
      method: 'POST',
      body: JSON.stringify({ agent_id: agentId, release })
    });
  }

  async updateTask(taskId, updates = {}) {
    if (!taskId) throw new Error('taskId is required');
    return await this._fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
  }

  // Ephemeral logs
  async logStore({ message, level = 'info', source = 'vibzcode' } = {}) {
    return await this._fetch('/api/logs', {
      method: 'POST',
      body: JSON.stringify({ message, level, source })
    }).catch(() => null);
  }

  /**
   * Resolves multiple memory references (by hash) and returns a structured XML context block.
   */
  async resolveMemoryAttachments(memoryRefs = []) {
    if (!Array.isArray(memoryRefs) || memoryRefs.length === 0) {
      return '';
    }

    const fetched = [];
    for (const ref of memoryRefs) {
      const hash = typeof ref === 'string' ? ref.trim() : (ref?.hash || '').trim();
      if (!hash) continue;
      try {
        const mem = await this.getMemory(hash, { includeLinks: true });
        if (mem) {
          fetched.push(mem);
        }
      } catch (err) {
        fetched.push({ hash, error: err.message, not_found: true });
      }
    }

    if (fetched.length === 0) return '';

    let xml = '\n\n<attached_memories_from_memoryz count="' + fetched.length + '">\n';
    for (const m of fetched) {
      if (m.not_found) {
        xml += `  <memory hash="${m.hash}" status="not_found" error="${m.error || 'Failed to fetch'}" />\n`;
      } else {
        const titleAttr = m.title ? ` title="${escapeXml(m.title)}"` : '';
        const typeAttr = m.type ? ` type="${m.type}"` : '';
        const nsAttr = m.namespace ? ` namespace="${m.namespace}"` : '';
        xml += `  <memory hash="${m.hash}"${titleAttr}${typeAttr}${nsAttr}>\n`;
        xml += `<![CDATA[\n${m.content}\n]]>\n`;
        if (m.links && m.links.length > 0) {
          xml += `    <links>\n`;
          for (const l of m.links) {
            xml += `      <link relation="${l.relation_type}" target="${l.target_hash}" target_title="${escapeXml(l.target_title || '')}" />\n`;
          }
          xml += `    </links>\n`;
        }
        xml += `  </memory>\n`;
      }
    }
    xml += '</attached_memories_from_memoryz>\n\n';
    return xml;
  }
}

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const defaultClient = new MemoryzClient();

module.exports = {
  MemoryzClient,
  defaultClient
};
