// VibzCode Admin - Server Folder Tree Module
window.Vibz = window.Vibz || {};

Vibz.adminFolderTree = {
  folderTree: [],
  expandedAdminFolders: {},
  adminFolderSearch: '',
  loadingFolderTree: false,

  async loadFolderTree() {
    this.loadingFolderTree = true;
    try {
      const res = await fetch('/api/admin/folders/tree', {
        headers: { 'Authorization': this.adminToken }
      });
      const data = await res.json();
      if (res.ok && data.success && Array.isArray(data.tree)) {
        this.folderTree = data.tree;
        for (const node of data.tree) {
          this.expandedAdminFolders[node.path] = true;
        }
      }
    } catch (e) {
      console.error('Error loading folder tree:', e);
    } finally {
      this.loadingFolderTree = false;
    }
  },

  toggleAdminFolder(path) {
    this.expandedAdminFolders[path] = !this.expandedAdminFolders[path];
  },

  selectAdminTargetDir(path) {
    if (this.newSession) {
      this.newSession.targetDir = path;
      this.newSession.customTargetDir = '';
    }
  },

  renderAdminFolderTree(nodes, depth = 0) {
    if (!nodes || !Array.isArray(nodes) || nodes.length === 0) return '';
    let html = '';
    const q = (this.adminFolderSearch || '').trim().toLowerCase();
    const isRtl = Vibz.i18n ? Vibz.i18n.currentLang === 'ar' : true;
    const paddingStyle = isRtl ? `padding-right:${depth * 14}px` : `padding-left:${depth * 14}px`;

    for (const node of nodes) {
      const hasChildren = node.children && node.children.length > 0;
      const isExpanded = !!this.expandedAdminFolders[node.path];
      const isSelected = this.newSession && this.newSession.targetDir === node.path;
      const escapedPath = node.path.replace(/'/g, "\\'");

      // Filter search if given
      if (q && !node.name.toLowerCase().includes(q) && !node.path.toLowerCase().includes(q)) {
        const matchChild = (item) => {
          if (!item.children) return false;
          return item.children.some(c => c.name.toLowerCase().includes(q) || c.path.toLowerCase().includes(q) || matchChild(c));
        };
        if (!matchChild(node)) continue;
      }

      html += `<div style="${paddingStyle}" class="select-none">`;
      html += `<div class="flex items-center gap-2 py-1.5 px-2 rounded-lg cursor-pointer transition-all text-xs group ${isSelected ? 'bg-cyan-500/20 border border-cyan-500/50 text-cyan-300 font-bold shadow-sm' : 'hover:bg-slate-800/80 text-slate-200'}" onclick="window._admin.selectAdminTargetDir('${escapedPath}')">`;

      if (hasChildren) {
        html += `<button type="button" class="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-cyan-300" onclick="event.stopPropagation(); window._admin.toggleAdminFolder('${escapedPath}')">`;
        html += `<i class="fa-solid fa-chevron-left text-[9px] transition-transform duration-150 ${isExpanded ? (isRtl ? '-rotate-90' : 'rotate-90') + ' text-cyan-400' : ''}"></i>`;
        html += `</button>`;
      } else {
        html += `<span class="w-4"></span>`;
      }

      html += `<i class="fa-solid ${isExpanded ? 'fa-folder-open text-amber-400' : 'fa-folder text-amber-500/80'} text-sm"></i>`;
      html += `<span class="flex-1 truncate font-mono text-xs">${node.name}</span>`;
      html += `<span class="text-[10px] text-slate-500 font-mono truncate max-w-[140px]" title="${node.path}">${node.path}</span>`;
      if (isSelected) {
        html += `<i class="fa-solid fa-circle-check text-cyan-400 text-xs mx-1"></i>`;
      }
      html += `</div>`;

      if (hasChildren && (isExpanded || q)) {
        html += this.renderAdminFolderTree(node.children, depth + 1);
      }
      html += `</div>`;
    }
    return html;
  }
};
