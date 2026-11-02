// VibzCode Agent - Workspace Files Module
window.Vibz = window.Vibz || {};

Vibz.agentFiles = {
  fileStructure: null,
  fileSearchQuery: '',
  expandedFolders: {},
  showFileDrawer: false,
  fileTreeLoading: false,
  totalFilesCount: 0,
  previewModalOpen: false,
  previewFilePath: '',
  previewFileContent: '',
  previewFileSize: 0,
  previewLoading: false,
  previewFileType: 'code',
  previewFileRawUrl: '',
  selectedTreeItems: [],
  uploadingFiles: false,
  showUrlFetchModal: false,
  fetchUrlInput: '',
  fetchFilenameInput: '',
  fetchSubdirInput: '',
  fetchingUrl: false,

  async fetchWorkspaceTree() {
    if (!this.session) return;
    this.fileTreeLoading = true;
    try {
      const res = await fetch('/api/session/workspace/tree', {
        headers: { 'Authorization': this.token }
      });
      const data = await res.json();
      if (res.ok && data.success && data.tree) {
        this.fileStructure = data.tree;
        this.countFiles(this.fileStructure);
        // Expand top-level folders automatically
        for (const key of Object.keys(data.tree)) {
          if (data.tree[key].type === 'directory') {
            this.expandedFolders[key] = true;
          }
        }
      }
    } catch (e) {
      console.error('Error loading workspace tree:', e);
    } finally {
      this.fileTreeLoading = false;
    }
  },

  countFiles(structure) {
    let count = 0;
    if (!structure) return 0;
    for (const [, item] of Object.entries(structure)) {
      if (item.type === 'file') count++;
      else if (item.type === 'directory' && item.children) {
        count += this.countFiles(item.children);
      }
    }
    this.totalFilesCount = count;
    return count;
  },

  getAllFilePaths(structure) {
    const files = [];
    if (!structure) return files;
    for (const [, item] of Object.entries(structure)) {
      if (item.type === 'file') files.push(item.path);
      else if (item.type === 'directory' && item.children) {
        files.push(...this.getAllFilePaths(item.children));
      }
    }
    return files;
  },

  toggleFolder(folderPath) {
    this.expandedFolders[folderPath] = !this.expandedFolders[folderPath];
  },

  getFileIcon(filePath) {
    const ext = (filePath || '').toLowerCase().split('.').pop();
    const icons = {
      js: 'fa-brands fa-js text-yellow-400',
      ts: 'fa-brands fa-js text-blue-400',
      jsx: 'fa-brands fa-react text-cyan-400',
      tsx: 'fa-brands fa-react text-cyan-400',
      py: 'fa-brands fa-python text-emerald-400',
      html: 'fa-brands fa-html5 text-orange-400',
      css: 'fa-brands fa-css3-alt text-blue-400',
      json: 'fa-solid fa-gear text-slate-400',
      md: 'fa-solid fa-file-lines text-cyan-300',
      yml: 'fa-solid fa-file-code text-purple-400',
      yaml: 'fa-solid fa-file-code text-purple-400',
      sh: 'fa-solid fa-terminal text-emerald-400',
      bash: 'fa-solid fa-terminal text-emerald-400',
      sql: 'fa-solid fa-database text-blue-400',
      php: 'fa-brands fa-php text-indigo-400',
      vue: 'fa-brands fa-vuejs text-emerald-400',
      env: 'fa-solid fa-key text-amber-400',
      lock: 'fa-solid fa-lock text-slate-500',
      txt: 'fa-solid fa-file-lines text-slate-400',
      svg: 'fa-solid fa-bezier-curve text-pink-400',
      png: 'fa-solid fa-file-image text-purple-300',
      jpg: 'fa-solid fa-file-image text-purple-300',
      jpeg: 'fa-solid fa-file-image text-purple-300',
      gif: 'fa-solid fa-file-image text-purple-300',
      webp: 'fa-solid fa-file-image text-purple-300',
      ico: 'fa-solid fa-file-image text-purple-300',
      bmp: 'fa-solid fa-file-image text-purple-300',
      mp4: 'fa-solid fa-file-video text-rose-400',
      webm: 'fa-solid fa-file-video text-rose-400',
      mov: 'fa-solid fa-file-video text-rose-400',
      mkv: 'fa-solid fa-file-video text-rose-400',
      avi: 'fa-solid fa-file-video text-rose-400',
      mp3: 'fa-solid fa-file-audio text-amber-400',
      wav: 'fa-solid fa-file-audio text-amber-400',
      m4a: 'fa-solid fa-file-audio text-amber-400',
      aac: 'fa-solid fa-file-audio text-amber-400',
      flac: 'fa-solid fa-file-audio text-amber-400',
      ogg: 'fa-solid fa-file-audio text-amber-400',
      pdf: 'fa-solid fa-file-pdf text-red-500',
      zip: 'fa-solid fa-file-zipper text-yellow-400',
      tar: 'fa-solid fa-file-zipper text-yellow-400',
      gz: 'fa-solid fa-file-zipper text-yellow-400',
      rar: 'fa-solid fa-file-zipper text-yellow-400',
      '7z': 'fa-solid fa-file-zipper text-yellow-400'
    };
    return icons[ext] || 'fa-solid fa-file-code text-slate-400';
  },

  toggleItemSelection(path) {
    const idx = this.selectedTreeItems.indexOf(path);
    if (idx > -1) {
      this.selectedTreeItems.splice(idx, 1);
    } else {
      this.selectedTreeItems.push(path);
    }
  },

  isItemSelected(path) {
    return this.selectedTreeItems.includes(path);
  },

  clearTreeSelection() {
    this.selectedTreeItems = [];
  },

  selectAllTreeItems() {
    this.selectedTreeItems = this.getAllFilePaths(this.fileStructure);
    const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
    this.showToast(isAr ? `تم تحديد ${this.selectedTreeItems.length} عنصر` : `Selected ${this.selectedTreeItems.length} items`, 'info');
  },

  downloadFile(filePath) {
    const cleanPath = this.cleanWorkspacePath(filePath);
    if (!cleanPath) return;
    const filename = cleanPath.split('/').pop().split('\\').pop() || 'download';
    const url = `/api/session/workspace/download?token=${encodeURIComponent(this.token)}&path=${encodeURIComponent(cleanPath)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
    this.showToast(isAr ? `جاري تنزيل الملف: ${filename}` : `Downloading: ${filename}`, 'info');
  },

  downloadFolderAsZip(folderPath) {
    const url = `/api/session/workspace/zip?token=${encodeURIComponent(this.token)}&path=${encodeURIComponent(folderPath)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = (folderPath ? folderPath.split('/').pop() : 'project') + '.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },

  downloadSelectedAsZip() {
    if (this.selectedTreeItems.length === 0) {
      this.downloadFolderAsZip('');
      return;
    }
    const pathsParam = this.selectedTreeItems.join(',');
    const url = `/api/session/workspace/zip?token=${encodeURIComponent(this.token)}&paths=${encodeURIComponent(pathsParam)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = 'selected_files.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },

  renderTree(structure, parentPath = '', depth = 0) {
    if (!structure) return '';
    let html = '';
    const entries = Object.entries(structure).sort((a, b) => {
      const da = a[1].type === 'directory' ? 0 : 1;
      const db = b[1].type === 'directory' ? 0 : 1;
      if (da !== db) return da - db;
      return a[0].localeCompare(b[0]);
    });

    const q = (this.fileSearchQuery || '').trim().toLowerCase();
    const isRtl = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
    const paddingStyle = isRtl ? `padding-right:${depth * 10}px` : `padding-left:${depth * 10}px`;

    for (const [name, item] of entries) {
      const fullPath = parentPath ? parentPath + '/' + name : name;
      const isSelected = this.selectedTreeItems.includes(fullPath);
      const escapedPath = fullPath.replace(/'/g, "\\'");

      if (item.type === 'directory') {
        const childPaths = this.getAllFilePaths(item.children);
        if (q && !childPaths.some(p => p.toLowerCase().includes(q)) && !name.toLowerCase().includes(q)) {
          continue;
        }
        const isExpanded = !!this.expandedFolders[fullPath];
        const count = childPaths.length;

        html += `<div style="${paddingStyle}" class="select-none">`;
        html += `<div class="flex items-center gap-1 py-1 px-1 hover:bg-slate-800/80 rounded-lg cursor-pointer text-xs group transition-colors ${isSelected ? 'bg-cyan-950/40 border border-cyan-500/30' : ''}" onclick="window._agent.toggleFolder('${escapedPath}')">`;
        
        html += `<input type="checkbox" class="checkbox checkbox-xs checkbox-primary shrink-0 opacity-40 group-hover:opacity-100 ${isSelected ? 'opacity-100' : ''}" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); window._agent.toggleItemSelection('${escapedPath}')">`;

        html += `<i class="fa-solid fa-chevron-left text-[9px] w-2.5 text-center text-slate-500 transition-transform duration-150 ${isExpanded ? (isRtl ? '-rotate-90' : 'rotate-90') + ' text-cyan-400' : ''}"></i>`;
        html += `<i class="fa-solid ${isExpanded ? 'fa-folder-open text-amber-400' : 'fa-folder text-amber-500/80'} text-xs"></i>`;
        html += `<span class="flex-1 truncate font-sans text-slate-200">${this._escapeHtml(name)}</span>`;
        html += `<span class="text-[10px] text-slate-500 font-mono">${count}</span>`;

        html += `<div class="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">`;
        html += `<button class="btn btn-ghost btn-xs h-5 min-h-5 px-1 text-amber-400 hover:bg-amber-500/20 tooltip tooltip-bottom" data-tip="ZIP" onclick="event.stopPropagation(); window._agent.downloadFolderAsZip('${escapedPath}')"><i class="fa-solid fa-file-zipper text-[10px]"></i></button>`;
        html += `</div>`;

        html += `</div>`;

        if (isExpanded && item.children) {
          html += this.renderTree(item.children, fullPath, depth + 1);
        }
        html += `</div>`;
      } else {
        if (q && !name.toLowerCase().includes(q) && !item.path.toLowerCase().includes(q)) {
          continue;
        }
        const icon = this.getFileIcon(item.path);

        html += `<div style="${paddingStyle}" class="select-none">`;
        html += `<div class="flex items-center gap-1 py-1 px-1 hover:bg-slate-800/80 rounded-lg text-xs group transition-colors ${isSelected ? 'bg-cyan-950/40 border border-cyan-500/30' : ''}">`;
        
        html += `<input type="checkbox" class="checkbox checkbox-xs checkbox-primary shrink-0 opacity-40 group-hover:opacity-100 ${isSelected ? 'opacity-100' : ''}" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); window._agent.toggleItemSelection('${escapedPath}')">`;

        html += `<i class="${icon} text-xs w-3 text-center"></i>`;
        html += `<span class="flex-1 truncate font-mono text-slate-300 cursor-pointer hover:text-cyan-300" onclick="window._agent.openFilePreview('${escapedPath}')" title="${this._escapeHtml(item.path)}">${this._escapeHtml(name)}</span>`;

        html += `<div class="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">`;
        html += `<button class="btn btn-ghost btn-xs h-5 min-h-5 px-1 text-cyan-400 hover:bg-cyan-500/20 tooltip tooltip-bottom" data-tip="Chat" onclick="event.stopPropagation(); window._agent.insertPathIntoChat('${escapedPath}')"><i class="fa-solid fa-plus text-[10px]"></i></button>`;
        html += `<button class="btn btn-ghost btn-xs h-5 min-h-5 px-1 text-slate-400 hover:text-white hover:bg-slate-700 tooltip tooltip-bottom" data-tip="Preview" onclick="event.stopPropagation(); window._agent.openFilePreview('${escapedPath}')"><i class="fa-solid fa-eye text-[10px]"></i></button>`;
        html += `<button class="btn btn-ghost btn-xs h-5 min-h-5 px-1 text-emerald-400 hover:bg-emerald-500/20 tooltip tooltip-bottom" data-tip="Download" onclick="event.stopPropagation(); window._agent.downloadFile('${escapedPath}')"><i class="fa-solid fa-download text-[10px]"></i></button>`;
        html += `</div>`;

        html += `</div></div>`;
      }
    }
    return html;
  },

  _escapeHtml(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  _escapeAttr(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  },

  cleanWorkspacePath(filePath) {
    if (!filePath || typeof filePath !== 'string') return '';
    let p = filePath.trim();
    p = p.replace(/^file:\/\//i, '');
    p = p.split('#')[0].split('?')[0];
    try { p = decodeURIComponent(p); } catch (e) {}
    return p;
  },

  isLocalPath(urlOrPath) {
    if (!urlOrPath || typeof urlOrPath !== 'string') return false;
    const s = urlOrPath.trim();
    if (!s) return false;
    if (s.startsWith('file://')) return true;
    if (s.startsWith('http://') || s.startsWith('https://')) {
      try {
        const u = new URL(s, window.location.origin);
        return u.origin === window.location.origin && u.pathname.startsWith('/api/session/workspace');
      } catch (e) {
        return false;
      }
    }
    if (s.startsWith('mailto:') || s.startsWith('tel:') || s.startsWith('#') || s.startsWith('javascript:')) {
      return false;
    }
    if (s.startsWith('/root/') || s.startsWith('/home/') || s.startsWith('/tmp/') || s.startsWith('/var/')) {
      return true;
    }
    if (s.startsWith('./') || s.startsWith('../') || s.startsWith('/')) {
      return true;
    }
    const clean = s.split('#')[0].split('?')[0];
    if (clean.includes(' ') || clean.includes('\n')) return false;
    const match = clean.match(/\.([a-zA-Z0-9_-]{1,10})$/);
    return !!match;
  },

  async openFilePreview(filePath) {
    const cleanPath = this.cleanWorkspacePath(filePath);
    if (!cleanPath) return;

    this.previewFilePath = cleanPath;
    this.previewFileContent = '';
    this.previewFileSize = 0;
    this.previewLoading = true;
    this.previewModalOpen = true;

    const ext = (cleanPath.split('.').pop() || '').toLowerCase();
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'];
    const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi'];
    const audioExts = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'];
    const pdfExts = ['pdf'];

    if (imageExts.includes(ext)) {
      this.previewFileType = 'image';
    } else if (videoExts.includes(ext)) {
      this.previewFileType = 'video';
    } else if (audioExts.includes(ext)) {
      this.previewFileType = 'audio';
    } else if (pdfExts.includes(ext)) {
      this.previewFileType = 'pdf';
    } else {
      this.previewFileType = 'code';
    }

    this.previewFileRawUrl = `/api/session/workspace/raw?token=${encodeURIComponent(this.token)}&path=${encodeURIComponent(cleanPath)}&t=${Date.now()}`;

    if (this.previewFileType !== 'code') {
      this.previewLoading = false;
      return;
    }

    try {
      const res = await fetch(`/api/session/workspace/file?path=${encodeURIComponent(cleanPath)}`, {
        headers: { 'Authorization': this.token }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        this.previewFileContent = data.content;
        this.previewFileSize = data.size;
        if (this.$nextTick) {
          this.$nextTick(() => {
            const el = document.getElementById('preview-code-block');
            if (el && window.hljs) {
              el.textContent = data.content;
              el.removeAttribute('data-highlighted');
              delete el.dataset.highlighted;
              window.hljs.highlightElement(el);
            }
          });
        }
      } else {
        this.previewFileContent = '// ' + (data.error || 'Failed to read file');
      }
    } catch (err) {
      this.previewFileContent = '// Connection error: ' + err.message;
    } finally {
      this.previewLoading = false;
    }
  },

  closeFilePreview() {
    this.previewModalOpen = false;
    this.previewFilePath = '';
    this.previewFileContent = '';
  },

  insertPathIntoChat(filePath) {
    const mention = `\`${filePath}\``;
    if (this.chatInputText) {
      this.chatInputText += ' ' + mention;
    } else {
      this.chatInputText = mention + ' ';
    }
    const isAr = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
    this.showToast(isAr ? 'تم إدراج مسار الملف في صندوق الرسائل' : 'File path inserted into prompt', 'info');
    if (this.$nextTick) {
      this.$nextTick(() => {
        const el = document.getElementById('agent-input-textarea');
        if (el) el.focus();
      });
    }
  },

  async handleFileUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    await this.uploadFilesToServer(files, false);
    event.target.value = '';
  },

  async handleFolderUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    await this.uploadFilesToServer(files, true);
    event.target.value = '';
  },

  async uploadFilesToServer(fileList, isFolder = false) {
    const formData = new FormData();
    const relPaths = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      formData.append('files', file);
      const relPath = isFolder && file.webkitRelativePath ? file.webkitRelativePath : file.name;
      relPaths.push(relPath);
    }

    formData.append('relPaths', JSON.stringify(relPaths));
    this.uploadingFiles = true;

    try {
      const res = await fetch('/api/session/workspace/upload', {
        method: 'POST',
        headers: {
          'Authorization': this.token
        },
        body: formData
      });

      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast(data.message || (Vibz.i18n && Vibz.i18n.currentLang === 'ar' ? 'تم رفع الملفات بنجاح إلى المشروع' : 'Files uploaded successfully'), 'success');
        await this.fetchWorkspaceTree();
      } else {
        this.showToast('Upload error: ' + (data.error || 'Unknown error'), 'error');
      }
    } catch (err) {
      this.showToast('Upload error: ' + err.message, 'error');
    } finally {
      this.uploadingFiles = false;
    }
  },

  async executeFetchUrl() {
    if (!this.fetchUrlInput || !this.fetchUrlInput.trim()) {
      this.showToast('Please enter valid URL', 'warning');
      return;
    }

    this.fetchingUrl = true;
    try {
      const res = await fetch('/api/session/workspace/fetch-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.token
        },
        body: JSON.stringify({
          url: this.fetchUrlInput.trim(),
          filename: this.fetchFilenameInput.trim(),
          subDir: this.fetchSubdirInput.trim()
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast(data.message || (Vibz.i18n && Vibz.i18n.currentLang === 'ar' ? 'تم جلب وحفظ الملف بنجاح' : 'File fetched successfully'), 'success');
        this.showUrlFetchModal = false;
        this.fetchUrlInput = '';
        this.fetchFilenameInput = '';
        this.fetchSubdirInput = '';
        await this.fetchWorkspaceTree();
      } else {
        this.showToast('Fetch failed: ' + (data.error || 'Unknown'), 'error');
      }
    } catch (err) {
      this.showToast('Fetch error: ' + err.message, 'error');
    } finally {
      this.fetchingUrl = false;
    }
  }
};
