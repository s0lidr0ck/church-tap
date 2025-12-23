class ChurchTapApp {
  constructor() {
    // Use local date instead of UTC date
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    this.currentDate = `${year}-${month}-${day}`;
    this.currentVerse = null;
    this.textSize = localStorage.getItem('textSize') || 'medium';
    this.theme = localStorage.getItem('theme') || 'light';
    // User-level (optional) toggle for deeper Bible study tools.
    // Hybrid persistence: localStorage for guests; DB-backed for logged-in users.
    this.studyMode = localStorage.getItem('studyMode') === 'true';
    // Study Tools (Explore) page state
    this.studyState = this.loadStudyState();
    this.userToken = this.getUserToken();
    this.favorites = JSON.parse(localStorage.getItem('favorites') || '[]');
    this.recentlyViewed = JSON.parse(localStorage.getItem('recentlyViewed') || '[]');
    
    // Get organization and tag parameters from URL or injected context
    const urlParams = new URLSearchParams(window.location.search);
    this.joinGroupRequested = urlParams.get('joinGroup') === '1';

    // Check for injected NFC context first, then fall back to URL parameters
    if (window.nfcOrgContext) {
      this.orgParam = window.nfcOrgContext.orgParam;
      this.tagIdParam = window.nfcOrgContext.tagIdParam;
      console.log('🏷️ Using injected NFC context:', window.nfcOrgContext);
    } else {
      this.orgParam = urlParams.get('org');
      this.tagIdParam = urlParams.get('tag_id');
      console.log('🔗 Using URL parameters: org=' + this.orgParam + ', tag_id=' + this.tagIdParam);
    }

    // Support new tap URL format: /t/<UID>
    // (Legacy URLs used /?org=...&tag_id=... but we now redirect tag_id -> /t/:uid)
    if (!this.tagIdParam) {
      const tapMatch = String(window.location.pathname || '').match(/^\/t\/([^\/?#]+)/);
      if (tapMatch && tapMatch[1]) {
        try {
          this.tagIdParam = decodeURIComponent(tapMatch[1]);
        } catch (e) {
          this.tagIdParam = tapMatch[1];
        }
        console.log('🏷️ Using /t/:uid path tag:', this.tagIdParam);
      }
    }
    
    // Handle tag_id persistence with cookies
    this.setupTagIdTracking();
    
    this.currentCommunity = null;
    this.userInteractions = JSON.parse(localStorage.getItem('userInteractions') || '{}');
    this.currentUser = null;
    this.authToken = null;
    this.membershipContext = null;
    this.adminOrganizations = null;

    // Private study artifacts (per-verse, per-user)
    this.currentHighlightKey = null;
    this.currentNotesCount = 0;

    // Per-group feature flags (loaded from /api/organization/features)
    this.orgFeatures = null;
    this.translationCatalog = [];

    // Bible metadata (lazy-loaded): chapter/verse counts by book+chapter
    this.bibleStructureByNumber = null;

    // Emergency Topics + Fundraising + Playlist helpers
    this._topics = null;
    this._fundraising = null;
    this._playlistLink = null;
    
    // PWA install prompt
    this.deferredPrompt = null;
    this.setupPWAInstall();
    
    this.init().catch((error) => {
      console.error('Init error:', error);
      this.showCriticalError('Application failed to initialize. Please refresh the page.');
      this.hideSplashScreen();
    });
  }

  // ===========================
  // Private Verse Study Tools (Highlights + Notes)
  // ===========================

  canUsePrivateVerseTools() {
    return !!(this.currentUser && this.membershipContext?.active_organization_id);
  }

  getVerseContainerEl() {
    return document.querySelector('.verse-container') || null;
  }

  clearVerseHighlightClasses() {
    const el = this.getVerseContainerEl();
    if (!el) return;
    const classes = Array.from(el.classList || []);
    for (const c of classes) {
      if (c.startsWith('ct-highlight-')) el.classList.remove(c);
    }
  }

  applyVerseHighlight(colorKey) {
    this.clearVerseHighlightClasses();
    const el = this.getVerseContainerEl();
    if (!el) return;
    const key = String(colorKey || '').trim().toLowerCase();
    if (!key) return;
    el.classList.add(`ct-highlight-${key}`);
  }

  updateNotesBadge(count) {
    const n = Number(count) || 0;
    const badges = [
      document.getElementById('notesCountBadge'),   // legacy (today action row)
      document.getElementById('meNotesCountBadge')  // Me tab
    ].filter(Boolean);

    for (const badge of badges) {
      if (n > 0) {
        badge.textContent = String(n);
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
        badge.textContent = '0';
      }
    }
  }

  updateVersePrivateToolsVisibility() {
    const canUse = this.canUsePrivateVerseTools();
    const favoriteBtn = document.getElementById('favoriteBtn');

    // Match how "Favorites" are intended to behave: only show when logged in with an active group.
    if (favoriteBtn) favoriteBtn.classList.toggle('hidden', !canUse);

    if (!canUse) {
      this.currentHighlightKey = null;
      this.currentNotesCount = 0;
      this.clearVerseHighlightClasses();
      this.updateNotesBadge(0);
    }
  }

  async refreshVersePrivateToolsState() {
    // Called after loading/displaying the current verse.
    if (!this.currentVerse) return;
    if (!this.canUsePrivateVerseTools()) {
      this.updateVersePrivateToolsVisibility();
      return;
    }

    const verseId = Number(this.currentVerse.id);
    if (!verseId || Number.isNaN(verseId)) return;

    try {
      // Highlight
      const hlRes = await fetch(this.buildApiUrl(`/api/highlights/verse/${verseId}`), { credentials: 'include' });
      const hlData = await hlRes.json().catch(() => null);
      const colorKey = hlRes.ok && hlData?.success ? (hlData.highlight?.color_key || null) : null;
      this.currentHighlightKey = colorKey;
      if (colorKey) this.applyVerseHighlight(colorKey);
      else this.clearVerseHighlightClasses();
    } catch (e) {
      // ignore
    }

    try {
      // Notes (we use list endpoint and just count rows)
      const notesRes = await fetch(this.buildApiUrl(`/api/verse-notes/verse/${verseId}`), { credentials: 'include' });
      const notesData = await notesRes.json().catch(() => null);
      const notes = notesRes.ok && notesData?.success && Array.isArray(notesData.notes) ? notesData.notes : [];
      this.currentNotesCount = notes.length;
      this.updateNotesBadge(notes.length);
    } catch (e) {
      this.currentNotesCount = 0;
      this.updateNotesBadge(0);
    }
  }

  openHighlightFromMe() {
    if (!this.canUsePrivateVerseTools()) {
      this.showToast('Please login to use highlights');
      this.showLoginModal();
      return;
    }
    if (!this.currentVerse) {
      this.showToast('Open Today’s verse first');
      this.goToToday();
      return;
    }
    this.showHighlightPicker();
  }

  openNotesFromMe() {
    if (!this.canUsePrivateVerseTools()) {
      this.showToast('Please login to use notes');
      this.showLoginModal();
      return;
    }
    if (!this.currentVerse) {
      this.showToast('Open Today’s verse first');
      this.goToToday();
      return;
    }
    this.showVerseNotesModal();
  }

  showHighlightPicker() {
    if (!this.currentVerse) return;
    if (!this.canUsePrivateVerseTools()) {
      this.showToast('Please login to use highlights');
      this.showLoginModal();
      return;
    }

    const colors = [
      { key: 'yellow', label: 'Yellow', swatch: 'var(--hl-yellow-bg)' },
      { key: 'amber', label: 'Amber', swatch: 'var(--hl-amber-bg)' },
      { key: 'orange', label: 'Orange', swatch: 'var(--hl-orange-bg)' },
      { key: 'red', label: 'Red', swatch: 'var(--hl-red-bg)' },
      { key: 'pink', label: 'Pink', swatch: 'var(--hl-pink-bg)' },
      { key: 'purple', label: 'Purple', swatch: 'var(--hl-purple-bg)' },
      { key: 'blue', label: 'Blue', swatch: 'var(--hl-blue-bg)' },
      { key: 'green', label: 'Green', swatch: 'var(--hl-green-bg)' }
    ];

    const current = String(this.currentHighlightKey || '').trim().toLowerCase();

    const buttons = colors.map(c => {
      const isActive = current === c.key;
      return `
        <button
          class="flex items-center justify-between w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
          onclick="window.churchTapApp.setVerseHighlight('${c.key}')"
          aria-label="Set highlight ${c.label}"
        >
          <div class="flex items-center gap-3">
            <span class="inline-block w-5 h-5 rounded-md border border-gray-300 dark:border-gray-600" style="background:${c.swatch};"></span>
            <span class="text-sm text-gray-800 dark:text-gray-200">${c.label}</span>
          </div>
          ${isActive ? `<span class="text-xs font-semibold text-primary-600 dark:text-primary-400">Selected</span>` : `<span class="text-xs text-gray-400">›</span>`}
        </button>
      `;
    }).join('');

    const clearBtn = current
      ? `<button class="w-full px-3 py-2 rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                 onclick="window.churchTapApp.setVerseHighlight(null)">
            Clear highlight
         </button>`
      : '';

    const ref = this.escapeHtml(this.currentVerse?.bible_reference || '');

    this.showModal('Highlight', `
      <div class="space-y-3">
        <div class="text-xs text-gray-500 dark:text-gray-400">${ref ? `For ${ref}` : 'Choose a color'}</div>
        <div class="space-y-2">${buttons}</div>
        ${clearBtn}
        <div class="flex justify-end">
          <button class="btn-secondary" onclick="window.churchTapApp.closeModal()">Close</button>
        </div>
      </div>
    `);
  }

  async setVerseHighlight(colorKey) {
    if (!this.currentVerse) return;
    if (!this.canUsePrivateVerseTools()) return;
    const verseId = Number(this.currentVerse.id);
    if (!verseId || Number.isNaN(verseId)) return;

    try {
      const res = await fetch(this.buildApiUrl(`/api/highlights/verse/${verseId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ color_key: colorKey })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        this.showToast(data?.error || 'Failed to update highlight');
        return;
      }

      this.currentHighlightKey = data.highlight?.color_key || null;
      if (this.currentHighlightKey) this.applyVerseHighlight(this.currentHighlightKey);
      else this.clearVerseHighlightClasses();
    } catch (e) {
      console.error('setVerseHighlight error:', e);
      this.showToast('Failed to update highlight');
    }
  }

  markdownToSafeHtml(markdown) {
    // Minimal markdown renderer (safe-by-construction).
    // - Escapes input first
    // - Emits only a small allowlist of tags used elsewhere (plus PRE)
    const raw = String(markdown ?? '').replace(/\r\n/g, '\n');
    if (!raw.trim()) return '';

    const esc = (s) => this.escapeHtml(s);
    const lines = raw.split('\n');
    const out = [];

    let inCode = false;
    let codeBuf = [];
    let inUl = false;
    let inOl = false;
    let paraBuf = [];

    const flushPara = () => {
      const text = paraBuf.join('\n').trim();
      paraBuf = [];
      if (!text) return;
      out.push(`<p>${this.renderInlineMarkdown(text)}</p>`);
    };

    const closeLists = () => {
      if (inUl) { out.push(`</ul>`); inUl = false; }
      if (inOl) { out.push(`</ol>`); inOl = false; }
    };

    for (const lineRaw of lines) {
      const line = lineRaw ?? '';

      if (line.trim().startsWith('```')) {
        if (!inCode) {
          flushPara();
          closeLists();
          inCode = true;
          codeBuf = [];
        } else {
          const code = esc(codeBuf.join('\n'));
          out.push(`<pre><code>${code}</code></pre>`);
          inCode = false;
          codeBuf = [];
        }
        continue;
      }

      if (inCode) {
        codeBuf.push(line);
        continue;
      }

      // Blank line breaks paragraphs/lists
      if (!line.trim()) {
        flushPara();
        closeLists();
        continue;
      }

      // Blockquote
      if (line.trim().startsWith('> ')) {
        flushPara();
        closeLists();
        const q = line.trim().slice(2);
        out.push(`<blockquote>${this.renderInlineMarkdown(q)}</blockquote>`);
        continue;
      }

      // Ordered list
      const olMatch = line.match(/^\s*(\d+)\.\s+(.*)$/);
      if (olMatch) {
        flushPara();
        if (!inOl) {
          closeLists();
          out.push('<ol>');
          inOl = true;
        }
        out.push(`<li>${this.renderInlineMarkdown(olMatch[2])}</li>`);
        continue;
      }

      // Unordered list
      const ulMatch = line.match(/^\s*[-*]\s+(.*)$/);
      if (ulMatch) {
        flushPara();
        if (!inUl) {
          closeLists();
          out.push('<ul>');
          inUl = true;
        }
        out.push(`<li>${this.renderInlineMarkdown(ulMatch[1])}</li>`);
        continue;
      }

      // Normal paragraph line
      paraBuf.push(line);
    }

    if (inCode) {
      const code = esc(codeBuf.join('\n'));
      out.push(`<pre><code>${code}</code></pre>`);
    }
    flushPara();
    closeLists();

    // Sanitize the generated HTML using existing allowlist sanitizer (now supports PRE).
    return this.sanitizeImportedHtml(out.join('\n'));
  }

  renderInlineMarkdown(text) {
    // Inline formatting on already-escaped text.
    // We escape first, then replace markdown tokens with tags.
    let s = this.escapeHtml(String(text ?? ''));

    // Inline code: `code`
    s = s.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);

    // Bold: **text**
    s = s.replace(/\*\*([^*]+)\*\*/g, (_m, inner) => `<strong>${inner}</strong>`);

    // Italic: *text* (simple)
    s = s.replace(/\*([^*]+)\*/g, (_m, inner) => `<em>${inner}</em>`);

    // Line breaks inside paragraphs
    s = s.replace(/\n/g, '<br>');
    return s;
  }

  async showVerseNotesModal() {
    if (!this.currentVerse) return;
    if (!this.canUsePrivateVerseTools()) {
      this.showToast('Please login to use notes');
      this.showLoginModal();
      return;
    }

    const verseId = Number(this.currentVerse.id);
    if (!verseId || Number.isNaN(verseId)) return;

    const ref = this.escapeHtml(this.currentVerse?.bible_reference || 'Verse');

    this.showModal('Notes', `
      <div class="space-y-3">
        <div class="text-xs text-gray-500 dark:text-gray-400">Private notes for ${ref}</div>
        <div class="flex items-center gap-2">
          <button class="btn-primary text-sm" onclick="window.churchTapApp.openNoteEditor(${verseId})">+ New Note</button>
          <button class="btn-secondary text-sm" onclick="window.churchTapApp.refreshNotesList(${verseId})">Refresh</button>
        </div>
        <div id="verseNotesList" class="space-y-2">
          <div class="text-sm text-gray-600 dark:text-gray-400">Loading…</div>
        </div>
      </div>
    `);

    await this.refreshNotesList(verseId);
  }

  async refreshNotesList(verseId) {
    const listEl = document.getElementById('verseNotesList');
    if (!listEl) return;

    try {
      const res = await fetch(this.buildApiUrl(`/api/verse-notes/verse/${Number(verseId)}`), { credentials: 'include' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        listEl.innerHTML = `<div class="text-sm text-red-600">${this.escapeHtml(data?.error || 'Unable to load notes')}</div>`;
        return;
      }

      const notes = Array.isArray(data.notes) ? data.notes : [];
      this.currentNotesCount = notes.length;
      this.updateNotesBadge(notes.length);

      if (notes.length === 0) {
        listEl.innerHTML = `<div class="text-sm text-gray-600 dark:text-gray-400">No notes yet. Add one!</div>`;
        return;
      }

      listEl.innerHTML = notes.map(n => {
        const id = Number(n.id);
        const title = n.created_at ? this.escapeHtml(new Date(n.created_at).toLocaleString()) : 'Note';
        const preview = String(n.body_markdown || '').split('\n').slice(0, 2).join(' ').slice(0, 140);
        const created = n.created_at ? new Date(n.created_at).toLocaleString() : '';
        return `
          <div class="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/30">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="text-sm font-semibold text-gray-900 dark:text-white truncate">${title}</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">${this.escapeHtml(created)}</div>
              </div>
              <div class="flex items-center gap-2">
                <button class="btn-secondary text-xs" onclick="window.churchTapApp.openNoteEditor(${Number(verseId)}, ${id})">Edit</button>
                <button class="px-3 py-2 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30 text-red-700 dark:text-red-300 transition-colors text-xs"
                        onclick="window.churchTapApp.deleteNote(${id}, ${Number(verseId)})">Delete</button>
              </div>
            </div>
            ${preview ? `<div class="mt-2 text-sm text-gray-700 dark:text-gray-200">${this.renderInlineMarkdown(preview)}</div>` : ''}
          </div>
        `;
      }).join('');
    } catch (e) {
      console.error('refreshNotesList error:', e);
      listEl.innerHTML = `<div class="text-sm text-red-600">Unable to load notes.</div>`;
    }
  }

  async previewNote(noteId) {
    const id = Number(noteId);
    if (!id || Number.isNaN(id)) return;
    if (!this.canUsePrivateVerseTools()) return;

    // We don't have a "get note by id" endpoint; fetch verse notes list and find it (keeps backend simple).
    const verseId = Number(this.currentVerse?.id);
    if (!verseId) return;
    const res = await fetch(this.buildApiUrl(`/api/verse-notes/verse/${verseId}`), { credentials: 'include' });
    const data = await res.json().catch(() => null);
    const notes = res.ok && data?.success && Array.isArray(data.notes) ? data.notes : [];
    const note = notes.find(n => Number(n.id) === id);
    if (!note) return;

    const title = note.created_at ? this.escapeHtml(new Date(note.created_at).toLocaleString()) : 'Note';
    const html = this.markdownToSafeHtml(note.body_markdown || '');

    this.showModal('Note Preview', `
      <div class="space-y-3">
        <div class="text-sm font-semibold text-gray-900 dark:text-white">${title}</div>
        <div class="text-sm text-gray-700 dark:text-gray-200 leading-relaxed space-y-2">${html || '<p>(empty)</p>'}</div>
        <div class="flex justify-end gap-2">
          <button class="btn-secondary" onclick="window.churchTapApp.closeModal()">Close</button>
        </div>
      </div>
    `);
  }

  async openNoteEditor(verseId, noteId = null) {
    if (!this.canUsePrivateVerseTools()) return;
    const vid = Number(verseId);
    if (!vid || Number.isNaN(vid)) return;

    let existing = null;
    if (noteId) {
      const res = await fetch(this.buildApiUrl(`/api/verse-notes/verse/${vid}`), { credentials: 'include' });
      const data = await res.json().catch(() => null);
      const notes = res.ok && data?.success && Array.isArray(data.notes) ? data.notes : [];
      existing = notes.find(n => Number(n.id) === Number(noteId)) || null;
    }

    const initMarkdown = String(existing?.body_markdown || '');
    const createdLabel = existing?.created_at ? this.escapeHtml(new Date(existing.created_at).toLocaleString()) : '';

    this.showModal(noteId ? 'Edit Note' : 'New Note', `
      <div class="space-y-3">
        ${createdLabel ? `<div class="text-xs text-gray-500 dark:text-gray-400">Created ${createdLabel}</div>` : ''}

        <div class="flex flex-wrap items-center gap-2">
          <button class="btn-secondary text-xs" data-note-format="bold" onmousedown="event.preventDefault()" onclick="window.churchTapApp.noteExec('bold')"><strong>B</strong></button>
          <button class="btn-secondary text-xs" data-note-format="italic" onmousedown="event.preventDefault()" onclick="window.churchTapApp.noteExec('italic')"><em>I</em></button>
          <button class="btn-secondary text-xs" onmousedown="event.preventDefault()" onclick="window.churchTapApp.noteExec('ul')">• List</button>
          <button class="btn-secondary text-xs" onmousedown="event.preventDefault()" onclick="window.churchTapApp.noteExec('quote')">❝ Quote</button>
          <button class="btn-secondary text-xs" data-note-format="code" onmousedown="event.preventDefault()" onclick="window.churchTapApp.noteExec('code')">{ } Code</button>
        </div>

        <div id="noteEditorWrap" class="space-y-2">
          <div id="noteBodyInput"
               contenteditable="true"
               role="textbox"
               aria-label="Note editor"
               class="w-full min-h-[12.5rem] px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm leading-relaxed overflow-y-auto"></div>
          <div class="text-xs text-gray-500 dark:text-gray-400">Tip: Use the toolbar to format as you type.</div>
        </div>

        <div class="flex justify-end gap-2">
          <button class="btn-secondary" onclick="window.churchTapApp.closeModal()">Cancel</button>
          <button class="btn-primary" onclick="window.churchTapApp.saveNote(${vid}, ${noteId ? Number(noteId) : 'null'})">Save</button>
        </div>
      </div>
    `);

    this.setNoteEditorMarkdown(initMarkdown);
    this.attachNoteEditorHandlers();
  }

  getNoteEditorEl() {
    const el = document.getElementById('noteBodyInput');
    return el && el.isContentEditable ? el : null;
  }

  setNoteEditorMarkdown(markdown) {
    const editor = this.getNoteEditorEl();
    if (!editor) return;
    const html = this.markdownToSafeHtml(String(markdown || ''));
    editor.innerHTML = html || '';
    editor.focus();
    this.syncNoteFormatButtonsFromSelection();
  }

  // Very small sanitizer for contenteditable HTML (no attributes allowed).
  sanitizeNoteEditorHtml(html) {
    const raw = String(html || '');
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${raw}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    if (!root) return '';

    const allowed = new Set(['B', 'STRONG', 'I', 'EM', 'CODE', 'P', 'BR', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'DIV']);

    const walk = (node) => {
      if (!node) return;
      const children = Array.from(node.childNodes || []);
      for (const ch of children) walk(ch);

      if (node.nodeType === 1) {
        const tag = node.tagName;
        if (!allowed.has(tag)) {
          // Replace unknown elements with their text content.
          const txt = doc.createTextNode(node.textContent || '');
          node.replaceWith(txt);
          return;
        }
        // Strip all attributes
        const attrs = Array.from(node.attributes || []);
        for (const a of attrs) node.removeAttribute(a.name);
      }
    };
    walk(root);

    return root.innerHTML;
  }

  // Convert sanitized HTML (limited tags) back to markdown for storage.
  noteEditorHtmlToMarkdown(html) {
    const safeHtml = this.sanitizeNoteEditorHtml(html);
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${safeHtml}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    if (!root) return '';

    const textMd = (s) => String(s || '').replace(/\r\n/g, '\n');

    const childrenToMd = (node) => Array.from(node.childNodes || []).map(nodeToMd).join('');

    const nodeToMd = (node) => {
      if (!node) return '';
      if (node.nodeType === 3) return textMd(node.nodeValue);
      if (node.nodeType !== 1) return '';

      const tag = node.tagName;
      if (tag === 'BR') return '\n';
      if (tag === 'STRONG' || tag === 'B') return `**${childrenToMd(node)}**`;
      if (tag === 'EM' || tag === 'I') return `*${childrenToMd(node)}*`;
      if (tag === 'CODE') {
        const t = textMd(node.textContent || '').replace(/`/g, '\\`');
        return `\`${t}\``;
      }
      if (tag === 'LI') return childrenToMd(node).trim();
      if (tag === 'UL') {
        const lis = Array.from(node.querySelectorAll(':scope > li'));
        const lines = lis.map(li => `- ${nodeToMd(li)}`).join('\n');
        return `${lines}\n\n`;
      }
      if (tag === 'OL') {
        const lis = Array.from(node.querySelectorAll(':scope > li'));
        const lines = lis.map((li, idx) => `${idx + 1}. ${nodeToMd(li)}`).join('\n');
        return `${lines}\n\n`;
      }
      if (tag === 'BLOCKQUOTE') {
        const inner = childrenToMd(node).trim().split('\n').map(l => (l ? `> ${l}` : '>')).join('\n');
        return `${inner}\n\n`;
      }
      if (tag === 'P' || tag === 'DIV') {
        const inner = childrenToMd(node).trim();
        return inner ? `${inner}\n\n` : '';
      }

      // Fallback
      return childrenToMd(node);
    };

    let md = childrenToMd(root);
    md = md.replace(/[ \t]+\n/g, '\n');
    md = md.replace(/\n{3,}/g, '\n\n');
    md = md.trim();
    return md;
  }

  syncNoteFormatButtonsFromSelection() {
    const activeClass = 'bg-primary-600 text-white';
    const kinds = ['bold', 'italic', 'code'];
    const editor = this.getNoteEditorEl();
    const sel = window.getSelection?.();

    // Determine states
    let boldOn = false;
    let italicOn = false;
    try { boldOn = !!document.queryCommandState?.('bold'); } catch (e) {}
    try { italicOn = !!document.queryCommandState?.('italic'); } catch (e) {}

    let codeOn = false;
    try {
      const anchor = sel?.anchorNode;
      const el = anchor && anchor.nodeType === 3 ? anchor.parentElement : anchor;
      codeOn = !!(el && el.closest && el.closest('code'));
    } catch (e) {}

    const state = { bold: boldOn, italic: italicOn, code: codeOn };

    for (const k of kinds) {
      const btns = Array.from(document.querySelectorAll(`[data-note-format="${k}"]`));
      for (const btn of btns) {
        const isOn = state[k] === true && !!editor && !!sel;
        if (!btn.classList.contains('btn-secondary')) btn.classList.add('btn-secondary');
        if (isOn) btn.classList.add(...activeClass.split(' '));
        else btn.classList.remove(...activeClass.split(' '));
      }
    }
  }

  // Inline code toggle for contenteditable (wrap selection in <code>).
  toggleInlineCode() {
    const editor = this.getNoteEditorEl();
    if (!editor) return;
    editor.focus();

    const sel = window.getSelection?.();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);

    // If selection/caret is inside an existing code tag, unwrap it.
    const anchor = sel.anchorNode && sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
    const codeEl = anchor && anchor.closest ? anchor.closest('code') : null;
    if (codeEl && editor.contains(codeEl)) {
      const parent = codeEl.parentNode;
      while (codeEl.firstChild) parent.insertBefore(codeEl.firstChild, codeEl);
      parent.removeChild(codeEl);
      return;
    }

    if (range.collapsed) {
      const code = document.createElement('code');
      const zwsp = document.createTextNode('\u200B');
      code.appendChild(zwsp);
      range.insertNode(code);
      // Place cursor inside the code node, after the zwsp
      const r = document.createRange();
      r.setStart(zwsp, 1);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }

    const code = document.createElement('code');
    try {
      code.appendChild(range.extractContents());
      range.insertNode(code);
      sel.removeAllRanges();
      const r = document.createRange();
      r.selectNodeContents(code);
      r.collapse(false);
      sel.addRange(r);
    } catch (e) {}
  }

  saveNoteEditorSelection() {
    const editor = this.getNoteEditorEl();
    if (!editor) return;
    const sel = window.getSelection?.();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    // Only save if selection is inside the editor
    const anchor = sel.anchorNode && sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
    if (!anchor || !editor.contains(anchor)) return;
    // Clone so it survives DOM operations
    this._noteEditorSavedRange = range.cloneRange();
  }

  restoreNoteEditorSelection() {
    const editor = this.getNoteEditorEl();
    const r = this._noteEditorSavedRange;
    if (!editor || !r) return;
    try {
      const sel = window.getSelection?.();
      if (!sel) return;
      editor.focus();
      sel.removeAllRanges();
      sel.addRange(r);
    } catch (e) {}
  }

  noteExec(cmd) {
    const editor = this.getNoteEditorEl();
    if (!editor) return;
    // Button click can steal focus/selection; restore last known caret first.
    this.restoreNoteEditorSelection();

    const c = String(cmd || '').trim().toLowerCase();
    try {
      if (c === 'bold') document.execCommand('bold');
      else if (c === 'italic') document.execCommand('italic');
      else if (c === 'ul') document.execCommand('insertUnorderedList');
      else if (c === 'quote') document.execCommand('formatBlock', false, 'blockquote');
      else if (c === 'code') this.toggleInlineCode();
    } catch (e) {}

    this.syncNoteFormatButtonsFromSelection();
    this.saveNoteEditorSelection();
  }

  attachNoteEditorHandlers() {
    const editor = this.getNoteEditorEl();
    if (!editor) return;

    // Keep toolbar state synced as user moves caret/selects.
    const sync = () => {
      this.saveNoteEditorSelection();
      this.syncNoteFormatButtonsFromSelection();
    };
    editor.addEventListener('keyup', sync);
    editor.addEventListener('mouseup', sync);
    editor.addEventListener('input', sync);
    // Also catch selection changes triggered by touch selection handles.
    if (!this._noteEditorSelectionChangeBound) {
      this._noteEditorSelectionChangeBound = true;
      document.addEventListener('selectionchange', () => {
        // Only save/sync if the active selection is inside the editor.
        const ed = this.getNoteEditorEl();
        if (!ed) return;
        const sel = window.getSelection?.();
        const anchor = sel?.anchorNode && sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel?.anchorNode;
        if (!anchor || !ed.contains(anchor)) return;
        this.saveNoteEditorSelection();
        this.syncNoteFormatButtonsFromSelection();
      });
    }
    sync();
  }

  toggleNotePreview() {
    const editor = document.getElementById('noteEditorWrap');
    const preview = document.getElementById('notePreviewWrap');
    const ta = document.getElementById('noteBodyInput');
    if (!editor || !preview || !ta) return;

    const showingPreview = !preview.classList.contains('hidden');
    if (showingPreview) {
      preview.classList.add('hidden');
      editor.classList.remove('hidden');
      return;
    }

    const html = this.markdownToSafeHtml(ta.value || '');
    preview.innerHTML = html || '<p class="text-gray-500">(empty)</p>';
    editor.classList.add('hidden');
    preview.classList.remove('hidden');
  }

  async saveNote(verseId, noteId) {
    if (!this.canUsePrivateVerseTools()) return;
    const vid = Number(verseId);
    if (!vid || Number.isNaN(vid)) return;

    const editor = this.getNoteEditorEl();
    const body = this.noteEditorHtmlToMarkdown(editor?.innerHTML || '');
    if (!body) {
      this.showToast('Please write something first');
      return;
    }

    try {
      if (noteId) {
        const res = await fetch(this.buildApiUrl(`/api/verse-notes/${Number(noteId)}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ title: null, body_markdown: body })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          this.showToast(data?.error || 'Failed to save note');
          return;
        }
      } else {
        const res = await fetch(this.buildApiUrl(`/api/verse-notes/verse/${vid}`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ title: null, body_markdown: body })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          this.showToast(data?.error || 'Failed to save note');
          return;
        }
      }

      this.showToast('Saved');
      // Return to notes list
      await this.showVerseNotesModal();
    } catch (e) {
      console.error('saveNote error:', e);
      this.showToast('Failed to save note');
    }
  }

  async deleteNote(noteId, verseId) {
    const id = Number(noteId);
    const vid = Number(verseId);
    if (!id || Number.isNaN(id) || !vid || Number.isNaN(vid)) return;
    if (!window.confirm('Delete this note?')) return;

    try {
      const res = await fetch(this.buildApiUrl(`/api/verse-notes/${id}`), {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        this.showToast(data?.error || 'Failed to delete note');
        return;
      }
      this.showToast('Deleted');
      await this.refreshNotesList(vid);
      await this.refreshVersePrivateToolsState();
    } catch (e) {
      console.error('deleteNote error:', e);
      this.showToast('Failed to delete note');
    }
  }

  showMyStuffSearchModal() {
    if (!this.canUsePrivateVerseTools()) {
      this.showToast('Please login to search your content');
      this.showLoginModal();
      return;
    }

    this.showModal('Search My Stuff', `
      <div class="space-y-3">
        <form id="myStuffSearchForm" class="flex items-center gap-2">
          <input id="myStuffSearchInput" type="text" autocomplete="off" placeholder="Search notes, collections, prayers…"
                 class="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm" />
          <button type="submit" class="btn-primary text-sm">Search</button>
        </form>
        <div id="myStuffSearchResults" class="space-y-2"></div>
      </div>
    `);

    document.getElementById('myStuffSearchForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = String(document.getElementById('myStuffSearchInput')?.value || '').trim();
      await this.runMyStuffSearch(q);
    });

    setTimeout(() => document.getElementById('myStuffSearchInput')?.focus(), 50);
  }

  async runMyStuffSearch(query) {
    const q = String(query || '').trim();
    const resultsEl = document.getElementById('myStuffSearchResults');
    if (!resultsEl) return;

    if (!q || q.length < 2) {
      resultsEl.innerHTML = `<div class="text-sm text-gray-600 dark:text-gray-400">Type at least 2 characters.</div>`;
      return;
    }

    resultsEl.innerHTML = `<div class="text-sm text-gray-600 dark:text-gray-400">Searching…</div>`;

    try {
      const res = await fetch(this.buildApiUrl(`/api/me/search?q=${encodeURIComponent(q)}&limit=25`), { credentials: 'include' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        resultsEl.innerHTML = `<div class="text-sm text-red-600">${this.escapeHtml(data?.error || 'Search failed')}</div>`;
        return;
      }

      const results = Array.isArray(data.results) ? data.results : [];
      if (results.length === 0) {
        resultsEl.innerHTML = `<div class="text-sm text-gray-600 dark:text-gray-400">No matches.</div>`;
        return;
      }

      resultsEl.innerHTML = results.map(r => {
        const type = this.escapeHtml(r.type || '');
        const title = this.escapeHtml(r.title || '');
        const snippet = this.escapeHtml(r.snippet || '');
        const meta = r.type === 'note' && r.bible_reference ? this.escapeHtml(r.bible_reference) : '';
        return `
          <div class="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/30">
            <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">${type}${meta ? ` • ${meta}` : ''}</div>
            <div class="text-sm font-semibold text-gray-900 dark:text-white mt-1">${title}</div>
            ${snippet ? `<div class="text-sm text-gray-700 dark:text-gray-200 mt-1">${snippet}</div>` : ''}
          </div>
        `;
      }).join('');
    } catch (e) {
      console.error('runMyStuffSearch error:', e);
      resultsEl.innerHTML = `<div class="text-sm text-red-600">Search failed.</div>`;
    }
  }

  // ===========================
  // Study Tools State + Recent
  // ===========================
  loadStudyRecent() {
    try {
      const raw = localStorage.getItem('studyRecent.v1');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  saveStudyRecent(recent) {
    try {
      localStorage.setItem('studyRecent.v1', JSON.stringify(Array.isArray(recent) ? recent.slice(0, 20) : []));
    } catch (e) {
      // ignore
    }
  }

  loadStudyState() {
    let translation = '';
    try {
      // Defaults should come from Menu; Study page can override in-memory only.
      translation = String(localStorage.getItem('defaultTranslation.v1') || '').toUpperCase();
    } catch (e) {}
    let commentarySourceKey = '';
    let dictionarySourceKey = '';
    try {
      commentarySourceKey = String(localStorage.getItem('defaultCommentarySource.v1') || '');
      dictionarySourceKey = String(localStorage.getItem('defaultDictionarySource.v1') || '');
    } catch (e) {}

    return {
      mode: 'bible',
      ref: '',
      word: '',
      translation,
      commentarySourceKey,
      dictionarySourceKey,
      recent: this.loadStudyRecent()
    };
  }

  async ensureStudySourcesLoaded() {
    this._studyCommentarySources = this._studyCommentarySources || null;
    this._studyDictionarySources = this._studyDictionarySources || null;

    const tasks = [];
    if (this._studyCommentarySources === null) {
      tasks.push(
        fetch(this.buildApiUrl('/api/commentary/sources'), { credentials: 'include' })
          .then(r => r.json().catch(() => null))
          .then(d => { this._studyCommentarySources = Array.isArray(d?.sources) ? d.sources : []; })
          .catch(() => { this._studyCommentarySources = []; })
      );
    }
    if (this._studyDictionarySources === null) {
      tasks.push(
        fetch(this.buildApiUrl('/api/dictionary/sources'), { credentials: 'include' })
          .then(r => r.json().catch(() => null))
          .then(d => { this._studyDictionarySources = Array.isArray(d?.sources) ? d.sources : []; })
          .catch(() => { this._studyDictionarySources = []; })
      );
    }
    await Promise.all(tasks);
    this.updateStudyPickerOptions();
    this.updateMenuDefaultPickers?.();
  }

  updateStudyPickerOptions() {
    const mode = (this.studyState?.mode || 'bible');
    const picker = document.getElementById('studySourceSelect');
    if (!picker) return;

    if (mode === 'bible') {
      const enabled = this.getEnabledTranslationCodes();
      const current = String(this.studyState?.translation || this.getUserPreferredTranslation() || 'NASB').toUpperCase();
      const options = (enabled && enabled.length ? enabled : ['NASB', 'ESV', 'NIV', 'NLT', 'KJV', 'CSB', 'MSG'])
        .map(code => {
          const c = String(code || '').toUpperCase();
          return `<option value="${this.escapeHtml(c)}" ${c === current ? 'selected' : ''}>${this.escapeHtml(c)}</option>`;
        })
        .join('');
      picker.innerHTML = options;
      return;
    }

    if (mode === 'commentary') {
      const sources = Array.isArray(this._studyCommentarySources) ? this._studyCommentarySources : [];
      const current = String(this.studyState?.commentarySourceKey || '');
      const opts = [
        `<option value="" ${current ? '' : 'selected'}>Auto</option>`,
        ...sources.map(s => {
          const key = String(s.source_key || '');
          const label = String(s.title || s.abbreviation || key || 'Source');
          return `<option value="${this.escapeHtml(key)}" ${key === current ? 'selected' : ''}>${this.escapeHtml(label)}</option>`;
        })
      ].join('');
      picker.innerHTML = opts;
      return;
    }

    // dictionary
    const sources = Array.isArray(this._studyDictionarySources) ? this._studyDictionarySources : [];
    const current = String(this.studyState?.dictionarySourceKey || '');
    const opts = [
      `<option value="" ${current ? '' : 'selected'}>Auto</option>`,
      ...sources.map(s => {
        const key = String(s.source_key || '');
        const label = String(s.title || s.abbreviation || key || 'Source');
        return `<option value="${this.escapeHtml(key)}" ${key === current ? 'selected' : ''}>${this.escapeHtml(label)}</option>`;
      })
    ].join('');
    picker.innerHTML = opts;
  }

  handleStudySourceChange(value) {
    const mode = (this.studyState?.mode || 'bible');
    const v = String(value || '').trim();
    if (mode === 'bible') {
      this.studyState.translation = v.toUpperCase();
      this.runStudyLookup().catch(() => {});
      return;
    }
    if (mode === 'commentary') {
      this.studyState.commentarySourceKey = v;
      this.runStudyLookup().catch(() => {});
      return;
    }
    this.studyState.dictionarySourceKey = v;
    this.runStudyLookup().catch(() => {});
  }

  async ensureBibleStructureLoaded() {
    if (this.bibleStructureByNumber) return this.bibleStructureByNumber;
    try {
      const res = await fetch('/data/bible_verse_counts.json', { cache: 'force-cache' });
      if (!res.ok) throw new Error(`Failed to load bible structure: ${res.status}`);
      const rows = await res.json();
      if (!Array.isArray(rows)) throw new Error('Invalid bible structure JSON');

      const nameToNumber = {};
      for (let i = 1; i <= 66; i++) nameToNumber[this.getBookName(i)] = i;

      const byNum = {};
      rows.forEach(row => {
        const bookName = String(row?.book || '').trim();
        const bookNum = nameToNumber[bookName];
        if (!bookNum) return;

        const chapters = Array.isArray(row?.chapters) ? row.chapters : [];
        const verseCounts = chapters
          .map(c => parseInt(String(c?.verses || '0'), 10))
          .filter(n => Number.isFinite(n) && n > 0);

        byNum[bookNum] = {
          name: bookName,
          abbr: String(row?.abbr || '').trim(),
          verseCounts
        };
      });

      this.bibleStructureByNumber = byNum;
      return byNum;
    } catch (e) {
      console.error('Failed to load bible structure', e);
      this.bibleStructureByNumber = {}; // cache failure to avoid repeated fetch loops
      return this.bibleStructureByNumber;
    }
  }

  resolveBookNumberFromInput(bookInput) {
    const s = String(bookInput || '').trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) {
      const n = parseInt(s, 10);
      if (Number.isFinite(n) && n >= 1 && n <= 66) return n;
      return null;
    }
    // Reuse our robust book-name parsing by faking a reference.
    const parsed = this.parseBibleReference(`${s} 1:1`);
    return parsed?.book || null;
  }

  async init() {
    try {
      this.setupEventListeners();
      this.applyTheme();
      this.applyTextSize();
      await this.checkAuthStatus();

      // Load org feature flags early so we can hide/disable UI and skip calls
      await this.loadOrganizationFeatures();
      this.applyFeatureTogglesToUI();

      // Routing (must exist before rendering the correct page)
      this.setupRouting();

      this.updateTranslationButtons();
      this.hideSplashScreen();
      
      // Load content with proper error handling
      // Only auto-load verse/community when the current route is the verse view.
      if (this.isVerseRoute(window.location.pathname)) {
        this.loadVerse(this.currentDate)
          .catch(err => {
            console.error('Verse loading failed:', err);
            this.showErrorState('verse', 'Unable to load today\'s verse. Please check your connection and try again.');
          });
        
        this.loadCommunity(this.currentDate)
          .catch(err => {
            console.error('Community loading failed:', err);
            this.showErrorState('community', 'Unable to load community content.');
          });
      }
      
      this.setupSwipeGestures();
      this.checkNotificationPermission();
      this.detectNFCSupport();
      if (this.isFeatureEnabled('group_links_enabled')) {
        this.loadOrganizationLinks();
      }
      if (this.isFeatureEnabled('group_calendar_enabled')) {
        this.updateCalendarIndicatorForToday();
      }

      // Optional: show fundraising button if configured
      this.loadFundraising().catch(() => {});
      this.loadWorshipPlaylist().catch(() => {});
      this.initCTA();
      this.updateMenuIndicators();
      this.updateTagSessionUI();

      // If we were redirected here specifically to join a group, prompt login first (then we route to Join Group page).
      if (this.joinGroupRequested) {
        setTimeout(() => {
          if (!this.currentUser) {
            this.showLoginModal();
          }
        }, 250);
      }
    } catch (error) {
      console.error('Init error:', error);
      this.showCriticalError('Application failed to initialize. Please refresh the page.');
      this.hideSplashScreen();
    }
  }

  // ===========================
  // Organization Feature Flags
  // ===========================
  async loadOrganizationFeatures() {
    try {
      const res = await fetch(this.withOrg('/api/organization/features'), { credentials: 'include' });
      const data = await res.json().catch(() => null);
      if (data?.success) {
        this.orgFeatures = data.features || null;
        this.translationCatalog = data.translation_catalog || [];
      } else {
        this.orgFeatures = null;
        this.translationCatalog = [];
      }
    } catch (e) {
      console.error('Failed to load organization features:', e);
      this.orgFeatures = null;
      this.translationCatalog = [];
    }
  }

  isFeatureEnabled(flagName) {
    // Fail-open: if we can't load flags, keep everything enabled.
    if (!this.orgFeatures) return true;
    if (!flagName) return true;
    return this.orgFeatures[flagName] !== false;
  }

  getEnabledTranslationCodes() {
    const enabled = this.orgFeatures?.enabled_translations;
    const catalogCodes = (this.translationCatalog || []).map(t => String(t.code || '').toUpperCase()).filter(Boolean);
    if (enabled === null || enabled === undefined) return catalogCodes;
    if (!Array.isArray(enabled)) return catalogCodes;
    // Allow empty array => none
    return enabled.map(c => String(c || '').toUpperCase()).filter(Boolean);
  }

  applyFeatureTogglesToUI() {
    // Links
    if (!this.isFeatureEnabled('group_links_enabled')) {
      const linksBtn = document.getElementById('tabLinksBtn');
      if (linksBtn) linksBtn.style.display = 'none';
      const menu = document.getElementById('quickLinksMenu');
      if (menu) menu.classList.add('hidden');
    }

    // Calendar
    if (!this.isFeatureEnabled('group_calendar_enabled')) {
      const todayPill = document.getElementById('todayEventPill');
      if (todayPill) todayPill.classList.add('hidden');
    }

    // Community action buttons
    if (!this.isFeatureEnabled('prayer_requests_enabled')) {
      const btn = document.getElementById('submitPrayerBtn');
      if (btn) btn.style.display = 'none';
    }
    if (!this.isFeatureEnabled('praise_reports_enabled')) {
      const btn = document.getElementById('submitPraiseBtn');
      if (btn) btn.style.display = 'none';
    }
    if (!this.isFeatureEnabled('insights_enabled')) {
      const btn = document.getElementById('submitInsightBtn');
      if (btn) btn.style.display = 'none';
    }

    // Translations: hide "View in Translation" if no translations enabled
    const enabledTranslations = this.getEnabledTranslationCodes();
    if (Array.isArray(enabledTranslations) && enabledTranslations.length === 0) {
      ['textTranslationBtn', 'textTranslationBtnDesktop', 'imageTranslationBtn', 'imageTranslationBtnDesktop'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
    }

    // Topics (tag button / Emergency Scripture)
    if (!this.isFeatureEnabled('topics_enabled')) {
      const topicsBtn = document.getElementById('topicsBtn');
      if (topicsBtn) topicsBtn.style.display = 'none';
    }
  }

  // ===========================
  // Routing + Pages
  // ===========================
  setupRouting() {
    window.addEventListener('popstate', () => {
      this.routeTo(window.location.pathname);
    });

    // Initial route
    this.routeTo(window.location.pathname);
  }

  isVerseRoute(pathname) {
    const path = String(pathname || '/');
    if (path === '/' || path === '/app') return true;
    // Tap route should behave like the main verse view
    if (/^\/t\/[^\/?#]+$/.test(path)) return true;
    return /^\/verse\/[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(path);
  }

  navigate(path) {
    const p = String(path || '/');
    if (window.location.pathname === p) return;
    window.history.pushState({}, '', p);
    this.routeTo(p);
  }

  routeTo(pathname) {
    const path = String(pathname || '/');

    // Tab: Explore
    if (path === '/explore') {
      this.setActiveTab('explore');
      this.showPageContainer();
      this.renderExplorePage();
      return;
    }

    // Study Tools (Explore): /study
    if (path === '/study') {
      // Study is part of Explore, so keep the bottom nav highlight on Explore.
      this.setActiveTab('explore');
      this.showPageContainer();
      this.renderStudyPage();
      return;
    }

    // Tab: Community (shortcut to the community section on Today)
    if (path === '/community') {
      this.setActiveTab('community');
      this.showVerseContainer();
      this.loadVerse(this.currentDate).catch(() => {});
      this.loadCommunity(this.currentDate).catch(() => {});
      setTimeout(() => {
        document.getElementById('communitySection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
      return;
    }

    // Tab: Saved
    if (path === '/saved') {
      // "Saved" lives under Me now, so keep bottom nav highlight on Me.
      this.setActiveTab('me');
      this.showPageContainer();
      this.renderSavedPage();
      return;
    }

    // Tab: Me
    if (path === '/me') {
      this.setActiveTab('me');
      this.showPageContainer();
      this.renderMePage();
      return;
    }

    // Tab: Links
    if (path === '/links') {
      this.setActiveTab('links');
      this.showPageContainer();
      this.renderLinksPage();
      return;
    }

    // Tab: Menu (Settings + Tools)
    if (path === '/menu') {
      this.setActiveTab('menu');
      this.showPageContainer();
      this.renderMenuPage();
      return;
    }

    // Me: My Notes
    if (path === '/my-notes') {
      this.setActiveTab('me');
      this.showPageContainer();
      this.renderMyNotesPage();
      return;
    }

    // Me: My Highlights
    if (path === '/my-highlights') {
      this.setActiveTab('me');
      this.showPageContainer();
      this.renderMyHighlightsPage();
      return;
    }

    // Tap route: /t/<UID> (show main verse view for this tag session)
    const tapMatch = path.match(/^\/t\/([^\/?#]+)$/);
    if (tapMatch) {
      this.setActiveTab('today');
      this.showVerseContainer();
      this.loadVerse(this.currentDate).catch(() => {});
      this.loadCommunity(this.currentDate).catch(() => {});
      return;
    }

    // Collections detail: /collections/:id
    const collectionMatch = path.match(/^\/collections\/(\d+)$/);
    if (collectionMatch) {
      this.setActiveTab('me');
      this.showPageContainer();
      this.renderCollectionDetailPage(Number(collectionMatch[1]));
      return;
    }

    if (path === '/favorites') {
      this.setActiveTab('me');
      this.showPageContainer();
      this.renderFavoritesPage();
      return;
    }

    if (path === '/collections') {
      this.setActiveTab('me');
      this.showPageContainer();
      this.renderCollectionsPage();
      return;
    }

    if (path === '/my-prayers') {
      this.setActiveTab('me');
      this.showPageContainer();
      this.renderMyPrayersPage();
      return;
    }

    // Verse route: /verse/YYYY-MM-DD
    const verseMatch = path.match(/^\/verse\/([0-9]{4}-[0-9]{2}-[0-9]{2})$/);
    if (verseMatch) {
      const date = verseMatch[1];
      this.currentDate = date;
      this.setActiveTab('today');
      this.showVerseContainer();
      this.loadVerse(date).catch(() => {});
      this.loadCommunity(date).catch(() => {});
      return;
    }

    // Default: main verse view
    this.setActiveTab('today');
    this.showVerseContainer();
  }

  showPageContainer() {
    const pageContainer = document.getElementById('pageContainer');
    if (pageContainer) pageContainer.classList.remove('hidden');

    const dateNav = document.getElementById('dateNav');
    if (dateNav) dateNav.classList.add('hidden');

    const verseContainer = document.getElementById('verseContainer');
    if (verseContainer) verseContainer.classList.add('hidden');

    const engagementActions = document.getElementById('engagementActions');
    if (engagementActions) engagementActions.classList.add('hidden');

    const communitySection = document.getElementById('communitySection');
    if (communitySection) communitySection.classList.add('hidden');

    this.hideQuickMenu();
  }

  showVerseContainer() {
    const pageContainer = document.getElementById('pageContainer');
    if (pageContainer) pageContainer.classList.add('hidden');

    const dateNav = document.getElementById('dateNav');
    if (dateNav) dateNav.classList.remove('hidden');

    const verseContainer = document.getElementById('verseContainer');
    if (verseContainer) verseContainer.classList.remove('hidden');

    const engagementActions = document.getElementById('engagementActions');
    if (engagementActions) engagementActions.classList.remove('hidden');

    // Community renders inline on Today
    const communitySection = document.getElementById('communitySection');
    if (communitySection) communitySection.classList.remove('hidden');

    this.hideQuickMenu();
  }

  // ===========================
  // Mobile-first bottom tabs
  // ===========================
  setActiveTab(tabName) {
    const tab = String(tabName || '').toLowerCase();
    const all = ['today', 'explore', 'community', 'links', 'menu', 'saved', 'me'];
    all.forEach(t => {
      const icon = document.querySelector(`[data-tab-icon="${t}"]`);
      const label = document.querySelector(`[data-tab-label="${t}"]`);
      const isActive = t === tab;
      if (icon) {
        icon.classList.toggle('text-primary-600', isActive);
        icon.classList.toggle('dark:text-primary-400', isActive);
        icon.classList.toggle('text-gray-600', !isActive);
        icon.classList.toggle('dark:text-gray-400', !isActive);
      }
      if (label) {
        label.classList.toggle('text-primary-600', isActive);
        label.classList.toggle('dark:text-primary-400', isActive);
        label.classList.toggle('text-gray-600', !isActive);
        label.classList.toggle('dark:text-gray-400', !isActive);
      }
    });
  }

  renderExplorePage() {
    const studyEnabled = this.isStudyModeEnabled();
    const studyTile = studyEnabled
      ? `
          <button id="exploreStudyTile" class="p-4 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-gray-200 dark:border-gray-700 text-left hover:bg-purple-100 dark:hover:bg-purple-800 transition-colors"
                  onclick="window.churchTapApp.navigate('/study')">
            <div class="text-lg">📚</div>
            <div class="mt-1 text-sm font-semibold text-gray-900 dark:text-white">Study</div>
            <div class="text-xs text-gray-600 dark:text-gray-400 mt-1">Definitions • Commentary</div>
          </button>
        `
      : `
          <button id="exploreStudyTile" class="p-4 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  onclick="window.churchTapApp.navigate('/menu'); window.churchTapApp.showToast('Turn on Study Mode in Menu to unlock Study tools')">
            <div class="text-lg">🔒</div>
            <div class="mt-1 text-sm font-semibold text-gray-900 dark:text-white">Study</div>
            <div class="text-xs text-gray-600 dark:text-gray-400 mt-1">Turn on Study Mode in Menu</div>
          </button>
        `;

    this.setPageContent(`
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mt-4">
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-lg font-semibold text-gray-800 dark:text-white">Explore</h2>
          <button class="btn-secondary text-sm" onclick="window.churchTapApp.goToToday()">Today</button>
        </div>

        <div class="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Search, browse history, or discover something new.
        </div>

        <div class="grid grid-cols-2 gap-3">
          <button id="exploreReadTile" class="p-4 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  onclick="window.churchTapApp.showBibleReadModal()">
            <div class="text-lg">📖</div>
            <div class="mt-1 text-sm font-semibold text-gray-900 dark:text-white">Read</div>
            <div class="text-xs text-gray-600 dark:text-gray-400 mt-1">Book • Chapter • Verse</div>
          </button>

          <button class="p-4 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  onclick="window.churchTapApp.showVerseSearchModal()">
            <div class="text-lg">🔍</div>
            <div class="mt-1 text-sm font-semibold text-gray-900 dark:text-white">Search</div>
            <div class="text-xs text-gray-600 dark:text-gray-400 mt-1">Verses & Bible</div>
          </button>

          ${studyTile}

          <button class="p-4 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  onclick="window.churchTapApp.showHistory()">
            <div class="text-lg">🕐</div>
            <div class="mt-1 text-sm font-semibold text-gray-900 dark:text-white">History</div>
            <div class="text-xs text-gray-600 dark:text-gray-400 mt-1">Last 60 days</div>
          </button>

          <button class="p-4 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  onclick="window.churchTapApp.openCalendarModal()">
            <div class="text-lg">📅</div>
            <div class="mt-1 text-sm font-semibold text-gray-900 dark:text-white">Calendar</div>
            <div class="text-xs text-gray-600 dark:text-gray-400 mt-1">Pick a date</div>
          </button>

          <button class="p-4 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  onclick="window.churchTapApp.showRandomVerse()">
            <div class="text-lg">🎲</div>
            <div class="mt-1 text-sm font-semibold text-gray-900 dark:text-white">Random</div>
            <div class="text-xs text-gray-600 dark:text-gray-400 mt-1">Surprise me</div>
          </button>
        </div>

        <div class="mt-4">
          <button class="w-full btn-primary" onclick="window.churchTapApp.showTopicsWordCloud()">
            🏷️ Browse Topics
          </button>
        </div>
      </div>
    `);
  }

  renderSavedPage() {
    this.setPageContent(`
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mt-4">
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-lg font-semibold text-gray-800 dark:text-white">Saved</h2>
          <button class="btn-secondary text-sm" onclick="window.churchTapApp.goToToday()">Today</button>
        </div>
        <div class="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Your collections and personal prayers.
        </div>

        <div class="space-y-3">
          <button class="w-full p-4 rounded-lg border border-gray-200 dark:border-gray-700 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                  onclick="window.churchTapApp.navigate('/collections')">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-sm font-semibold text-gray-900 dark:text-white">📚 Collections</div>
                <div class="text-xs text-gray-600 dark:text-gray-400 mt-1">Group verses by theme</div>
              </div>
              <div class="text-gray-400">›</div>
            </div>
          </button>

          <button class="w-full p-4 rounded-lg border border-gray-200 dark:border-gray-700 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                  onclick="window.churchTapApp.navigate('/my-prayers')">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-sm font-semibold text-gray-900 dark:text-white">🙏 My Prayers</div>
                <div class="text-xs text-gray-600 dark:text-gray-400 mt-1">Personal prayer list</div>
              </div>
              <div class="text-gray-400">›</div>
            </div>
          </button>

          <button class="w-full p-4 rounded-lg border border-gray-200 dark:border-gray-700 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                  onclick="window.churchTapApp.showMyStuffSearchModal()">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-sm font-semibold text-gray-900 dark:text-white">🔍 Search My Stuff</div>
                <div class="text-xs text-gray-600 dark:text-gray-400 mt-1">Notes, collections, and prayers</div>
              </div>
              <div class="text-gray-400">›</div>
            </div>
          </button>
        </div>
      </div>
    `);
  }

  renderMePage() {
    const name = this.currentUser?.displayName || this.currentUser?.firstName || null;
    const title = name ? this.escapeHtml(String(name)) : 'Account';
    const isLoggedIn = !!this.currentUser;

    this.setPageContent(`
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mt-4">
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-lg font-semibold text-gray-800 dark:text-white">Me</h2>
          <button class="btn-secondary text-sm" onclick="window.churchTapApp.goToToday()">Today</button>
        </div>
        <div class="text-sm text-gray-600 dark:text-gray-400 mb-4">
          ${isLoggedIn ? `Signed in as <span class="font-medium text-gray-900 dark:text-gray-200">${title}</span>` : 'Sign in to sync favorites and join groups.'}
        </div>

        <div class="space-y-3">
          <button class="w-full btn-secondary" onclick="window.churchTapApp.navigate('/favorites')">
            ❤️ Favorites
          </button>
          <button class="w-full btn-secondary" onclick="window.churchTapApp.navigate('/collections')">
            📚 My Categories
          </button>
          <button class="w-full btn-secondary" onclick="window.churchTapApp.navigate('/my-prayers')">
            🙏 My Prayers
          </button>

          <div class="pt-2 border-t border-gray-200 dark:border-gray-700"></div>

          <button class="w-full btn-secondary" onclick="window.churchTapApp.navigate('/my-highlights')">
            🖍️ My Highlights
          </button>

          <button class="w-full btn-secondary" onclick="window.churchTapApp.navigate('/my-notes')">
            📝 My Notes
          </button>

          <button class="w-full btn-secondary" onclick="window.churchTapApp.currentUser ? window.churchTapApp.showProfileModal() : window.churchTapApp.showLoginModal()">
            👤 Profile
          </button>
        </div>

        <div class="mt-6 border-t border-gray-200 dark:border-gray-700 pt-4 space-y-3">
          ${isLoggedIn ? `
            <button class="w-full px-4 py-2 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30 text-red-700 dark:text-red-300 transition-colors"
                    onclick="window.churchTapApp.handleLogout()">
              🚪 Logout
            </button>
          ` : `
            <button class="w-full btn-primary" onclick="window.churchTapApp.showLoginModal()">
              🔑 Sign in
            </button>
            <button class="w-full btn-secondary" onclick="window.churchTapApp.showRegisterModal()">
              ✨ Create account
            </button>
          `}
        </div>
      </div>
    `);

    // These controls only make sense when logged in with an active group.
    // (The buttons are hidden otherwise.)
    this.updateVersePrivateToolsVisibility();
    if (this.currentVerse) this.refreshVersePrivateToolsState().catch(() => {});
  }

  // ===========================
  // Links Page (/links)
  // ===========================
  renderLinksPage() {
    this.setPageContent(`
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mt-4">
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-lg font-semibold text-gray-800 dark:text-white">Links</h2>
          <button class="btn-secondary text-sm" onclick="window.churchTapApp.goToToday()">Today</button>
        </div>
        <div class="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Quick links from your current group.
        </div>

        <!-- Fundraising (if active) -->
        <button id="fundraisingCard" class="hidden w-full text-left px-3 py-3 mb-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                onclick="window.churchTapApp.openFundraisingModal()">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-2">
                <div class="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                  🎯 <span id="fundraisingTitle">Fundraising</span>
                </div>
                <div id="fundraisingPct" class="text-xs font-semibold text-green-700 dark:text-green-300 tabular-nums whitespace-nowrap">0%</div>
              </div>

              <div class="mt-2 flex items-center gap-2">
                <div class="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
                  <div id="fundraisingProgressBar" class="h-1.5 bg-green-600" style="width:0%"></div>
                </div>
                <div id="fundraisingAmounts" class="text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">--</div>
              </div>

              <div id="fundraisingDeadline" class="mt-2 text-xs text-gray-500 dark:text-gray-400"></div>
            </div>
          </div>
        </button>

        <button id="playlistBtn" class="hidden w-full text-left px-3 py-2 mb-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                onclick="window.churchTapApp.openPlaylistModal()">
          📺 Worship Playlist
        </button>

        <div id="linksPageList" class="space-y-1">
          <div class="text-sm text-gray-500 dark:text-gray-400 py-2">Loading…</div>
        </div>
      </div>
    `);

    this.loadFundraising().catch(() => {});
    this.loadWorshipPlaylist().catch(() => {});
    this.loadOrganizationLinks().catch(() => {});
  }

  // ===========================
  // Menu Page (/menu)
  // ===========================
  renderMenuPage() {
    this.setPageContent(`
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mt-4">
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-lg font-semibold text-gray-800 dark:text-white">Menu</h2>
          <button class="btn-secondary text-sm" onclick="window.churchTapApp.goToToday()">Today</button>
        </div>
        <div class="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Tools and settings.
        </div>

        <div class="mb-4 p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/20">
          <div class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            Defaults
          </div>

          <div class="space-y-3">
            <div>
              <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Bible Translation</label>
              <select id="menuDefaultTranslationSelect"
                      class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm"
                      onchange="window.churchTapApp.handleMenuDefaultTranslationChange(this.value)">
                <option value="">Loading…</option>
              </select>
              <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">Used for “View in Translation” and full chapter reading.</div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Commentary</label>
                <select id="menuDefaultCommentarySelect"
                        class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm"
                        onchange="window.churchTapApp.handleMenuDefaultCommentaryChange(this.value)">
                  <option value="">Loading…</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Dictionary</label>
                <select id="menuDefaultDictionarySelect"
                        class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm"
                        onchange="window.churchTapApp.handleMenuDefaultDictionaryChange(this.value)">
                  <option value="">Loading…</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div class="space-y-2">
          <button class="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  onclick="window.location.href='/store'">
            🛍️ Store
          </button>
        </div>

        <div id="groupSection" class="mt-6 border-t border-gray-200 dark:border-gray-700 pt-4">
          <div class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 px-1">
            Current Group
          </div>

          <div id="currentGroupDisplay" class="px-1 mb-2">
            <div class="text-sm font-medium text-gray-700 dark:text-gray-300" id="currentGroupName">Loading...</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">Tap a chip to switch quickly</div>
          </div>

          <div id="groupQuickList" class="mb-2"></div>

          <button id="changeGroupBtn" class="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  onclick="window.churchTapApp.changeGroup()">
            🔄 Switch Group
          </button>
          <button id="requestGroupBtn" class="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  onclick="window.churchTapApp.requestGroup()">
            ➕ Join a Group
          </button>
        </div>

        <div class="mt-6 border-t border-gray-200 dark:border-gray-700 pt-4 space-y-2">
          <div class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 px-1">
            Settings
          </div>

          <button class="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center justify-between"
                  onclick="window.churchTapApp.cycleTextSize(); window.churchTapApp.updateMenuIndicators();">
            <span class="flex items-center space-x-2"><span>📝</span><span>Text Size</span></span>
            <span id="textSizeIndicator" class="text-sm text-gray-500 dark:text-gray-400">Medium</span>
          </button>

          <button class="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center justify-between"
                  onclick="window.churchTapApp.toggleTheme(); window.churchTapApp.updateMenuIndicators();">
            <span class="flex items-center space-x-2"><span id="themeMenuIcon">🌙</span><span>Theme</span></span>
            <span id="themeIndicator" class="text-sm text-gray-500 dark:text-gray-400">Light</span>
          </button>

          <label class="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <span class="flex items-center space-x-2"><span>📚</span><span>Study Mode</span></span>
            <input id="studyModeMenuToggle" type="checkbox" class="h-5 w-5 accent-primary-600"
                   onchange="window.churchTapApp.handleStudyModeToggle(this.checked); window.churchTapApp.updateMenuIndicators();"
                   aria-label="Toggle Study Mode" />
          </label>

          <div id="menuInstallInsertPoint"></div>
        </div>

        <div class="mt-6 border-t border-gray-200 dark:border-gray-700 pt-4 space-y-2">
          <button id="adminPanelBtn" class="hidden w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors text-indigo-700 dark:text-indigo-300"
                  onclick="window.location.href='/admin'">
            🛠️ Admin Panel
          </button>

          <div id="tagSessionInfo" class="hidden pt-2">
            <div class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 px-1">
              NFC Session
            </div>
            <div class="px-3 py-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg mb-2">
              <div class="flex items-center justify-between">
                <div class="text-sm">
                  <span class="text-blue-600 dark:text-blue-400">🏷️</span>
                  <span class="text-gray-700 dark:text-gray-300">NFC Connected</span>
                </div>
              </div>
              <div class="hidden">
                <span id="tagSessionId">NFC Connected</span>
              </div>
            </div>
          </div>

          <button class="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  onclick="window.churchTapApp.openFeedback()">
            💬 Send Feedback
          </button>
        </div>
      </div>
    `);

    // Sync indicators + conditional items when entering the page
    this.updateMenuIndicators();
    this.updateMenuDefaultPickers();
    this.ensureStudySourcesLoaded().catch(() => {});
    this.updateGroupDisplay();
    this.updateTagSessionUI();
    this.loadFundraising().catch(() => {});
    this.loadWorshipPlaylist().catch(() => {});
    if (this.deferredPrompt) this.showInstallButton();
  }

  // ===========================
  // Menu: My Notes (/my-notes)
  // ===========================
  async renderMyNotesPage() {
    if (!this.currentUser) {
      this.renderAuthRequired('My Notes', 'Login to view your private notes.');
      return;
    }
    if (!this.membershipContext?.active_organization_id) {
      this.setPageContent(`
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mt-4">
          <div class="flex items-center justify-between mb-2">
            <h2 class="text-lg font-semibold text-gray-800 dark:text-white">My Notes</h2>
            <button class="btn-secondary text-sm" onclick="window.churchTapApp.navigate('/me')">Me</button>
          </div>
          <div class="text-sm text-gray-600 dark:text-gray-400">
            Select an active group to view your notes.
          </div>
        </div>
      `);
      return;
    }

    this.setPageContent(`
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mt-4">
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-lg font-semibold text-gray-800 dark:text-white">My Notes</h2>
          <button class="btn-secondary text-sm" onclick="window.churchTapApp.navigate('/me')">Me</button>
        </div>
        <div class="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Your private notes across daily verses and Bible reading.
        </div>

        <div class="mb-4">
          <input id="myNotesSearch"
                 type="text"
                 placeholder="Search notes…"
                 class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm" />
        </div>

        <div id="myNotesList" class="space-y-2">
          <div class="text-sm text-gray-600 dark:text-gray-400">Loading…</div>
        </div>
      </div>
    `);

    await this.loadMyNotes();

    const input = document.getElementById('myNotesSearch');
    if (input) {
      input.addEventListener('input', () => {
        const q = String(input.value || '').trim();
        this.renderMyNotesList(q);
      });
      input.focus();
    }
  }

  async loadMyNotes() {
    try {
      const res = await fetch(this.buildApiUrl('/api/me/notes?limit=500'), { credentials: 'include' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        const el = document.getElementById('myNotesList');
        if (el) el.innerHTML = `<div class="text-sm text-red-600">${this.escapeHtml(data?.error || 'Unable to load notes')}</div>`;
        this._myNotesAll = [];
        return;
      }
      this._myNotesAll = Array.isArray(data.notes) ? data.notes : [];
      this.renderMyNotesList('');
    } catch (e) {
      console.error('loadMyNotes error:', e);
      const el = document.getElementById('myNotesList');
      if (el) el.innerHTML = `<div class="text-sm text-red-600">Unable to load notes.</div>`;
      this._myNotesAll = [];
    }
  }

  renderMyNotesList(query) {
    const el = document.getElementById('myNotesList');
    if (!el) return;
    const q = String(query || '').toLowerCase();
    const notes = Array.isArray(this._myNotesAll) ? this._myNotesAll : [];

    const filtered = q
      ? notes.filter(n => {
          const body = String(n.body_markdown || '').toLowerCase();
          const ref = String(this.formatNoteReference(n) || '').toLowerCase();
          return body.includes(q) || ref.includes(q);
        })
      : notes;

    if (filtered.length === 0) {
      el.innerHTML = `<div class="text-sm text-gray-600 dark:text-gray-400">No notes found.</div>`;
      return;
    }

    el.innerHTML = filtered.map(n => {
      const ref = this.escapeHtml(this.formatNoteReference(n) || 'Verse');
      const snippetRaw = String(n.body_markdown || '').replace(/\s+/g, ' ').trim().slice(0, 160);
      const snippet = snippetRaw ? this.renderInlineMarkdown(snippetRaw) : '';
      const created = n.created_at || n.createdAt;
      const title = created ? this.escapeHtml(new Date(created).toLocaleString()) : '';
      const whenText = title;

      const actionBtn = n.kind === 'daily'
        ? `<button class="btn-secondary text-xs" onclick="window.churchTapApp.openNoteEditor(${Number(n.verse_id)}, ${Number(n.id)})">Edit</button>`
        : `<button class="btn-secondary text-xs" onclick="window.churchTapApp.openScriptureNoteEditor(${Number(n.book)}, ${Number(n.chapter)}, ${Number(n.verse)}, ${Number(n.id)})">Edit</button>`;

      const openBtn = n.kind === 'daily'
        ? `<button class="btn-secondary text-xs" onclick="window.churchTapApp.openDailyVerseFromNote('${this.escapeHtml(String(n.verse_date || ''))}')">Open</button>`
        : `<button class="btn-secondary text-xs" onclick="window.churchTapApp.readFullChapterInTranslation('${this.escapeHtml(ref)}', window.churchTapApp.getUserPreferredTranslation())">Open</button>`;

      return `
        <div class="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/30">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-xs text-gray-500 dark:text-gray-400">${ref}</div>
              ${title ? `<div class="text-sm font-semibold text-gray-900 dark:text-white mt-0.5 truncate">${title}</div>` : ''}
              ${snippet ? `<div class="text-sm text-gray-700 dark:text-gray-200 mt-1">${snippet}</div>` : ''}
              ${whenText ? `<div class="text-xs text-gray-500 dark:text-gray-400 mt-1">${whenText}</div>` : ''}
            </div>
            <div class="flex flex-col gap-2">
              ${openBtn}
              ${actionBtn}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  formatNoteReference(n) {
    if (!n || typeof n !== 'object') return '';
    if (n.kind === 'daily') return n.bible_reference || '';
    const book = Number(n.book);
    const chapter = Number(n.chapter);
    const verse = Number(n.verse);
    if (!book || !chapter || !verse) return '';
    return `${this.getBookName(book)} ${chapter}:${verse}`;
  }

  openDailyVerseFromNote(dateValue) {
    const raw = String(dateValue || '').trim();
    if (!raw) {
      this.showToast('Verse not available');
      return;
    }
    const d = raw.includes('T') ? raw.split('T')[0] : raw;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      this.showToast('Verse not available');
      return;
    }
    this.navigate(`/verse/${d}`);
  }

  // ===========================
  // Menu: My Highlights (/my-highlights)
  // ===========================
  async renderMyHighlightsPage() {
    if (!this.currentUser) {
      this.renderAuthRequired('My Highlights', 'Login to view your private highlights.');
      return;
    }
    if (!this.membershipContext?.active_organization_id) {
      this.setPageContent(`
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mt-4">
          <div class="flex items-center justify-between mb-2">
            <h2 class="text-lg font-semibold text-gray-800 dark:text-white">My Highlights</h2>
            <button class="btn-secondary text-sm" onclick="window.churchTapApp.navigate('/me')">Me</button>
          </div>
          <div class="text-sm text-gray-600 dark:text-gray-400">
            Select an active group to view your highlights.
          </div>
        </div>
      `);
      return;
    }

    this.setPageContent(`
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mt-4">
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-lg font-semibold text-gray-800 dark:text-white">My Highlights</h2>
          <button class="btn-secondary text-sm" onclick="window.churchTapApp.navigate('/me')">Me</button>
        </div>
        <div class="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Your private highlights across daily verses and Bible reading.
        </div>

        <div class="mb-4">
          <input id="myHighlightsSearch"
                 type="text"
                 placeholder="Search highlights…"
                 class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm" />
        </div>

        <div id="myHighlightsList" class="space-y-2">
          <div class="text-sm text-gray-600 dark:text-gray-400">Loading…</div>
        </div>
      </div>
    `);

    await this.loadMyHighlights();

    const input = document.getElementById('myHighlightsSearch');
    if (input) {
      input.addEventListener('input', () => {
        const q = String(input.value || '').trim();
        this.renderMyHighlightsList(q);
      });
      input.focus();
    }
  }

  async loadMyHighlights() {
    try {
      const res = await fetch(this.buildApiUrl('/api/me/highlights?limit=500'), { credentials: 'include' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        const el = document.getElementById('myHighlightsList');
        if (el) el.innerHTML = `<div class="text-sm text-red-600">${this.escapeHtml(data?.error || 'Unable to load highlights')}</div>`;
        this._myHighlightsAll = [];
        return;
      }
      this._myHighlightsAll = Array.isArray(data.highlights) ? data.highlights : [];
      this.renderMyHighlightsList('');
    } catch (e) {
      console.error('loadMyHighlights error:', e);
      const el = document.getElementById('myHighlightsList');
      if (el) el.innerHTML = `<div class="text-sm text-red-600">Unable to load highlights.</div>`;
      this._myHighlightsAll = [];
    }
  }

  renderMyHighlightsList(query) {
    const el = document.getElementById('myHighlightsList');
    if (!el) return;
    const q = String(query || '').toLowerCase();
    const items = Array.isArray(this._myHighlightsAll) ? this._myHighlightsAll : [];

    const filtered = q
      ? items.filter(h => {
          const ref = String(this.formatHighlightReference(h) || '').toLowerCase();
          return ref.includes(q);
        })
      : items;

    if (filtered.length === 0) {
      el.innerHTML = `<div class="text-sm text-gray-600 dark:text-gray-400">No highlights found.</div>`;
      return;
    }

    el.innerHTML = filtered.map(h => {
      const ref = this.escapeHtml(this.formatHighlightReference(h) || 'Verse');
      const when = h.updated_at || h.created_at;
      const whenText = when ? this.escapeHtml(new Date(when).toLocaleString()) : '';

      const swatchVar = `var(--hl-${String(h.color_key || '').trim().toLowerCase()}-bg)`;

      const openBtn = h.kind === 'daily'
        ? `<button class="btn-secondary text-xs" onclick="window.churchTapApp.openDailyVerseFromNote('${this.escapeHtml(String(h.verse_date || ''))}')">Open</button>`
        : `<button class="btn-secondary text-xs" onclick="window.churchTapApp.readFullChapterInTranslation('${this.escapeHtml(ref)}', window.churchTapApp.getUserPreferredTranslation())">Open</button>`;

      return `
        <div class="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/30">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="inline-block w-4 h-4 rounded border border-gray-300 dark:border-gray-600" style="background:${swatchVar};"></span>
                <div class="text-xs text-gray-500 dark:text-gray-400">${ref}</div>
              </div>
              ${whenText ? `<div class="text-xs text-gray-500 dark:text-gray-400 mt-1">${whenText}</div>` : ''}
            </div>
            <div class="flex flex-col gap-2">
              ${openBtn}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  formatHighlightReference(h) {
    if (!h || typeof h !== 'object') return '';
    if (h.kind === 'daily') return h.bible_reference || '';
    const book = Number(h.book);
    const chapter = Number(h.chapter);
    const verse = Number(h.verse);
    if (!book || !chapter || !verse) return '';
    return `${this.getBookName(book)} ${chapter}:${verse}`;
  }

  // ===========================
  // Study Tools Page (/study)
  // ===========================
  renderStudyPage() {
    if (!this.isStudyModeEnabled()) {
      this.setPageContent(`
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mt-4">
          <div class="flex items-center justify-between mb-2">
            <h2 class="text-lg font-semibold text-gray-800 dark:text-white">Study</h2>
            <button class="btn-secondary text-sm" onclick="window.churchTapApp.navigate('/explore')">Explore</button>
          </div>
          <div class="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Study Mode is turned off.
          </div>
          <button class="w-full btn-primary" onclick="window.churchTapApp.navigate('/menu')">Open Menu to Turn on Study Mode</button>
        </div>
      `);
      return;
    }

    const mode = (this.studyState?.mode || 'bible');
    const ref = String(this.studyState?.ref || this.currentVerse?.bible_reference || '').trim();
    const word = String(this.studyState?.word || '').trim();
    const contextValue = mode === 'dictionary' ? word : ref;
    const contextPlaceholder = mode === 'dictionary' ? 'Type a word (e.g. faith)' : 'Type a reference (e.g. John 3:16)';

    this.setPageContent(`
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-0 mt-4 overflow-hidden">
        <div class="sticky top-0 z-10 bg-white dark:bg-gray-800 backdrop-blur border-b border-gray-200 dark:border-gray-700 p-4">
          <div class="flex items-center justify-between gap-3">
            <button class="btn-secondary text-sm" onclick="window.churchTapApp.navigate('/explore')">Back</button>
            <div class="flex-1 min-w-0">
              <input id="studyContextInput"
                     value="${this.escapeHtml(contextValue)}"
                     placeholder="${this.escapeHtml(contextPlaceholder)}"
                     class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm placeholder-gray-500 dark:placeholder-gray-400" />
            </div>
            <button class="btn-secondary text-sm" onclick="window.churchTapApp.openStudyRecent()">Recent</button>
          </div>

          <div class="mt-3 flex items-center gap-2">
            <button class="study-tab-btn ${mode === 'bible' ? 'bg-primary-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'} px-3 py-2 rounded-lg text-sm transition-colors"
                    onclick="window.churchTapApp.setStudyModeTab('bible')">Bible</button>
            <button class="study-tab-btn ${mode === 'commentary' ? 'bg-primary-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'} px-3 py-2 rounded-lg text-sm transition-colors"
                    onclick="window.churchTapApp.setStudyModeTab('commentary')">Commentary</button>
            <button class="study-tab-btn ${mode === 'dictionary' ? 'bg-primary-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'} px-3 py-2 rounded-lg text-sm transition-colors"
                    onclick="window.churchTapApp.setStudyModeTab('dictionary')">Dictionary</button>
            <div class="flex-1"></div>
            <button class="btn-secondary text-sm" onclick="window.churchTapApp.runStudyLookup()">Go</button>
          </div>

          <div class="mt-3 flex items-center justify-between gap-2">
            <div class="text-xs text-gray-500 dark:text-gray-400">
              ${mode === 'bible' ? 'Translation' : 'Source'}
            </div>
            <select id="studySourceSelect"
                    class="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
                    onchange="window.churchTapApp.handleStudySourceChange(this.value)">
              <option value="">Loading…</option>
            </select>
          </div>
        </div>

        <div class="p-4">
          <div id="studyContent" class="min-h-[200px]"></div>
        </div>
      </div>

      <div id="studyRecentPanel" class="hidden fixed inset-0 z-50 bg-black/40">
        <div class="absolute right-0 top-0 h-full w-full max-w-sm bg-white dark:bg-gray-800 shadow-2xl p-4 overflow-y-auto">
          <div class="flex items-center justify-between mb-3">
            <div class="text-sm font-semibold text-gray-900 dark:text-white">Recent</div>
            <div class="flex items-center gap-2">
              <button class="btn-secondary text-sm" onclick="window.churchTapApp.clearStudyRecent()">Clear</button>
              <button class="btn-secondary text-sm" onclick="window.churchTapApp.closeStudyRecent()">Close</button>
            </div>
          </div>
          <div id="studyRecentList" class="space-y-2"></div>
        </div>
      </div>
    `);

    // Wire context input (Enter triggers lookup)
    const input = document.getElementById('studyContextInput');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.runStudyLookup();
        }
      });
    }

    // Load sources (commentary/dictionary) and populate picker options
    this.updateStudyPickerOptions();
    this.ensureStudySourcesLoaded().catch(() => {});

    // Initial content render (best effort)
    this.studyState.ref = ref;
    this.runStudyLookup().catch(() => {});
  }

  setStudyModeTab(mode) {
    const next = String(mode || '').toLowerCase();
    if (!['bible', 'commentary', 'dictionary'].includes(next)) return;
    this.studyState.mode = next;
    this.renderStudyPage();
  }

  readStudyContextInput() {
    const el = document.getElementById('studyContextInput');
    return String(el?.value || '').trim();
  }

  async runStudyLookup() {
    const mode = this.studyState?.mode || 'bible';
    const value = this.readStudyContextInput();
    if (mode === 'dictionary') {
      this.studyState.word = value;
      await this.renderStudyDictionary(value);
      return;
    }
    this.studyState.ref = value;
    if (mode === 'commentary') {
      await this.renderStudyCommentary(value);
      return;
    }
    await this.renderStudyBible(value);
  }

  openStudyRecent() {
    this.renderStudyRecentList();
    document.getElementById('studyRecentPanel')?.classList.remove('hidden');
  }

  closeStudyRecent() {
    document.getElementById('studyRecentPanel')?.classList.add('hidden');
  }

  renderStudyRecentList() {
    const list = document.getElementById('studyRecentList');
    if (!list) return;
    const items = Array.isArray(this.studyState?.recent) ? this.studyState.recent : [];
    if (items.length === 0) {
      list.innerHTML = `<div class="text-sm text-gray-600 dark:text-gray-400">No recent study items yet.</div>`;
      return;
    }
    list.innerHTML = items.map((it, idx) => {
      const type = this.escapeHtml(it.type || '');
      const label = this.escapeHtml(it.label || '');
      const when = this.escapeHtml(it.whenLabel || '');
      const icon = type === 'Bible' ? '📖' : (type === 'Commentary' ? '📝' : (type === 'Dictionary' ? '📚' : '🧠'));
      return `
        <button class="w-full text-left p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                onclick="window.churchTapApp.restoreStudyRecent(${idx})">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-sm font-medium text-gray-900 dark:text-white truncate">${icon} ${label}</div>
              <div class="text-xs text-gray-500 dark:text-gray-400">${type}${when ? ` • ${when}` : ''}</div>
            </div>
            <div class="text-gray-400">›</div>
          </div>
        </button>
      `;
    }).join('');
  }

  restoreStudyRecent(index) {
    const items = Array.isArray(this.studyState?.recent) ? this.studyState.recent : [];
    const it = items[index];
    if (!it) return;
    this.studyState.mode = it.mode || this.studyState.mode;
    if (it.ref) this.studyState.ref = it.ref;
    if (it.word) this.studyState.word = it.word;
    if (it.translation) {
      this.studyState.translation = String(it.translation).toUpperCase();
    }
    this.closeStudyRecent();
    this.renderStudyPage();
  }

  clearStudyRecent() {
    this.studyState.recent = [];
    this.saveStudyRecent([]);
    this.renderStudyRecentList();
  }

  // --- Study content renderers ---
  setStudyContent(html) {
    const el = document.getElementById('studyContent');
    if (!el) return;
    el.innerHTML = html;
  }

  pushStudyRecent(entry) {
    const e = entry && typeof entry === 'object' ? entry : {};
    const type = String(e.type || '').trim();
    const key = String(e.key || '').trim();
    if (!type || !key) return;

    const items = Array.isArray(this.studyState?.recent) ? this.studyState.recent.slice() : [];
    const deduped = items.filter(x => !(x && x.type === type && x.key === key));
    const now = new Date();
    const whenLabel = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    deduped.unshift({
      type,
      key,
      label: String(e.label || key),
      mode: e.mode || this.studyState.mode,
      ref: e.ref || null,
      word: e.word || null,
      translation: e.translation || null,
      when: now.toISOString(),
      whenLabel
    });

    this.studyState.recent = deduped.slice(0, 20);
    this.saveStudyRecent(this.studyState.recent);
  }

  // Bible tab: show verse text for reference. Uses bolls.life directly (same as other Bible helpers).
  async renderStudyBible(reference) {
    const ref = String(reference || '').trim();
    if (!ref) {
      this.setStudyContent(`<div class="text-sm text-gray-600 dark:text-gray-400">Enter a Bible reference to begin.</div>`);
      return;
    }

    const parsed = this.parseBibleReference(ref);
    if (!parsed) {
      this.setStudyContent(`<div class="text-sm text-gray-600 dark:text-gray-400">Could not parse reference. Try “John 3:16”.</div>`);
      return;
    }

    const translation = String(this.studyState?.translation || this.getUserPreferredTranslation() || 'NASB').toUpperCase();
    this.studyState.translation = translation;

    this.setStudyContent(`<div class="text-sm text-gray-600 dark:text-gray-400">Loading Bible text…</div>`);
    try {
      const bollsTranslation = this.getBollsTranslationId(translation);
      const apiUrl = `https://bolls.life/get-verse/${bollsTranslation}/${parsed.book}/${parsed.chapter}/${parsed.verse}/`;
      const response = await fetch(apiUrl);
      if (!response.ok) throw new Error(`Bible fetch failed: ${response.status}`);
      const data = await response.json();

      const text = this.escapeHtml(String(data.text || data.verse_text || data.content || '')).replace(/\n/g, '<br>');
      const safeRef = this.escapeHtml(ref);

      this.setStudyContent(`
        <div class="space-y-3">
          <div class="text-sm font-semibold text-primary-600 dark:text-primary-400">${safeRef}</div>
          <blockquote id="studyBibleText" class="verse-text text-gray-800 dark:text-gray-200 leading-relaxed border-l-4 border-primary-500 pl-4 size-${this.textSize}">
            ${text || '<span class="text-gray-600 dark:text-gray-400">Verse text not available.</span>'}
          </blockquote>
          <div class="text-xs text-gray-500 dark:text-gray-400">${this.escapeHtml(translation)}</div>
          <div id="studyDefineChipHost"></div>
        </div>
      `);

      // Track recent
      this.pushStudyRecent({
        type: 'Bible',
        key: `bible:${ref}:${translation}`,
        label: `Bible • ${ref} (${translation})`,
        mode: 'bible',
        translation,
        ref
      });

      // Attach define affordance (Option A UX): show chip, switch to Dictionary on confirm
      const verseEl = document.getElementById('studyBibleText');
      if (verseEl) this.attachStudyDefineAffordance(verseEl);
    } catch (e) {
      this.setStudyContent(`<div class="text-sm text-gray-600 dark:text-gray-400">Unable to load Bible text.</div>`);
    }
  }

  attachStudyDefineAffordance(containerEl) {
    if (!containerEl || !containerEl.addEventListener) return;
    if (containerEl.dataset && containerEl.dataset.studyDefine === '1') return;
    if (containerEl.dataset) containerEl.dataset.studyDefine = '1';

    const clearChip = () => {
      const host = document.getElementById('studyDefineChipHost');
      if (host) host.innerHTML = '';
    };

    const showChip = (word) => {
      const host = document.getElementById('studyDefineChipHost');
      if (!host) return;
      const safe = this.escapeHtml(word);
      host.innerHTML = `
          <div class="mt-3 inline-flex items-center gap-2 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 shadow-sm">
          <span class="text-xs text-gray-700 dark:text-gray-200">Define “${safe}”</span>
          <button class="text-xs px-2 py-1 rounded-full bg-primary-600 hover:bg-primary-700 text-white"
                  onclick="window.churchTapApp.studyDefineSelectedWord('${safe}')">Define</button>
          <button class="text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200"
                  onclick="window.churchTapApp.clearStudyDefineChip()">Cancel</button>
        </div>
      `;
    };

    containerEl.addEventListener('mouseup', () => {
      const word = this.getSelectedSingleWord();
      if (!word) return clearChip();
      showChip(word);
    });
    containerEl.addEventListener('touchend', () => {
      const word = this.getSelectedSingleWord();
      if (!word) return clearChip();
      showChip(word);
    });

    // dismiss chip on scroll/tap elsewhere
    const dismissOnScroll = () => clearChip();
    containerEl.addEventListener('scroll', dismissOnScroll, { passive: true });
  }

  clearStudyDefineChip() {
    const host = document.getElementById('studyDefineChipHost');
    if (host) host.innerHTML = '';
  }

  studyDefineSelectedWord(word) {
    const w = String(word || '').trim();
    if (!w) return;
    this.studyState.word = w;
    this.studyState.mode = 'dictionary';
    this.renderStudyPage();
  }

  async renderStudyCommentary(reference) {
    const ref = String(reference || '').trim();
    if (!ref) {
      this.setStudyContent(`<div class="text-sm text-gray-600 dark:text-gray-400">Enter a Bible reference to load commentary.</div>`);
      return;
    }
    this.setStudyContent(`<div class="text-sm text-gray-600 dark:text-gray-400">Loading commentary…</div>`);
    try {
      const sourceKey = String(this.studyState?.commentarySourceKey || '').trim();
      const sourceParam = sourceKey ? `&source=${encodeURIComponent(sourceKey)}` : '';
      const res = await fetch(this.buildApiUrl(`/api/commentary/lookup?ref=${encodeURIComponent(ref)}${sourceParam}`), { credentials: 'include' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        const msg = this.escapeHtml(data?.error || 'Commentary unavailable');
        this.setStudyContent(`<div class="text-sm text-gray-600 dark:text-gray-400">${msg}</div>`);
        return;
      }

      const entry = data.entry;
      if (!entry) {
        this.setStudyContent(`<div class="text-sm text-gray-600 dark:text-gray-400">No commentary found for ${this.escapeHtml(ref)}.</div>`);
        return;
      }

      const title = this.escapeHtml(entry.reference || ref);
      const bodyHtml = this.sanitizeImportedHtml(entry.content || '');
      const source = this.escapeHtml(entry.source_name || '');
      const chosen = sourceKey ? this.escapeHtml(sourceKey) : '';

      this.setStudyContent(`
        <div class="space-y-3">
          <div class="text-sm font-semibold text-gray-900 dark:text-white">${title}</div>
          <div class="text-sm text-gray-800 dark:text-gray-200 leading-relaxed space-y-2">
            ${bodyHtml || '<div class="text-gray-600 dark:text-gray-400">No content.</div>'}
          </div>
          ${source ? `<div class="text-xs text-gray-500 dark:text-gray-400">Source: ${source}${chosen && !source.includes(chosen) ? ` (${chosen})` : ''}</div>` : ''}
        </div>
      `);

      this.pushStudyRecent({
        type: 'Commentary',
        key: `commentary:${ref}:${sourceKey || 'auto'}`,
        label: `Commentary • ${ref}${source ? ` (${source})` : ''}`,
        mode: 'commentary',
        ref
      });
    } catch (e) {
      this.setStudyContent(`<div class="text-sm text-gray-600 dark:text-gray-400">Commentary unavailable.</div>`);
    }
  }

  async renderStudyDictionary(term) {
    const q = String(term || '').trim();
    if (!q) {
      this.setStudyContent(`<div class="text-sm text-gray-600 dark:text-gray-400">Type a word to look up.</div>`);
      return;
    }
    this.setStudyContent(`<div class="text-sm text-gray-600 dark:text-gray-400">Loading dictionary…</div>`);
    try {
      const sourceKey = String(this.studyState?.dictionarySourceKey || '').trim();
      const sourceParam = sourceKey ? `&source=${encodeURIComponent(sourceKey)}` : '';
      const res = await fetch(this.buildApiUrl(`/api/dictionary/lookup?term=${encodeURIComponent(q)}${sourceParam}`), { credentials: 'include' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        const msg = this.escapeHtml(data?.error || 'Dictionary unavailable');
        this.setStudyContent(`<div class="text-sm text-gray-600 dark:text-gray-400">${msg}</div>`);
        return;
      }

      const entry = data.entry;
      if (!entry) {
        this.setStudyContent(`<div class="text-sm text-gray-600 dark:text-gray-400">No dictionary entry found for “${this.escapeHtml(q)}”.</div>`);
        return;
      }

      const headword = this.escapeHtml(entry.headword || q);
      const bodyHtml = this.sanitizeImportedHtml(entry.definition || '');
      const source = this.escapeHtml(entry.source_name || '');
      const chosen = sourceKey ? this.escapeHtml(sourceKey) : '';

      this.setStudyContent(`
        <div class="space-y-3">
          <div class="text-sm font-semibold text-gray-900 dark:text-white">${headword}</div>
          <div class="text-sm text-gray-800 dark:text-gray-200 leading-relaxed space-y-2">
            ${bodyHtml || '<div class="text-gray-600 dark:text-gray-400">No content.</div>'}
          </div>
          ${source ? `<div class="text-xs text-gray-500 dark:text-gray-400">Source: ${source}${chosen && !source.includes(chosen) ? ` (${chosen})` : ''}</div>` : ''}
        </div>
      `);

      this.pushStudyRecent({
        type: 'Dictionary',
        key: `dictionary:${q.toLowerCase()}:${sourceKey || 'auto'}`,
        label: `Dictionary • ${q}${source ? ` (${source})` : ''}`,
        mode: 'dictionary',
        word: q
      });
    } catch (e) {
      this.setStudyContent(`<div class="text-sm text-gray-600 dark:text-gray-400">Dictionary unavailable.</div>`);
    }
  }

  updateCommunityPreview() {
    // No-op: preview removed; community renders inline on Today
  }

  updateCommunityPreviewLocked(reason) {
    // No-op: preview removed; community renders inline on Today
  }

  setPageContent(html) {
    const pageContainer = document.getElementById('pageContainer');
    const inner = pageContainer?.querySelector('.max-w-lg');
    if (!inner) return;
    inner.innerHTML = html;
  }

  renderAuthRequired(title, message) {
    this.setPageContent(`
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mt-4">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-gray-800 dark:text-white">${this.escapeHtml(title)}</h2>
          <button class="btn-secondary text-sm" onclick="window.churchTapApp.navigate('/')">Back</button>
        </div>
        <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">${this.escapeHtml(message)}</p>
        <div class="space-y-2">
          <button class="w-full btn-primary" onclick="window.churchTapApp.showLoginModal()">Login / Create Account</button>
          <button class="w-full btn-secondary" onclick="window.location.href='/choose-organization'">Choose Group</button>
        </div>
      </div>
    `);
  }

  async renderFavoritesPage() {
    if (!this.currentUser) {
      this.renderAuthRequired('My Favorites', 'Login to sync your favorite verses across devices.');
      return;
    }

    this.setPageContent(`
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mt-4">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-gray-800 dark:text-white">My Favorites</h2>
          <button class="btn-secondary text-sm" onclick="window.churchTapApp.navigate('/')">Back</button>
        </div>
        <div class="text-sm text-gray-600 dark:text-gray-400">Loading…</div>
      </div>
    `);

    try {
      const res = await fetch(this.buildApiUrl('/api/favorites'), { credentials: 'include' });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        const msg = data?.error || 'Unable to load favorites.';
        this.renderAuthRequired('My Favorites', msg);
        return;
      }

      const favorites = Array.isArray(data.favorites) ? data.favorites : [];
      const rows = favorites.length
        ? favorites.map(v => {
            const ref = this.escapeHtml(v.bible_reference || 'Bible');
            const dateKey = this.escapeHtml(this.normalizeDateKey(v.date));
            const dateLabel = this.escapeHtml(this.formatDisplayDate(v.date) || dateKey);
            const previewText = v.verse_text ? this.plainTextFromVerseText(v.verse_text) : '';
            const preview = previewText ? this.escapeHtml(previewText.slice(0, 120)) : '';
            return `
              <div class="p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <div class="flex items-start justify-between space-x-3">
                  <button class="text-left flex-1" onclick="window.churchTapApp.navigate('/verse/${dateKey}')">
                    <div class="font-medium text-primary-600 dark:text-primary-400">${ref}</div>
                    <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">${dateLabel}</div>
                    ${preview ? `<div class="text-sm text-gray-700 dark:text-gray-200 mt-2">${preview}${previewText.length > 120 ? '…' : ''}</div>` : ''}
                  </button>
                  <button class="btn-secondary text-xs" onclick="window.churchTapApp.toggleFavoriteById(${Number(v.id)})">Remove</button>
                </div>
              </div>
            `;
          }).join('')
        : `<div class="text-sm text-gray-600 dark:text-gray-400">No favorites yet. Tap “Save” on a verse to add one.</div>`;

      this.setPageContent(`
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mt-4">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-semibold text-gray-800 dark:text-white">My Favorites</h2>
            <button class="btn-secondary text-sm" onclick="window.churchTapApp.navigate('/')">Back</button>
          </div>
          <div class="space-y-3">${rows}</div>
        </div>
      `);
    } catch (e) {
      console.error('Favorites page error:', e);
      this.renderAuthRequired('My Favorites', 'Unable to load favorites.');
    }
  }

  async renderCollectionsPage() {
    if (!this.currentUser) {
      this.renderAuthRequired('My Categories', 'Login to create categories synced across devices.');
      return;
    }

    this.setPageContent(`
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mt-4">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-gray-800 dark:text-white">My Categories</h2>
          <div class="flex items-center gap-2">
            <button class="btn-secondary text-sm" onclick="window.churchTapApp.navigate('/')">Back</button>
            <button class="btn-secondary text-sm" onclick="window.churchTapApp.showCreateCollectionModal()" aria-label="Create category">+</button>
          </div>
        </div>
        <div class="text-sm text-gray-600 dark:text-gray-400">Loading…</div>
      </div>
    `);

    try {
      const res = await fetch(this.buildApiUrl('/api/collections'), { credentials: 'include' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        const msg = data?.error || 'Unable to load collections.';
        this.renderAuthRequired('My Categories', msg);
        return;
      }

      const collections = Array.isArray(data.collections) ? data.collections : [];
      const listHtml = collections.length
        ? collections.map(c => {
            const name = this.escapeHtml(c.name || 'Untitled');
            const desc = this.escapeHtml(c.description || '');
            return `
              <div class="p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <button class="w-full text-left" onclick="window.churchTapApp.navigate('/collections/${Number(c.id)}')">
                  <div class="font-medium text-gray-900 dark:text-white">${name}</div>
                  ${desc ? `<div class="text-sm text-gray-600 dark:text-gray-400 mt-1">${desc}</div>` : ''}
                </button>
              </div>
            `;
          }).join('')
        : `<div class="text-sm text-gray-600 dark:text-gray-400">No categories yet. Tap “+” to add one.</div>`;

      this.setPageContent(`
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mt-4">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-semibold text-gray-800 dark:text-white">My Categories</h2>
            <div class="flex items-center gap-2">
              <button class="btn-secondary text-sm" onclick="window.churchTapApp.navigate('/')">Back</button>
              <button class="btn-secondary text-sm" onclick="window.churchTapApp.showCreateCollectionModal()" aria-label="Create category">+</button>
            </div>
          </div>

          <div class="space-y-3">${listHtml}</div>
        </div>
      `);
    } catch (e) {
      console.error('Collections page error:', e);
      this.renderAuthRequired('My Categories', 'Unable to load categories.');
    }
  }

  showCreateCollectionModal() {
    if (!this.currentUser) {
      this.showToast('Please login to create categories');
      this.showLoginModal();
      return;
    }

    this.showModal('New Category', `
      <form id="createCollectionModalForm" class="space-y-3">
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
          <input id="collectionNameModal" type="text"
                 class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                 placeholder="e.g., Trials, Peace, Gratitude"
                 required>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description (optional)</label>
          <input id="collectionDescModal" type="text"
                 class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                 placeholder="A short note about what belongs here">
        </div>
        <div class="flex gap-2 pt-2">
          <button type="submit" class="btn-primary flex-1">Create</button>
          <button type="button" class="btn-secondary" onclick="window.churchTapApp.closeModal()">Cancel</button>
        </div>
      </form>
    `);

    const form = document.getElementById('createCollectionModalForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('collectionNameModal')?.value;
      const description = document.getElementById('collectionDescModal')?.value;
      this.closeModal();
      await this.createCollection(name, description);
    });
  }

  async renderCollectionDetailPage(collectionId) {
    if (!this.currentUser) {
      this.renderAuthRequired('Collection', 'Login to view your collections.');
      return;
    }

    this.setPageContent(`
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mt-4">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-gray-800 dark:text-white">Collection</h2>
          <button class="btn-secondary text-sm" onclick="window.churchTapApp.navigate('/collections')">Back</button>
        </div>
        <div class="text-sm text-gray-600 dark:text-gray-400">Loading…</div>
      </div>
    `);

    try {
      const res = await fetch(this.buildApiUrl(`/api/collections/${collectionId}`), { credentials: 'include' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        const msg = data?.error || 'Unable to load collection.';
        this.renderAuthRequired('Collection', msg);
        return;
      }

      const collection = data.collection;
      const verses = Array.isArray(data.verses) ? data.verses : [];
      const name = this.escapeHtml(collection?.name || 'Collection');
      const desc = this.escapeHtml(collection?.description || '');

      const addCurrentBtn = this.currentVerse?.id
        ? `<button class="btn-primary text-sm" onclick="window.churchTapApp.addCurrentVerseToCollection(${collectionId})">Add current verse</button>`
        : '';

      const rows = verses.length
        ? verses.map(v => {
            const ref = this.escapeHtml(v.bible_reference || 'Bible');
            const dateKey = this.escapeHtml(this.normalizeDateKey(v.date));
            const dateLabel = this.escapeHtml(this.formatDisplayDate(v.date) || dateKey);
            const previewText = v.verse_text ? this.plainTextFromVerseText(v.verse_text) : '';
            const preview = previewText ? this.escapeHtml(previewText.slice(0, 120)) : '';
            return `
              <div class="p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <div class="flex items-start justify-between space-x-3">
                  <button class="text-left flex-1" onclick="window.churchTapApp.navigate('/verse/${dateKey}')">
                    <div class="font-medium text-primary-600 dark:text-primary-400">${ref}</div>
                    <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">${dateLabel}</div>
                    ${preview ? `<div class="text-sm text-gray-700 dark:text-gray-200 mt-2">${preview}${previewText.length > 120 ? '…' : ''}</div>` : ''}
                  </button>
                  <button class="btn-secondary text-xs" onclick="window.churchTapApp.removeVerseFromCollection(${collectionId}, ${Number(v.id)})">Remove</button>
                </div>
              </div>
            `;
          }).join('')
        : `<div class="text-sm text-gray-600 dark:text-gray-400">No verses yet. Add one from the verse screen.</div>`;

      this.setPageContent(`
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mt-4">
          <div class="flex items-center justify-between mb-2">
            <h2 class="text-lg font-semibold text-gray-800 dark:text-white">${name}</h2>
            <button class="btn-secondary text-sm" onclick="window.churchTapApp.navigate('/collections')">Back</button>
          </div>
          ${desc ? `<div class="text-sm text-gray-600 dark:text-gray-400 mb-4">${desc}</div>` : '<div class="mb-4"></div>'}

          ${addCurrentBtn ? `<div class="mb-4">${addCurrentBtn}</div>` : ''}

          <div class="space-y-3">${rows}</div>

          <div class="border-t border-gray-200 dark:border-gray-700 pt-4 mt-6">
            <button class="w-full text-red-600 dark:text-red-400 font-medium" onclick="window.churchTapApp.deleteCollection(${collectionId})">Delete collection</button>
          </div>
        </div>
      `);
    } catch (e) {
      console.error('Collection detail error:', e);
      this.renderAuthRequired('Collection', 'Unable to load collection.');
    }
  }

  async renderMyPrayersPage() {
    if (!this.currentUser) {
      this.renderAuthRequired('My Prayers', 'Login to keep your prayer journal synced across devices.');
      return;
    }

    this.setPageContent(`
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mt-4">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-gray-800 dark:text-white">My Prayers</h2>
          <button class="btn-secondary text-sm" onclick="window.churchTapApp.navigate('/')">Back</button>
        </div>
        <div class="text-sm text-gray-600 dark:text-gray-400">Loading…</div>
      </div>
    `);

    try {
      const res = await fetch(this.buildApiUrl('/api/personal-prayers'), { credentials: 'include' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        const msg = data?.error || 'Unable to load prayers.';
        this.renderAuthRequired('My Prayers', msg);
        return;
      }

      const prayers = Array.isArray(data.prayers) ? data.prayers : [];
      const rows = prayers.length
        ? prayers.map(p => {
            const id = Number(p.id);
            const content = this.escapeHtml(p.content || '');
            const created = this.escapeHtml(String(p.created_at || ''));
            const checked = p.is_answered ? 'checked' : '';
            return `
              <div class="p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
                <div class="flex items-start justify-between space-x-3">
                  <div class="flex-1">
                    <div class="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">${content}</div>
                    <div class="text-xs text-gray-500 dark:text-gray-400 mt-2">${created}</div>
                    <label class="mt-3 inline-flex items-center space-x-2 text-sm text-gray-700 dark:text-gray-300">
                      <input type="checkbox" ${checked} onchange="window.churchTapApp.setPrayerAnswered(${id}, this.checked)">
                      <span>Answered</span>
                    </label>
                  </div>
                  <button class="btn-secondary text-xs" onclick="window.churchTapApp.deletePersonalPrayer(${id})">Delete</button>
                </div>
              </div>
            `;
          }).join('')
        : `<div class="text-sm text-gray-600 dark:text-gray-400">No prayers yet. Add one below.</div>`;

      this.setPageContent(`
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mt-4">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-semibold text-gray-800 dark:text-white">My Prayers</h2>
            <button class="btn-secondary text-sm" onclick="window.churchTapApp.navigate('/')">Back</button>
          </div>

          <div class="space-y-3 mb-6">${rows}</div>

          <div class="border-t border-gray-200 dark:border-gray-700 pt-4">
            <h3 class="text-sm font-semibold text-gray-800 dark:text-white mb-2">Add a prayer</h3>
            <form id="createPrayerForm" class="space-y-2">
              <textarea id="prayerText" class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" placeholder="Write a prayer…" rows="4" required></textarea>
              <button type="submit" class="w-full btn-primary">Add</button>
            </form>
          </div>
        </div>
      `);

      const form = document.getElementById('createPrayerForm');
      if (form) {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const content = document.getElementById('prayerText')?.value;
          await this.createPersonalPrayer(content);
        });
      }
    } catch (e) {
      console.error('My prayers page error:', e);
      this.renderAuthRequired('My Prayers', 'Unable to load prayers.');
    }
  }

  escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  normalizeVerseText(text) {
    if (!text || typeof text !== 'string') return '';
    return text
      .replace(/\r\n/g, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  plainTextFromVerseText(text) {
    const normalized = this.normalizeVerseText(text);
    return normalized.replace(/\s+/g, ' ').trim();
  }

  getDisplayTags(tagsString) {
    if (!tagsString || typeof tagsString !== 'string') return [];
    const hidden = new Set(['auto-import', 'auto_import', 'autoimport', 'auto imported', 'autoimported']);
    return tagsString
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)
      .filter(t => !hidden.has(t.toLowerCase()));
  }

  shouldHideContext(context) {
    if (!context || typeof context !== 'string') return true;
    const c = context.trim();
    if (!c) return true;
    return /^Daily verse automatically imported from\s+/i.test(c);
  }

  async fetchMembershipContext() {
    try {
      const response = await fetch('/api/memberships', { credentials: 'include' });
      if (!response.ok) return null;
      const data = await response.json();
      if (!data.success) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  async fetchAdminOrganizations() {
    try {
      const response = await fetch('/api/user/admin-organizations', { credentials: 'include' });
      if (!response.ok) return { organizations: [] };
      const data = await response.json();
      if (!data.success) return { organizations: [] };
      return data;
    } catch (e) {
      return { organizations: [] };
    }
  }

  // Build URL with org subdomain hint and extra query params
  withOrg(path, extraParams = {}) {
    // For API calls, use relative URLs so they go to the same server serving the page
    if (path.startsWith('/api/')) {
      // Use URLSearchParams for relative URLs to avoid origin issues
      const params = new URLSearchParams();
      // If logged in, org context is derived server-side from active_organization_id.
      if (this.orgParam && !(this.currentUser && this.membershipContext?.active_organization_id)) {
        params.set('org', this.orgParam);
      }
      Object.keys(extraParams || {}).forEach(k => {
        if (extraParams[k] !== undefined && extraParams[k] !== null) {
          params.set(k, extraParams[k]);
        }
      });
      const queryString = params.toString();
      return queryString ? `${path}?${queryString}` : path;
    }
    
    // For non-API paths, use the original logic
    const url = new URL(path, window.location.origin);
    if (this.orgParam) url.searchParams.set('org', this.orgParam);
    Object.keys(extraParams || {}).forEach(k => {
      if (extraParams[k] !== undefined && extraParams[k] !== null) {
        url.searchParams.set(k, extraParams[k]);
      }
    });
    return url.toString();
  }

  setupEventListeners() {
    // Helper: safely attach event listeners (prevents hard crashes if markup is missing / cached)
    const on = (id, eventName, handler) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener(eventName, handler);
    };

    // Theme toggle (now in menu)
    on('themeMenuBtn', 'click', () => {
      this.toggleTheme();
      this.updateMenuIndicators();
    });

    // Text size toggle (now in menu)
    on('textSizeMenuBtn', 'click', () => {
      this.cycleTextSize();
      this.updateMenuIndicators();
    });

    // Study mode toggle (now in menu)
    on('studyModeMenuToggle', 'change', (e) => {
      const checked = !!e?.target?.checked;
      this.handleStudyModeToggle(checked);
      this.updateMenuIndicators();
    });

    // Store
    const storeBtn = document.getElementById('storeBtn');
    if (storeBtn) {
      storeBtn.addEventListener('click', () => {
        window.location.href = '/store';
      });
    }

    // Day navigation is swipe-based (arrows removed from UI)

    // Bottom tab navigation (mobile-first)
    on('tabTodayBtn', 'click', () => this.goToToday());
    on('tabExploreBtn', 'click', () => this.navigate('/explore'));
    on('tabLinksBtn', 'click', () => this.navigate('/links'));
    on('tabMeBtn', 'click', () => this.navigate('/me'));

    on('backToToday', 'click', () => {
      this.goToToday();
    });

    // Menu toggle
    on('menuToggle', 'click', () => this.navigate('/menu'));

    // Calendar controls
    on('datePickerBtn', 'click', () => this.openCalendarModal());
    const closeCalendarBtn = document.getElementById('closeCalendarBtn');
    if (closeCalendarBtn) {
      closeCalendarBtn.addEventListener('click', () => this.closeCalendarModal());
    }
    const prevMonthBtn = document.getElementById('prevMonthBtn');
    if (prevMonthBtn) {
      prevMonthBtn.addEventListener('click', () => this.shiftCalendarMonth(-1));
    }
    const nextMonthBtn = document.getElementById('nextMonthBtn');
    if (nextMonthBtn) {
      nextMonthBtn.addEventListener('click', () => this.shiftCalendarMonth(1));
    }

    // Clear tag session
    on('clearTagSessionBtn', 'click', () => {
      this.clearTagSession();
    });

    // Change Group button
    on('changeGroupBtn', 'click', () => {
      this.changeGroup();
    });

    // Request a Group button
    on('requestGroupBtn', 'click', () => {
      this.requestGroup();
    });

    // Admin panel button (conditionally visible)
    const adminPanelBtn = document.getElementById('adminPanelBtn');
    if (adminPanelBtn) {
      adminPanelBtn.addEventListener('click', () => {
        window.location.href = '/admin';
        this.hideQuickMenu();
      });
    }

    // Main action buttons
    on('randomVerseBtn', 'click', () => {
      this.showRandomVerse();
    });

    on('topicsBtn', 'click', () => {
      // If flags haven't loaded yet, fail-open (we'll still try).
      if (this.orgFeatures && !this.isFeatureEnabled('topics_enabled')) {
        this.showToast('Topics are disabled for this group', 'info');
        return;
      }
      this.showTopicsWordCloud();
    });

    on('shareBtn', 'click', () => {
      this.shareVerse();
    });

    // "Download Image" menu item removed for now; keep handler optional.
    const downloadBtn = document.getElementById('downloadBtn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => {
        this.downloadVerseImage();
      });
    }

    on('searchBtn', 'click', () => {
      this.showVerseSearchModal();
      this.toggleQuickMenu();
    });

    const fundraisingCard = document.getElementById('fundraisingCard');
    if (fundraisingCard) {
      fundraisingCard.addEventListener('click', () => {
        this.openFundraisingModal();
        this.toggleQuickMenu();
      });
    }

    const playlistBtn = document.getElementById('playlistBtn');
    if (playlistBtn) {
      playlistBtn.addEventListener('click', () => {
        this.openPlaylistModal();
        this.toggleQuickMenu();
      });
    }

    on('feedbackBtn', 'click', () => this.openFeedback());

    // Engagement actions
    on('heartBtn', 'click', () => this.toggleHeart());
    on('favoriteBtn', 'click', () => this.toggleFavorite());

    const addToCollectionBtn = document.getElementById('addToCollectionBtn');
    if (addToCollectionBtn) {
      addToCollectionBtn.addEventListener('click', () => {
        this.showAddToCollectionModal();
      });
    }

    // Note: Notes + Highlights live under the Me tab now.


    // Community event listeners
    const submitPrayerBtn = document.getElementById('submitPrayerBtn');
    if (submitPrayerBtn) {
      submitPrayerBtn.addEventListener('click', () => {
        this.showPrayerRequestModal();
      });
    }

    const submitPraiseBtn = document.getElementById('submitPraiseBtn');
    if (submitPraiseBtn) {
      submitPraiseBtn.addEventListener('click', () => {
        this.showPraiseReportModal();
      });
    }

    const submitInsightBtn = document.getElementById('submitInsightBtn');
    if (submitInsightBtn) {
      submitInsightBtn.addEventListener('click', () => {
        this.showVerseInsightModal();
      });
    }

    // Authentication event listeners (now in menu)
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
      loginBtn.addEventListener('click', () => {
        this.showLoginModal();
      });
    }

    // Note: account/auth actions live under the Me tab now.

    // Community preview (Today tab)
    on('openCommunityFromPreview', 'click', () => {
      this.navigate('/community');
    });

    // Note: Menu + Links are full pages now (no popover close-on-outside-click needed).

    // Keyboard shortcuts removed (typing should never trigger app actions).

    // Double tap to favorite
    let lastTap = 0;
    document.getElementById('verseContainer').addEventListener('touchstart', (e) => {
      const currentTime = new Date().getTime();
      const tapLength = currentTime - lastTap;
      if (tapLength < 500 && tapLength > 0) {
        this.toggleFavorite();
        this.showToast('❤️ Added to favorites!');
      }
      lastTap = currentTime;
    });

    // Long press for quick share
    let pressTimer;
    document.getElementById('verseContainer').addEventListener('touchstart', (e) => {
      pressTimer = setTimeout(() => {
        navigator.vibrate && navigator.vibrate(50);
        this.shareVerse();
      }, 800);
    });

    document.getElementById('verseContainer').addEventListener('touchend', () => {
      clearTimeout(pressTimer);
    });

    document.getElementById('verseContainer').addEventListener('touchmove', () => {
      clearTimeout(pressTimer);
    });
  }

  setupSwipeGestures() {
    let startX = 0;
    let startY = 0;
    
    document.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    });

    document.addEventListener('touchmove', (e) => {
      if (!startX || !startY) return;
      
      const diffX = startX - e.touches[0].clientX;
      const diffY = startY - e.touches[0].clientY;
      
      // Only trigger swipes if movement is significant and deliberate
      const minSwipeDistance = 80;
      const maxScrollThreshold = 200; // Ignore if too much movement (likely scrolling)
      
      if (Math.abs(diffX) > Math.abs(diffY)) {
        // Horizontal swipe for navigation
        if (Math.abs(diffX) > minSwipeDistance && Math.abs(diffY) < maxScrollThreshold) {
          if (diffX > 0) {
            // Swipe left - next day
            this.navigateDay(1);
          } else {
            // Swipe right - previous day
            this.navigateDay(-1);
          }
          startX = 0;
          startY = 0;
        }
      } else {
        // Disable vertical swipe text resize to prevent conflict with scrolling
        // Text size can still be changed with the button
        // if (Math.abs(diffY) > minSwipeDistance && Math.abs(diffX) < 50) {
        //   if (diffY > 0) {
        //     // Swipe up - increase text size
        //     this.cycleTextSize();
        //   } else {
        //     // Swipe down - decrease text size
        //     this.cycleTextSize(true);
        //   }
        //   startX = 0;
        //   startY = 0;
        // }
      }
    });

    // Refresh gesture
    let startPoint = 0;
    let pulling = false;
    
    document.addEventListener('touchstart', (e) => {
      if (window.scrollY === 0) {
        startPoint = e.touches[0].clientY;
        pulling = false;
      }
    });

    document.addEventListener('touchmove', (e) => {
      if (window.scrollY === 0 && startPoint) {
        const diff = e.touches[0].clientY - startPoint;
        if (diff > 100 && !pulling) {
          pulling = true;
          navigator.vibrate && navigator.vibrate(25);
          this.refreshVerse();
        }
      }
    });
  }

  async loadVerse(date) {
    try {
      this.showLoading();
      
      // Set a timeout to ensure loading state is cleared
      const timeoutId = setTimeout(() => {
        console.warn('Verse loading timeout - showing offline message');
        this.showOfflineMessage();
      }, 10000); // 10 second timeout
      
      const response = await fetch(this.buildApiUrl(`/api/verse/${date}`));
      const data = await response.json();
      
      clearTimeout(timeoutId); // Clear timeout if request succeeds
      
      if (data.success && data.verse) {
        this.currentVerse = data.verse;
        this.displayVerse(data.verse);
        this.updateEngagementState();
        this.trackAnalytics('verse_view', data.verse.id);
        this.addToRecentlyViewed(data.verse);
      } else {
        this.showNoVerse();
      }
      
      this.updateDateDisplay(date);
    } catch (error) {
      console.error('Error loading verse:', error);
      this.showOfflineMessage();
    }
  }

  displayVerse(verse) {
    const verseContent = document.getElementById('verseContent');
    const textVerse = document.getElementById('textVerse');
    const imageVerse = document.getElementById('imageVerse');
    const engagementActions = document.getElementById('engagementActions');

    // If the DOM is missing (stale cached HTML / partial shell), fail safely.
    if (!verseContent || !textVerse || !imageVerse || !engagementActions) return;

    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value ?? '';
    };
    
    this.hideLoading();
    
    if (verse.content_type === 'text') {
      setText('verseText', this.normalizeVerseText(verse.verse_text));
      setText('verseReference', verse.bible_reference || '');
      setText('verseReferenceDesktop', verse.bible_reference || '');
      
      const contextEl = document.getElementById('verseContext');
      if (contextEl) {
        if (this.isFeatureEnabled('verse_commentary_enabled') && verse.context && !this.shouldHideContext(verse.context)) {
          contextEl.textContent = verse.context;
          contextEl.classList.remove('hidden');
        } else {
          contextEl.classList.add('hidden');
        }
      }
      
      textVerse.classList.remove('hidden');
      imageVerse.classList.add('hidden');
    } else {
      const img = document.getElementById('verseImage');
      if (img) {
        img.src = verse.image_path;
        img.alt = verse.bible_reference || 'Church Tap image';
      }
      
      setText('imageReference', verse.bible_reference || '');
      setText('imageReferenceDesktop', verse.bible_reference || '');
      
      const contextEl = document.getElementById('imageContext');
      if (contextEl) {
        if (this.isFeatureEnabled('verse_commentary_enabled') && verse.context && !this.shouldHideContext(verse.context)) {
          contextEl.textContent = verse.context;
          contextEl.classList.remove('hidden');
        } else {
          contextEl.classList.add('hidden');
        }
      }
      
      imageVerse.classList.remove('hidden');
      textVerse.classList.add('hidden');
    }
    
    // Display personalization badge if applicable
    const personalizationBadge = document.getElementById('personalizationBadge');
    if (personalizationBadge) {
      if (verse.personalized) {
        const personalizationText = document.getElementById('personalizationText');
        if (personalizationText) personalizationText.textContent = verse.reason || 'Personalized for you';
        personalizationBadge.classList.remove('hidden');
      } else {
        personalizationBadge.classList.add('hidden');
      }
    }
    
    // Display tags
    this.displayTags(verse.tags);
    
    // Update translation button labels
    this.updateTranslationButtons();
    
    verseContent.classList.remove('hidden');
    engagementActions.classList.remove('hidden');
    
    // Update heart count
    setText('heartCount', verse.hearts || 0);

    // Study Mode: allow tapping a word in today's verse to define it.
    // Only applies to the verse-of-the-day view (not the Study page).
    this.attachVerseOfDayWordTapHandlers();
    this.attachDailyVerseReferenceCommentaryHandlers();

    // Private user verse tools (highlight + notes)
    this.updateVersePrivateToolsVisibility();
    this.refreshVersePrivateToolsState().catch(() => {});
  }

  // ===========================
  // Study Mode: word tap on today's verse
  // ===========================
  attachDailyVerseReferenceCommentaryHandlers() {
    // Make the verse reference act like a "open commentary" link.
    // Works for both text and image verse layouts (mobile + desktop).
    const ids = ['verseReference', 'verseReferenceDesktop', 'imageReference', 'imageReferenceDesktop'];
    const els = ids.map(id => document.getElementById(id)).filter(Boolean);
    if (!els.length) return;

    for (const el of els) {
      if (el.dataset && el.dataset.ctRefCommentary === '1') continue;
      if (el.dataset) el.dataset.ctRefCommentary = '1';

      // Basic affordance + accessibility
      try {
        el.style.cursor = 'pointer';
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        el.setAttribute('aria-label', 'Open commentary for today’s verse');
      } catch (e) {}

      const open = () => {
        const ref = String(this.currentVerse?.bible_reference || el.textContent || '').trim();
        if (!ref) return;
        this.openCommentaryForRef(ref);
      };

      el.addEventListener('click', (e) => {
        e.preventDefault();
        open();
      });

      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
    }
  }

  getDefaultCommentarySourceKey() {
    const userK = String(this.currentUser?.defaultCommentarySourceKey || this.currentUser?.preferences?.defaultCommentarySourceKey || '').trim();
    if (userK) return userK;
    try {
      return String(localStorage.getItem('defaultCommentarySource.v1') || '').trim();
    } catch (e) {
      return '';
    }
  }

  getDefaultDictionarySourceKey() {
    const userK = String(this.currentUser?.defaultDictionarySourceKey || this.currentUser?.preferences?.defaultDictionarySourceKey || '').trim();
    if (userK) return userK;
    try {
      return String(localStorage.getItem('defaultDictionarySource.v1') || '').trim();
    } catch (e) {
      return '';
    }
  }

  getWordFromPoint(clientX, clientY) {
    try {
      let node = null;
      let offset = null;

      if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(clientX, clientY);
        node = pos?.offsetNode || null;
        offset = typeof pos?.offset === 'number' ? pos.offset : null;
      } else if (document.caretRangeFromPoint) {
        const range = document.caretRangeFromPoint(clientX, clientY);
        node = range?.startContainer || null;
        offset = typeof range?.startOffset === 'number' ? range.startOffset : null;
      }

      if (!node || node.nodeType !== Node.TEXT_NODE) return null;
      const text = String(node.textContent || '');
      if (!text) return null;
      if (offset === null) return null;

      const isWordChar = (ch) => /[A-Za-z’'\-]/.test(ch);
      let i = Math.min(Math.max(offset, 0), text.length);

      // If offset points between chars, prefer the char before.
      if (i > 0 && !isWordChar(text[i]) && isWordChar(text[i - 1])) i = i - 1;
      if (!isWordChar(text[i])) return null;

      let start = i;
      let end = i + 1;
      while (start > 0 && isWordChar(text[start - 1])) start--;
      while (end < text.length && isWordChar(text[end])) end++;

      const word = text.slice(start, end).replace(/^[-’']+|[-’']+$/g, '').trim();
      if (!word) return null;
      if (!/^[A-Za-z][A-Za-z’'\-]*$/.test(word)) return null;
      return word;
    } catch (e) {
      return null;
    }
  }

  attachVerseOfDayWordTapHandlers() {
    const el = document.getElementById('verseText');
    if (!el || !el.addEventListener) return;
    if (el.dataset && el.dataset.studyWordTapToday === '1') return;
    if (el.dataset) el.dataset.studyWordTapToday = '1';

    el.style.cursor = 'text';

    el.addEventListener('click', async (e) => {
      if (!this.isStudyModeEnabled()) return;

      // If user is selecting text, don't hijack taps.
      const sel = window.getSelection?.();
      if (sel && !sel.isCollapsed && String(sel.toString() || '').trim()) return;

      const word = this.getWordFromPoint(e.clientX, e.clientY);
      if (!word) return;

      await this.showDefinitionForWord(word);
    });
  }

  displayTags(tagsString) {
    const tagsContainer = document.getElementById('verseTags');
    
    if (!tagsString) {
      tagsContainer.classList.add('hidden');
      return;
    }
    
    const tags = this.getDisplayTags(tagsString);
    
    if (tags.length === 0) {
      tagsContainer.classList.add('hidden');
      return;
    }
    
    tagsContainer.innerHTML = tags.map(tag => 
      `<span class="px-2 py-1 bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 text-xs rounded-full">${tag}</span>`
    ).join('');
    
    tagsContainer.classList.remove('hidden');
  }

  showLoading() {
    document.getElementById('loadingVerse').classList.remove('hidden');
    document.getElementById('verseContent').classList.add('hidden');
    document.getElementById('noVerse').classList.add('hidden');
    document.getElementById('engagementActions').classList.add('hidden');
  }

  hideLoading() {
    document.getElementById('loadingVerse')?.classList.add('hidden');
  }

  showNoVerse() {
    this.hideLoading();
    document.getElementById('verseContent')?.classList.add('hidden');
    document.getElementById('noVerse')?.classList.remove('hidden');
    document.getElementById('engagementActions')?.classList.add('hidden');
  }

  showOfflineMessage() {
    this.hideLoading();
    document.getElementById('verseContent')?.classList.add('hidden');
    document.getElementById('noVerse')?.classList.remove('hidden');
    const h3 = document.querySelector('#noVerse h3');
    const p = document.querySelector('#noVerse p');
    if (h3) h3.textContent = 'No internet connection';
    if (p) p.textContent = 'Please check your connection and try again.';
  }

  showErrorState(section, message) {
    if (section === 'verse') {
      this.hideLoading();
      document.getElementById('verseContent')?.classList.add('hidden');
      document.getElementById('noVerse')?.classList.remove('hidden');
      const h3 = document.querySelector('#noVerse h3');
      const p = document.querySelector('#noVerse p');
      if (h3) h3.textContent = 'Something went wrong';
      if (p) p.textContent = message;
      const btn = document.getElementById('backToToday');
      if (btn) {
        btn.textContent = 'Try Again';
        btn.onclick = () => this.retry('verse');
      }
    } else if (section === 'community') {
      const container = document.getElementById('communityContent');
      if (container) {
        container.innerHTML = `
          <div class="text-center py-8">
            <div class="text-4xl mb-4">⚠️</div>
            <h3 class="text-lg font-medium text-gray-800 dark:text-white mb-2">Something went wrong</h3>
            <p class="text-gray-600 dark:text-gray-400 mb-4">${message}</p>
            <button onclick="app.retry('community')" class="btn-primary">Try Again</button>
          </div>
        `;
      }
    }
  }

  showCriticalError(message) {
    document.body.innerHTML = `
      <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-red-100">
        <div class="text-center p-8">
          <div class="text-6xl mb-4">🚨</div>
          <h1 class="text-2xl font-bold text-gray-900 mb-4">Critical Error</h1>
          <p class="text-gray-700 mb-6">${message}</p>
          <button onclick="location.reload()" class="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-medium">
            Refresh Page
          </button>
        </div>
      </div>
    `;
  }

  retry(section) {
    if (section === 'verse') {
      this.loadVerse(this.currentDate).catch(err => {
        console.error('Retry failed:', err);
        this.showErrorState('verse', 'Still unable to load verse. Please try refreshing the page.');
      });
    } else if (section === 'community') {
      this.loadCommunity(this.currentDate).catch(err => {
        console.error('Community retry failed:', err);
        this.showErrorState('community', 'Still unable to load community content.');
      });
    }
  }

  updateDateDisplay(date) {
    const dateObj = new Date(date + 'T00:00:00');
    const now = new Date();

    // Create local date strings for comparison
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    const dateStr = dateObj.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    document.getElementById('currentDate').textContent = dateStr;

    const description = document.getElementById('dateDescription');
    if (date === todayStr) {
      description.textContent = "Today's Verse";
    } else if (date === yesterdayStr) {
      description.textContent = "Yesterday's Verse";
    } else {
      description.textContent = "Church Tap";
    }
  }

  navigateDay(direction) {
    // Only allow day-to-day navigation from the verse (Today) view.
    if (!this.isVerseRoute(window.location.pathname)) return;

    const currentDateObj = new Date(this.currentDate + 'T00:00:00');
    currentDateObj.setDate(currentDateObj.getDate() + direction);
    
    const newDate = currentDateObj.toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const twoWeeksAgoStr = twoWeeksAgo.toISOString().split('T')[0];
    
    // Don't go beyond today or 2 weeks ago
    if (newDate > today) {
      navigator.vibrate && navigator.vibrate(100);
      this.showToast('Cannot view future dates', 'info');
      return;
    }
    
    if (newDate < twoWeeksAgoStr) {
      navigator.vibrate && navigator.vibrate(100);
      this.showToast('Can only view verses from the past 2 weeks', 'info');
      return;
    }
    
    this.currentDate = newDate;
    this.loadVerse(newDate).catch(err => {
      console.error('Navigation verse load failed:', err);
      this.showErrorState('verse', 'Unable to load verse for this date.');
    });
    this.loadCommunity(newDate).catch(err => {
      console.error('Navigation community load failed:', err);
      this.showErrorState('community', 'Unable to load community content for this date.');
    });
    
    // Add animation class
    const container = document.getElementById('verseContainer');
    container.style.opacity = '0';
    setTimeout(() => {
      container.style.opacity = '1';
    }, 150);
  }

  goToToday() {
    // Use local date instead of UTC date
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const today = `${year}-${month}-${day}`;

    // If we're in a tap-based session (/t/<uid>), keep the URL stable for tracking
    // but still show today's verse content.
    if (/^\/t\/[^\/?#]+$/.test(String(window.location.pathname || ''))) {
      this.currentDate = today;
      this.setActiveTab('today');
      this.showVerseContainer();
      this.loadVerse(today).catch(() => {});
      this.loadCommunity(today).catch(() => {});
      return;
    }

    // Otherwise, route to the canonical date URL (keeps routing/tab shell consistent)
    this.navigate(`/verse/${today}`);
  }

  // ===========================
  // Emergency Topics + Fundraising + Playlist
  // ===========================
  async loadTopics() {
    try {
      const res = await fetch(this.withOrg('/api/organization/topics'));
      const data = await res.json().catch(() => null);
      this._topics = data?.success ? (data.topics || []) : [];
    } catch (e) {
      this._topics = [];
    }
    return this._topics;
  }

  async showTopicsWordCloud() {
    try {
      // Show loading state
      const loadingContent = `
        <div class="text-center py-8">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <p class="mt-4 text-gray-600 dark:text-gray-400">Loading topics...</p>
        </div>
      `;
      this.showModal('Browse Topics', loadingContent);

      // Fetch topics
      const topics = await this.loadTopics();
      
      if (!topics || topics.length === 0) {
        const noTopicsContent = `
          <div class="text-center py-8">
            <p class="text-gray-600 dark:text-gray-400">No topics available at this time.</p>
          </div>
        `;
        this.showModal('Browse Topics', noTopicsContent);
        return;
      }

      // Create word cloud content
      const wordCloudContent = `
        <div class="relative">
          <button id="closeTopicsModal" class="absolute -top-2 -right-2 w-8 h-8 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-full flex items-center justify-center text-gray-500 dark:text-gray-400 transition-colors z-10">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
          
          <div class="mb-4">
            <p class="text-sm text-gray-600 dark:text-gray-400 text-center">Tap a topic to get a random verse</p>
          </div>
          
          <div id="topicsWordCloud" class="flex flex-wrap gap-3 justify-center items-center py-4 max-h-[60vh] overflow-y-auto">
            ${topics.map(topic => {
              const size = this.getTopicSize(topic, topics);
              return `
                <button 
                  type="button"
                  data-topic-id="${this.escapeHtml(topic.id)}"
                  data-topic-name="${this.escapeHtml(topic.name)}"
                  data-topic-source="${this.escapeHtml(topic.source || 'custom')}"
                  class="topic-tag px-4 py-2 rounded-full font-medium transition-all hover:scale-105 hover:shadow-lg ${this.getTopicColor(topic)}"
                  style="font-size: ${size}px;"
                >
                  ${this.escapeHtml(topic.name)}
                </button>
              `;
            }).join('')}
          </div>
        </div>
      `;

      this.showModal('Browse Topics', wordCloudContent);
      
      // Wire up close button after modal is created
      setTimeout(() => {
        const closeBtn = document.getElementById('closeTopicsModal');
        if (closeBtn) {
          closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.closeModal();
          });
        }

        // Delegate topic selection (avoids inline onclick issues on mobile / with quotes)
        const cloud = document.getElementById('topicsWordCloud');
        if (cloud) {
          cloud.addEventListener('click', (e) => {
            const btn = e.target && e.target.closest ? e.target.closest('button[data-topic-id]') : null;
            if (!btn) return;
            const topicId = parseInt((btn.dataset.topicId || '').toString(), 10);
            const topicName = (btn.dataset.topicName || '').toString();
            const source = (btn.dataset.topicSource || 'custom').toString();
            if (!topicId) return;
            this.selectTopicFromWordCloud(topicId, topicName, source);
          }, { passive: true });
        }
      }, 0);
    } catch (error) {
      console.error('Error loading topics word cloud:', error);
      this.showToast('Failed to load topics');
      this.closeModal();
    }
  }

  getTopicSize(topic, allTopics) {
    // Base size
    const baseSize = 14;
    const minSize = 12;
    const maxSize = 24;
    
    // Sort order affects size (lower sort_order = larger)
    // Also consider if it's a default topic (usually more important)
    const sortOrderFactor = topic.sort_order !== undefined ? Math.max(0, 20 - topic.sort_order) : 10;
    const sourceFactor = topic.source === 'default' ? 1.2 : 1.0;
    
    // Calculate size with some randomization for visual interest
    const calculatedSize = baseSize + (sortOrderFactor * 0.3) * sourceFactor;
    
    // Add slight random variation for word cloud effect
    const randomVariation = (Math.random() - 0.5) * 2;
    const finalSize = Math.max(minSize, Math.min(maxSize, calculatedSize + randomVariation));
    
    return Math.round(finalSize);
  }

  getTopicColor(topic) {
    // Different colors for default vs custom topics
    if (topic.source === 'default') {
      return 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 hover:bg-blue-200 dark:hover:bg-blue-800';
    } else {
      return 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 hover:bg-purple-200 dark:hover:bg-purple-800';
    }
  }

  async selectTopicFromWordCloud(topicId, topicName, source) {
    try {
      // Close the word cloud modal
      if (this.currentModal) {
        this.closeModal();
      }
      
      // Show loading
      this.showToast(`Loading verse from "${topicName}"...`);
      
      // Fetch random verse from this topic
      const url = source === 'default' 
        ? this.withOrg(`/api/organization/default-topics/${topicId}/random`)
        : this.withOrg(`/api/organization/topics/${topicId}/random`);
      
      const response = await fetch(url);
      const data = await response.json();
      
      if (!data.success || !data.verse) {
        throw new Error(data.error || 'Failed to load verse');
      }
      
      const verse = data.verse;
      const safeVerseTextHtml = this.escapeHtml(this.normalizeVerseText(verse.verse_text)).replace(/\n/g, '<br>');
      const safeReference = this.escapeHtml(verse.bible_reference || '');
      const safeTopicName = this.escapeHtml(topicName);
      
      // Create modal content for the topic verse
      const verseContent = `
        <div class="relative">
          <button class="absolute -top-2 -right-2 w-8 h-8 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-full flex items-center justify-center text-gray-500 dark:text-gray-400 transition-colors" onclick="app.closeModal()">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
          
          <div class="text-center space-y-4">
            <div class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 mb-4">
              📚 ${safeTopicName}${verse.translation ? ` • ${verse.translation}` : ''}
            </div>
            
            <div class="verse-text text-lg leading-relaxed text-gray-800 dark:text-gray-200 mb-6">
              ${safeVerseTextHtml}
            </div>
            
            <div class="verse-reference text-base font-semibold text-primary-600 dark:text-primary-400 mb-4">
              ${safeReference}
            </div>
            
            <div class="flex justify-center flex-wrap gap-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button id="shareTopicVerse" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors min-w-[100px] border border-blue-700">
                📤 Share
              </button>
              <button id="getAnotherTopicVerse" class="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors min-w-[100px] border border-purple-700" style="background-color: #9333ea; border-color: #7e22ce; color: white;">
                🔄 Another
              </button>
              <button id="browseMoreTopics" class="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors min-w-[100px] border border-gray-700">
                📋 Browse Topics
              </button>
            </div>
          </div>
        </div>
      `;
      
      this.showModal(`Verse from ${safeTopicName}`, verseContent);
      
      // Wire up buttons
      const shareBtn = document.getElementById('shareTopicVerse');
      if (shareBtn) {
        shareBtn.addEventListener('click', () => {
          this.shareTopicVerse(verse);
        });
      }
      
      document.getElementById('getAnotherTopicVerse')?.addEventListener('click', () => {
        this.selectTopicFromWordCloud(topicId, topicName, source);
      });
      
      document.getElementById('browseMoreTopics')?.addEventListener('click', () => {
        this.showTopicsWordCloud();
      });
      
      // Track analytics
      // trackAnalytics' second parameter maps to `verse_id` on the backend; keep it numeric.
      this.trackAnalytics('topic_verse_viewed', verse?.id || null);
      
    } catch (error) {
      console.error('Error loading topic verse:', error);
      this.showToast(error.message || 'Failed to load verse from topic');
    }
  }

  async loadFundraising() {
    try {
      const res = await fetch(this.withOrg('/api/organization/fundraising'));
      const data = await res.json().catch(() => null);
      this._fundraising = data?.success ? (data.fundraising || null) : null;
    } catch (e) {
      this._fundraising = null;
    }

    const hasActiveGoal = !!this._fundraising && Number(this._fundraising.goal_amount_cents || 0) > 0;

    // Links tab: show a small badge when fundraising is active
    const badge = document.getElementById('linksFundraisingBadge');
    if (badge) badge.classList.toggle('hidden', !hasActiveGoal);

    const card = document.getElementById('fundraisingCard');
    if (card) {
      if (!this._fundraising) {
        card.classList.add('hidden');
      } else {
        const f = this._fundraising;
        const goal = (f.goal_amount_cents || 0) / 100;
        const current = (f.current_amount_cents || 0) / 100;
        const pct = goal > 0 ? Math.min(100, Math.round((current / goal) * 100)) : 0;
        const deadline = f.deadline_date ? new Date(f.deadline_date).toLocaleDateString() : null;

        const fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });
        const titleEl = document.getElementById('fundraisingTitle');
        const amountsEl = document.getElementById('fundraisingAmounts');
        const pctEl = document.getElementById('fundraisingPct');
        const barEl = document.getElementById('fundraisingProgressBar');
        const deadlineEl = document.getElementById('fundraisingDeadline');

        if (titleEl) titleEl.textContent = (f.goal_title || 'Fundraising').toString();
        if (amountsEl) amountsEl.textContent = `${fmt.format(current)} / ${fmt.format(goal)}`;
        if (pctEl) pctEl.textContent = `${pct}%`;
        if (barEl) barEl.style.width = `${pct}%`;
        if (deadlineEl) deadlineEl.textContent = deadline ? `By ${deadline}` : '';

        card.classList.remove('hidden');
      }
    }

    return this._fundraising;
  }

  async loadWorshipPlaylist() {
    try {
      const res = await fetch(this.withOrg('/api/organization/worship-playlist'));
      const data = await res.json().catch(() => null);
      const p = data?.success ? (data.playlist || null) : null;
      this._playlistLink = (p && p.youtube_url) ? { title: p.title || 'Worship Playlist', url: p.youtube_url } : null;
    } catch (e) {
      this._playlistLink = null;
    }

    const btn = document.getElementById('playlistBtn');
    if (btn) {
      if (this._playlistLink) btn.classList.remove('hidden');
      else btn.classList.add('hidden');
    }

    return this._playlistLink;
  }

  getYoutubeEmbedUrl(rawUrl) {
    try {
      const u = new URL(rawUrl);
      const host = u.hostname.replace(/^www\./, '').toLowerCase();
      const isYoutube = host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be' || host === 'music.youtube.com';
      if (!isYoutube) return null;

      const list = u.searchParams.get('list');
      if (list) return `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(list)}`;

      if (host === 'youtu.be') {
        const vid = u.pathname.replace('/', '').trim();
        if (vid) return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(vid)}`;
      }

      const vid = u.searchParams.get('v');
      if (vid) return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(vid)}`;
      return null;
    } catch (e) {
      return null;
    }
  }

  openPlaylistModal() {
    const link = this._playlistLink;
    if (!link?.url) {
      this.showToast('No playlist configured');
      return;
    }

    const embed = this.getYoutubeEmbedUrl(link.url);
    const safeTitle = this.escapeHtml(link.title || 'Worship Playlist');

    const body = embed ? `
      <div class="space-y-4">
        <div class="text-sm text-gray-600 dark:text-gray-400">${safeTitle}</div>
        <div class="relative w-full" style="padding-top:56.25%;">
          <iframe
            src="${embed}"
            title="${safeTitle}"
            class="absolute inset-0 w-full h-full rounded-xl border border-gray-200 dark:border-gray-700"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen>
          </iframe>
        </div>
        <div class="flex justify-end">
          <button id="openPlaylistExternalBtn" class="px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 rounded-lg text-sm">
            Open in YouTube
          </button>
        </div>
      </div>
    ` : `
      <div class="space-y-4">
        <div class="text-sm text-gray-600 dark:text-gray-400">${safeTitle}</div>
        <p class="text-sm text-gray-600 dark:text-gray-400">We couldn’t embed this URL, but you can open it in YouTube:</p>
        <button id="openPlaylistExternalBtn" class="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm">
          Open Link
        </button>
      </div>
    `;

    this.showModal('Worship Playlist', body);
    const openBtn = document.getElementById('openPlaylistExternalBtn');
    if (openBtn) {
      openBtn.addEventListener('click', () => {
        window.open(link.url, '_blank');
      });
    }
    this.trackAnalytics && this.trackAnalytics('playlist_open');
  }

  openFundraisingModal() {
    const f = this._fundraising;
    if (!f) {
      this.showToast('No fundraiser configured');
      return;
    }

    const goal = (f.goal_amount_cents || 0) / 100;
    const current = (f.current_amount_cents || 0) / 100;
    const pct = goal > 0 ? Math.min(100, Math.round((current / goal) * 100)) : 0;
    const deadline = f.deadline_date ? new Date(f.deadline_date).toLocaleDateString() : null;

    const body = `
      <div class="space-y-4">
        <div class="text-lg font-semibold text-gray-800 dark:text-gray-200">${this.escapeHtml(f.goal_title)}</div>
        <div class="text-sm text-gray-600 dark:text-gray-400">${this.escapeHtml(`$${current.toFixed(2)} raised of $${goal.toFixed(2)} (${pct}%)`)}</div>
        <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
          <div class="h-3 bg-green-600" style="width:${pct}%"></div>
        </div>
        ${deadline ? `<div class="text-xs text-gray-500 dark:text-gray-400">Deadline: ${this.escapeHtml(deadline)}</div>` : ''}
      </div>
    `;

    this.showModal('Fundraising', body);
    this.trackAnalytics && this.trackAnalytics('fundraising_open');
  }

  async showRandomVerse() {
    try {
      if (this._topics === null) {
        await this.loadTopics();
      }

      const topics = Array.isArray(this._topics) ? this._topics : [];
      const topicsDropdown = topics.length ? `
        <div class="mb-4">
          <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Topic (Emergency Scripture)</label>
          <select id="topicSelect" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-800 dark:text-gray-200">
            <option value="">Any (Random)</option>
            ${topics.map(t => `<option value="${this.escapeHtml(`${t.source || 'custom'}:${t.id}`)}">${this.escapeHtml(t.name)}</option>`).join('')}
          </select>
        </div>
      ` : '';

      const response = await fetch(this.buildApiUrl('/api/verse/random'));
      const data = await response.json();
      
      if (data.success && data.verse) {
        const verse = data.verse;
        const safeVerseTextHtml = this.escapeHtml(this.normalizeVerseText(verse.verse_text)).replace(/\n/g, '<br>');
        const safeReference = this.escapeHtml(verse.bible_reference || '');
        const safeContextHtml = (this.isFeatureEnabled('verse_commentary_enabled') && verse.context && !this.shouldHideContext(verse.context))
          ? `<div class="text-sm text-gray-600 dark:text-gray-400 italic">${this.escapeHtml(verse.context)}</div>`
          : '';
        
        // Create modal content for the random verse
        const verseContent = `
          <div class="relative">
            <button class="absolute -top-2 -right-2 w-8 h-8 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-full flex items-center justify-center text-gray-500 dark:text-gray-400 transition-colors" onclick="app.closeModal()">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
            
            <div class="text-center space-y-4">
              <div class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 mb-4">
                🎲 Random Verse${verse.source === 'bolls.life' ? ` • ${verse.translation}` : ''}
              </div>
              ${topicsDropdown}
            
            <div class="verse-text text-lg leading-relaxed text-gray-800 dark:text-gray-200 mb-6">
              ${safeVerseTextHtml}
            </div>
            
            <div class="verse-reference text-base font-semibold text-primary-600 dark:text-primary-400 mb-4">
              ${safeReference}
            </div>
            
            ${safeContextHtml}
            
              <div class="flex justify-center space-x-4 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                <button id="shareRandomVerse" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
                  📤 Share
                </button>
                <button id="getAnotherRandom" class="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors">
                  🎲 Another
                </button>
              </div>
            </div>
          </div>
        `;
        
        this.showModal('Random Verse', verseContent);

        const topicSelect = document.getElementById('topicSelect');
        if (topicSelect) {
          topicSelect.addEventListener('change', async () => {
            const raw = (topicSelect.value || '').toString().trim();
            if (!raw) return;
            const [source, idStr] = raw.split(':');
            const topicId = parseInt(idStr, 10);
            if (!topicId) return;

            try {
              const url = (source === 'default')
                ? this.withOrg(`/api/organization/default-topics/${topicId}/random`)
                : this.withOrg(`/api/organization/topics/${topicId}/random`);
              const res = await fetch(url);
              const tData = await res.json().catch(() => null);
              if (tData?.success && tData.verse) {
                this.closeModal();
                const v2 = tData.verse;
                const safeVerseTextHtml2 = this.escapeHtml(this.normalizeVerseText(v2.verse_text)).replace(/\n/g, '<br>');
                const safeReference2 = this.escapeHtml(v2.bible_reference || '');

                const badge = `🆘 ${this.escapeHtml(tData.topic?.name || 'Topic')}${v2.source === 'bolls.life' ? ` • ${v2.translation}` : ''}`;

                const content2 = `
                  <div class="relative">
                    <button class="absolute -top-2 -right-2 w-8 h-8 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-full flex items-center justify-center text-gray-500 dark:text-gray-400 transition-colors" onclick="app.closeModal()">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                      </svg>
                    </button>
                    <div class="text-center space-y-4">
                      <div class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 mb-4">
                        ${badge}
                      </div>
                      ${topicsDropdown}
                      <div class="verse-text text-lg leading-relaxed text-gray-800 dark:text-gray-200 mb-6">
                        ${safeVerseTextHtml2}
                      </div>
                      <div class="verse-reference text-base font-semibold text-primary-600 dark:text-primary-400 mb-4">
                        ${safeReference2}
                      </div>
                      <div class="flex justify-center space-x-4 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                        <button id="shareRandomVerse" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
                          📤 Share
                        </button>
                        <button id="getAnotherRandom" class="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors">
                          🎲 Another
                        </button>
                      </div>
                    </div>
                  </div>
                `;

                this.showModal('Emergency Scripture', content2);

                const topicSelect2 = document.getElementById('topicSelect');
                if (topicSelect2) topicSelect2.value = raw;

                document.getElementById('shareRandomVerse')?.addEventListener('click', () => this.shareRandomVerse(v2));
                document.getElementById('getAnotherRandom')?.addEventListener('click', () => {
                  this.closeModal();
                  // Go back through the base modal so the dropdown stays in sync
                  this.showRandomVerse().then(() => {
                    const ts = document.getElementById('topicSelect');
                    if (ts) {
                      ts.value = raw;
                      ts.dispatchEvent(new Event('change'));
                    }
                  });
                });

                this.trackAnalytics && this.trackAnalytics('topic_verse', topicId);
              } else {
                this.showToast(tData?.error || 'Failed to load topic verse');
              }
            } catch (e) {
              this.showToast('Failed to load topic verse');
            }
          });
        }
        
        // Add event listeners for modal buttons
        document.getElementById('shareRandomVerse').addEventListener('click', () => {
          this.shareRandomVerse(verse);
        });
        
        document.getElementById('getAnotherRandom').addEventListener('click', () => {
          this.closeModal();
          this.showRandomVerse(); // Recursively get another random verse
        });
        
        // Track analytics for random verse
        this.trackAnalytics('random_verse', verse.id);
      }
    } catch (error) {
      console.error('Error loading random verse:', error);
      this.showToast('Failed to load random verse');
    }
  }

  shareRandomVerse(verse) {
    const shareData = {
      title: 'Random Bible Verse',
      text: `${this.normalizeVerseText(verse.verse_text)}\n\n— ${verse.bible_reference}`,
      url: window.location.origin
    };

    if (navigator.share) {
      navigator.share(shareData).catch(error => {
        if (error.name !== 'AbortError') {
          this.fallbackShareRandomVerse(shareData);
        }
      });
    } else {
      this.fallbackShareRandomVerse(shareData);
    }
  }

  shareTopicVerse(verse) {
    const shareData = {
      title: 'Bible Verse',
      text: `${this.normalizeVerseText(verse.verse_text)}\n\n— ${verse.bible_reference}`,
      url: window.location.origin
    };

    if (navigator.share) {
      navigator.share(shareData).catch(error => {
        if (error.name !== 'AbortError') {
          this.fallbackShareTopicVerse(shareData);
        }
      });
    } else {
      this.fallbackShareTopicVerse(shareData);
    }
  }

  fallbackShareTopicVerse(shareData) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareData.text).then(() => {
        this.showToast('📋 Verse copied to clipboard!');
      }).catch(() => {
        this.showToast('Failed to copy to clipboard');
      });
    } else {
      this.showToast('📋 ' + shareData.text);
    }
    this.trackAnalytics('share_topic_verse');
  }

  fallbackShareRandomVerse(shareData) {
    // Copy to clipboard as fallback
    const textToCopy = `${shareData.text}\n\n${shareData.url}`;
    navigator.clipboard.writeText(textToCopy).then(() => {
      this.showToast('📋 Random verse copied to clipboard!');
    }).catch(() => {
      this.showToast('Unable to copy to clipboard');
    });
    
    this.trackAnalytics('share_random_verse');
  }

  toggleTheme() {
    this.theme = this.theme === 'light' ? 'dark' : 'light';
    this.applyTheme();
    localStorage.setItem('theme', this.theme);
  }

  applyTheme() {
    if (this.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  cycleTextSize(reverse = false) {
    const sizes = ['small', 'medium', 'large'];
    const currentIndex = sizes.indexOf(this.textSize);
    
    let newIndex;
    if (reverse) {
      newIndex = currentIndex === 0 ? sizes.length - 1 : currentIndex - 1;
    } else {
      newIndex = (currentIndex + 1) % sizes.length;
    }
    
    this.textSize = sizes[newIndex];
    this.applyTextSize();
    localStorage.setItem('textSize', this.textSize);
    
    this.showToast(`Text size: ${this.textSize}`);
  }

  applyTextSize() {
    const verseText = document.getElementById('verseText');
    if (verseText) {
      verseText.className = verseText.className.replace(/size-\w+/, '') + ` size-${this.textSize}`;
    }
    
    // Apply text size to all verse-text elements in modals
    const modalVerseTexts = document.querySelectorAll('.verse-text');
    modalVerseTexts.forEach(element => {
      element.className = element.className.replace(/size-\w+/, '') + ` size-${this.textSize}`;
    });
  }

  // ===========================
  // Study Mode (progressive disclosure)
  // ===========================
  getLocalStudyModeEnabled() {
    return localStorage.getItem('studyMode') === 'true';
  }

  isStudyModeEnabled() {
    const userValue = this.currentUser?.studyModeEnabled;
    if (typeof userValue === 'boolean') return userValue;
    // Guest / fallback
    return this.studyMode === true || this.getLocalStudyModeEnabled();
  }

  syncStudyModeFromUser() {
    const userValue = this.currentUser?.studyModeEnabled;
    if (typeof userValue !== 'boolean') return false;
    this.studyMode = userValue;
    localStorage.setItem('studyMode', userValue ? 'true' : 'false');
    return true;
  }

  async setStudyModeEnabled(enabled) {
    const next = !!enabled;
    this.studyMode = next;
    localStorage.setItem('studyMode', next ? 'true' : 'false');

    // If logged in, persist server-side (cross-device).
    if (this.currentUser) {
      // Keep UI consistent immediately.
      this.currentUser.studyModeEnabled = next;
      if (this.currentUser.preferences && typeof this.currentUser.preferences === 'object') {
        this.currentUser.preferences.studyModeEnabled = next;
      }

      try {
        const res = await fetch(this.buildApiUrl('/api/auth/preferences'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ studyModeEnabled: next })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          const msg = data?.error || 'Unable to save Study Mode preference';
          this.showToast(msg);
        } else {
          // Best-effort hydrate so other sessions/devices stay consistent on next load.
          this.refreshCurrentUserFromServer?.().catch(() => {});
        }
      } catch (e) {
        this.showToast('Unable to save Study Mode preference');
      }
    }

    return next;
  }

  async handleStudyModeToggle(enabled) {
    await this.setStudyModeEnabled(enabled);
    this.showToast(`Study Mode: ${this.isStudyModeEnabled() ? 'On' : 'Off'}`);
    // If we're on the Me page, re-render so the toggle stays in sync.
    if (String(window.location.pathname || '') === '/me') {
      this.renderMePage();
    }
  }

  // ===========================
  // Defaults (translation/commentary/dictionary)
  // ===========================
  syncStudyDefaultsFromUser() {
    if (!this.currentUser) return false;

    const preferredTranslation = String(this.currentUser?.preferredTranslation || this.currentUser?.preferences?.preferredTranslation || '').trim();
    const defaultCommentarySourceKey = String(this.currentUser?.defaultCommentarySourceKey || this.currentUser?.preferences?.defaultCommentarySourceKey || '').trim();
    const defaultDictionarySourceKey = String(this.currentUser?.defaultDictionarySourceKey || this.currentUser?.preferences?.defaultDictionarySourceKey || '').trim();

    try {
      if (preferredTranslation) localStorage.setItem('defaultTranslation.v1', preferredTranslation.toUpperCase());
      if (defaultCommentarySourceKey) localStorage.setItem('defaultCommentarySource.v1', defaultCommentarySourceKey);
      if (defaultDictionarySourceKey) localStorage.setItem('defaultDictionarySource.v1', defaultDictionarySourceKey);
    } catch (e) {}

    // Keep Study tools state aligned (best effort)
    if (this.studyState) {
      if (preferredTranslation && !String(this.studyState.translation || '').trim()) this.studyState.translation = preferredTranslation.toUpperCase();
      if (defaultCommentarySourceKey && !String(this.studyState.commentarySourceKey || '').trim()) this.studyState.commentarySourceKey = defaultCommentarySourceKey;
      if (defaultDictionarySourceKey && !String(this.studyState.dictionarySourceKey || '').trim()) this.studyState.dictionarySourceKey = defaultDictionarySourceKey;
    }

    return true;
  }

  async saveUserPreferencesPatch(patch) {
    if (!this.currentUser) return false;
    try {
      const res = await fetch(this.buildApiUrl('/api/auth/preferences'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch || {})
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) return false;
      // Best-effort refresh so server is source of truth.
      this.refreshCurrentUserFromServer?.().catch(() => {});
      return true;
    } catch (e) {
      return false;
    }
  }

  async setDefaultTranslation(code) {
    const t = String(code || '').trim().toUpperCase();
    if (!t) return;

    // Defaults should only be set from Menu.
    try { localStorage.setItem('defaultTranslation.v1', t); } catch (e) {}
    if (this.studyState && !String(this.studyState.translation || '').trim()) this.studyState.translation = t;

    if (this.currentUser) {
      this.currentUser.preferredTranslation = t;
      if (this.currentUser.preferences && typeof this.currentUser.preferences === 'object') {
        this.currentUser.preferences.preferredTranslation = t;
      }
      await this.saveUserPreferencesPatch({ preferredTranslation: t });
    }
  }

  async setDefaultCommentarySourceKey(sourceKey) {
    const k = String(sourceKey || '').trim();
    // Defaults should only be set from Menu.
    try { localStorage.setItem('defaultCommentarySource.v1', k); } catch (e) {}
    if (this.studyState && !String(this.studyState.commentarySourceKey || '').trim()) this.studyState.commentarySourceKey = k;

    if (this.currentUser) {
      this.currentUser.defaultCommentarySourceKey = k;
      if (this.currentUser.preferences && typeof this.currentUser.preferences === 'object') {
        this.currentUser.preferences.defaultCommentarySourceKey = k;
      }
      await this.saveUserPreferencesPatch({ defaultCommentarySourceKey: k || null });
    }
  }

  async setDefaultDictionarySourceKey(sourceKey) {
    const k = String(sourceKey || '').trim();
    // Defaults should only be set from Menu.
    try { localStorage.setItem('defaultDictionarySource.v1', k); } catch (e) {}
    if (this.studyState && !String(this.studyState.dictionarySourceKey || '').trim()) this.studyState.dictionarySourceKey = k;

    if (this.currentUser) {
      this.currentUser.defaultDictionarySourceKey = k;
      if (this.currentUser.preferences && typeof this.currentUser.preferences === 'object') {
        this.currentUser.preferences.defaultDictionarySourceKey = k;
      }
      await this.saveUserPreferencesPatch({ defaultDictionarySourceKey: k || null });
    }
  }

  getTranslationCatalog() {
    // Used for menu defaults and read modal.
    return (this.translationCatalog && this.translationCatalog.length > 0)
      ? this.translationCatalog
      : [
          { code: 'NASB', name: 'New American Standard Bible' },
          { code: 'ESV', name: 'English Standard Version' },
          { code: 'NIV', name: 'New International Version' },
          { code: 'NLT', name: 'New Living Translation' },
          { code: 'KJV', name: 'King James Version' },
          { code: 'MSG', name: 'The Message' },
          { code: 'CSB', name: 'Christian Standard Bible' },
          { code: 'AMP', name: 'Amplified Bible' },
          { code: 'ASV', name: 'American Standard Version' },
          { code: 'WEB', name: 'World English Bible' }
        ];
  }

  updateMenuDefaultPickers() {
    const translationEl = document.getElementById('menuDefaultTranslationSelect');
    const commentaryEl = document.getElementById('menuDefaultCommentarySelect');
    const dictionaryEl = document.getElementById('menuDefaultDictionarySelect');

    // Only runs on /menu (elements won't exist elsewhere).
    if (!translationEl && !commentaryEl && !dictionaryEl) return;

    // Translation
    if (translationEl) {
      const enabled = this.getEnabledTranslationCodes().map(c => String(c || '').toUpperCase());
      const enabledSet = new Set(enabled);
      const current = this.getDefaultTranslation();
      const catalog = this.getTranslationCatalog()
        .map(t => ({ code: String(t.code || '').toUpperCase(), name: t.name || String(t.code || '').toUpperCase() }));

      const enabledList = enabledSet.size ? catalog.filter(t => enabledSet.has(t.code)) : [];
      const hasCurrent = enabledSet.size ? enabledSet.has(current) : true;

      const options = [
        ...(enabledSet.size && !hasCurrent ? [{ code: current, name: current }] : []),
        ...enabledList
      ]
        .map(t => `<option value="${this.escapeHtml(t.code)}" ${t.code === current ? 'selected' : ''}>${this.escapeHtml(t.code)} — ${this.escapeHtml(t.name)}</option>`)
        .join('');

      translationEl.innerHTML = options || `<option value="${this.escapeHtml(current)}" selected>${this.escapeHtml(current)}</option>`;
      translationEl.value = current;
    }

    // Commentary
    if (commentaryEl) {
      const sources = Array.isArray(this._studyCommentarySources) ? this._studyCommentarySources : [];
      const current = this.getDefaultCommentarySourceKey();
      const hasCurrent = !!current && sources.some(s => String(s?.source_key || '') === current);
      const opts = [
        `<option value="" ${current ? '' : 'selected'}>Auto</option>`,
        ...(current && !hasCurrent ? [`<option value="${this.escapeHtml(current)}" selected>${this.escapeHtml(current)}</option>`] : []),
        ...sources.map(s => {
          const key = String(s.source_key || '');
          const label = String(s.title || s.abbreviation || key || 'Source');
          return `<option value="${this.escapeHtml(key)}" ${key === current ? 'selected' : ''}>${this.escapeHtml(label)}</option>`;
        })
      ].join('');
      commentaryEl.innerHTML = opts || `<option value="" selected>Auto</option>`;
      commentaryEl.value = current;
    }

    // Dictionary
    if (dictionaryEl) {
      const sources = Array.isArray(this._studyDictionarySources) ? this._studyDictionarySources : [];
      const current = this.getDefaultDictionarySourceKey();
      const hasCurrent = !!current && sources.some(s => String(s?.source_key || '') === current);
      const opts = [
        `<option value="" ${current ? '' : 'selected'}>Auto</option>`,
        ...(current && !hasCurrent ? [`<option value="${this.escapeHtml(current)}" selected>${this.escapeHtml(current)}</option>`] : []),
        ...sources.map(s => {
          const key = String(s.source_key || '');
          const label = String(s.title || s.abbreviation || key || 'Source');
          return `<option value="${this.escapeHtml(key)}" ${key === current ? 'selected' : ''}>${this.escapeHtml(label)}</option>`;
        })
      ].join('');
      dictionaryEl.innerHTML = opts || `<option value="" selected>Auto</option>`;
      dictionaryEl.value = current;
    }
  }

  async handleMenuDefaultTranslationChange(value) {
    await this.setDefaultTranslation(value);
    this.updateMenuDefaultPickers();
    this.showToast(`Default translation: ${this.getDefaultTranslation()}`);
  }

  async handleMenuDefaultCommentaryChange(value) {
    await this.setDefaultCommentarySourceKey(value);
    this.updateMenuDefaultPickers();
    this.showToast('Default commentary updated');
  }

  async handleMenuDefaultDictionaryChange(value) {
    await this.setDefaultDictionarySourceKey(value);
    this.updateMenuDefaultPickers();
    this.showToast('Default dictionary updated');
  }

  // ---------------------------
  // Word selection definitions (Study Mode)
  // ---------------------------
  getSelectedSingleWord() {
    try {
      const sel = window.getSelection?.();
      if (!sel || sel.isCollapsed) return null;
      const raw = String(sel.toString() || '').trim();
      if (!raw) return null;
      if (raw.length > 48) return null;
      // Only a single token (no whitespace)
      if (/\s/.test(raw)) return null;
      // Basic token validation (letters + apostrophes/hyphens)
      if (!/^[A-Za-z][A-Za-z’'\-]*$/.test(raw)) return null;
      return raw;
    } catch (e) {
      return null;
    }
  }

  attachStudyWordSelectionHandlers(containerEl) {
    if (!containerEl || !containerEl.addEventListener) return;
    if (containerEl.dataset && containerEl.dataset.studyWordTap === '1') return;
    if (containerEl.dataset) containerEl.dataset.studyWordTap = '1';

    const handler = async () => {
      if (!this.isStudyModeEnabled()) return;
      const word = this.getSelectedSingleWord();
      if (!word) return;

      // Debounce repeated triggers for the same selection
      const now = Date.now();
      if (this._studyLastWord === word && now - (this._studyLastWordAt || 0) < 1200) return;
      this._studyLastWord = word;
      this._studyLastWordAt = now;

      await this.showDefinitionForWord(word);
    };

    containerEl.addEventListener('mouseup', handler);
    containerEl.addEventListener('touchend', handler);
  }

  async fetchDictionaryEntry(term, sourceKey = '') {
    const q = String(term || '').trim();
    if (!q) return null;

    this._dictionaryCache = this._dictionaryCache || new Map();
    const source = String(sourceKey || '').trim();
    const cacheKey = `${source || 'auto'}::${q.toLowerCase()}`;
    if (this._dictionaryCache.has(cacheKey)) return this._dictionaryCache.get(cacheKey);

    const sourceParam = source ? `&source=${encodeURIComponent(source)}` : '';
    const res = await fetch(this.buildApiUrl(`/api/dictionary/lookup?term=${encodeURIComponent(q)}${sourceParam}`), { credentials: 'include' });
    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.success) {
      const err = new Error(data?.error || 'Dictionary lookup failed');
      err.status = res.status;
      throw err;
    }

    const entry = data.entry || null;
    this._dictionaryCache.set(cacheKey, entry);
    return entry;
  }

  async showDefinitionForWord(word) {
    const term = String(word || '').trim();
    if (!term) return;

    try {
      const sourceKey = this.getDefaultDictionarySourceKey();
      const entry = await this.fetchDictionaryEntry(term, sourceKey);
      if (!entry) {
        this.showModal('Definition', `
          <div class="text-sm text-gray-700 dark:text-gray-200">
            <div class="font-semibold">${this.escapeHtml(term)}</div>
            <div class="mt-2 text-gray-600 dark:text-gray-400">No dictionary entry found.</div>
            <div class="mt-4 flex justify-end">
              <button class="btn-secondary" onclick="window.churchTapApp.closeModal()">Close</button>
            </div>
          </div>
        `);
        return;
      }

      const headword = this.escapeHtml(entry.headword || term);
      const definitionHtml = this.sanitizeImportedHtml(entry.definition || '');
      const source = this.escapeHtml(entry.source_name || '');

      this.showModal('Definition', `
        <div class="text-sm text-gray-700 dark:text-gray-200">
          <div class="font-semibold">${headword}</div>
          ${definitionHtml ? `<div class="mt-2 leading-relaxed space-y-2">${definitionHtml}</div>` : ''}
          ${source ? `<div class="mt-2 text-xs text-gray-500 dark:text-gray-400">Source: ${source}</div>` : ''}
          <div class="mt-4 flex justify-end">
            <button class="btn-secondary" onclick="window.churchTapApp.closeModal()">Close</button>
          </div>
        </div>
      `);
    } catch (e) {
      if (e && e.status === 403) {
        this.showToast('Study tools are disabled for this group');
      } else {
        this.showToast('Definition unavailable');
      }
    }
  }

  toggleQuickMenu() {
    // Back-compat: menu is now a dedicated page.
    this.navigate('/menu');
  }

  toggleLinksMenu() {
    // Back-compat: links is now a dedicated page.
    this.navigate('/links');
  }

  hideLinksMenu() {
    const menu = document.getElementById('quickLinksMenu');
    const linksBtn = document.getElementById('tabLinksBtn');
    if (menu) menu.classList.add('hidden');
    
    if (linksBtn) {
      linksBtn.setAttribute('aria-expanded', 'false');
    }
  }

  hideQuickMenu() {
    const menu = document.getElementById('quickMenu');
    if (menu) menu.classList.add('hidden');
  }

  async toggleHeart() {
    if (!this.currentVerse) return;
    
    // Check if this is an external verse that can't be hearted
    if (this.currentVerse.source === 'bolls.life') {
      this.showToast('💝 External verses from bolls.life can\'t be hearted, but glad you love it!');
      return;
    }
    
    try {
      const response = await fetch(this.buildApiUrl('/api/verse/heart'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          verse_id: this.currentVerse.id,
          user_token: this.userToken
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        document.getElementById('heartCount').textContent = data.hearts;
        
        const heartBtn = document.querySelector('#heartBtn svg');
        heartBtn.classList.add('animate-heart-beat');
        setTimeout(() => heartBtn.classList.remove('animate-heart-beat'), 600);
        
        this.trackAnalytics('heart', this.currentVerse.id);
        navigator.vibrate && navigator.vibrate(25);
      }
    } catch (error) {
      console.error('Error toggling heart:', error);
    }
  }

  async toggleFavorite() {
    if (!this.currentVerse) return;

    const verseId = this.currentVerse.id;

    // Prefer server-backed favorites when logged in with an active group
    const canUseServer = !!(this.currentUser && this.membershipContext?.active_organization_id);

    if (canUseServer) {
      try {
        const response = await fetch(this.buildApiUrl('/api/favorites/toggle'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ verse_id: verseId })
        });

        const data = await response.json().catch(() => null);
        if (response.ok && data?.success) {
          const favorited = !!data.favorited;
          const index = this.favorites.indexOf(verseId);
          if (favorited && index === -1) this.favorites.push(verseId);
          if (!favorited && index !== -1) this.favorites.splice(index, 1);

          localStorage.setItem('favorites', JSON.stringify(this.favorites));
          this.updateFavoriteButton();
          this.showToast(favorited ? '❤️ Added to favorites!' : '💔 Removed from favorites');
          this.trackAnalytics('favorite', verseId);
          return;
        }
      } catch (error) {
        console.error('Error toggling server favorite:', error);
      }
      // Fall through to local toggle if server fails
    }

    const index = this.favorites.indexOf(verseId);
    if (index === -1) {
      this.favorites.push(verseId);
      this.showToast('❤️ Added to favorites!');
    } else {
      this.favorites.splice(index, 1);
      this.showToast('💔 Removed from favorites');
    }

    localStorage.setItem('favorites', JSON.stringify(this.favorites));
    this.updateFavoriteButton();
    this.trackAnalytics('favorite', verseId);
  }

  async toggleFavoriteById(verseId) {
    const id = Number(verseId);
    if (!id || Number.isNaN(id)) return;

    if (!this.currentUser) {
      this.showToast('Please login to manage favorites');
      this.showLoginModal();
      return;
    }

    try {
      const response = await fetch(this.buildApiUrl('/api/favorites/toggle'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ verse_id: id })
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data?.success) {
        const favorited = !!data.favorited;
        const idx = this.favorites.indexOf(id);
        if (favorited && idx === -1) this.favorites.push(id);
        if (!favorited && idx !== -1) this.favorites.splice(idx, 1);
        localStorage.setItem('favorites', JSON.stringify(this.favorites));
        this.updateFavoriteButton();
        if (window.location.pathname === '/favorites') this.renderFavoritesPage();
      }
    } catch (e) {
      console.error('toggleFavoriteById error:', e);
      this.showToast('Failed to update favorite');
    }
  }

  async createCollection(name, description) {
    const n = String(name || '').trim();
    const d = String(description || '').trim();
    if (!n) return;

    try {
      const res = await fetch(this.buildApiUrl('/api/collections'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: n, description: d })
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && data.collection?.id) {
        this.showToast('Collection created');
        this.navigate(`/collections/${Number(data.collection.id)}`);
        return;
      }
      this.showToast(data?.error || 'Failed to create collection');
    } catch (e) {
      console.error('createCollection error:', e);
      this.showToast('Failed to create collection');
    }
  }

  async deleteCollection(collectionId) {
    const id = Number(collectionId);
    if (!id || Number.isNaN(id)) return;
    if (!window.confirm('Delete this collection?')) return;

    try {
      const res = await fetch(this.buildApiUrl(`/api/collections/${id}`), {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        this.showToast('Collection deleted');
        this.navigate('/collections');
        return;
      }
      this.showToast(data?.error || 'Failed to delete collection');
    } catch (e) {
      console.error('deleteCollection error:', e);
      this.showToast('Failed to delete collection');
    }
  }

  async addCurrentVerseToCollection(collectionId) {
    const id = Number(collectionId);
    const verseId = this.currentVerse?.id;
    if (!id || Number.isNaN(id) || !verseId) return;

    try {
      const res = await fetch(this.buildApiUrl(`/api/collections/${id}/verses`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ verse_id: verseId })
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        this.showToast('Added to collection');
        if (window.location.pathname === `/collections/${id}`) {
          this.renderCollectionDetailPage(id);
        }
        return;
      }
      this.showToast(data?.error || 'Failed to add verse');
    } catch (e) {
      console.error('addCurrentVerseToCollection error:', e);
      this.showToast('Failed to add verse');
    }
  }

  async removeVerseFromCollection(collectionId, verseId) {
    const cid = Number(collectionId);
    const vid = Number(verseId);
    if (!cid || Number.isNaN(cid) || !vid || Number.isNaN(vid)) return;

    try {
      const res = await fetch(this.buildApiUrl(`/api/collections/${cid}/verses/${vid}`), {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        this.showToast('Removed from collection');
        if (window.location.pathname === `/collections/${cid}`) {
          this.renderCollectionDetailPage(cid);
        }
        return;
      }
      this.showToast(data?.error || 'Failed to remove verse');
    } catch (e) {
      console.error('removeVerseFromCollection error:', e);
      this.showToast('Failed to remove verse');
    }
  }

  async createPersonalPrayer(content) {
    const c = String(content || '').trim();
    if (!c) return;

    try {
      const res = await fetch(this.buildApiUrl('/api/personal-prayers'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content: c })
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        this.showToast('Prayer added');
        if (window.location.pathname === '/my-prayers') this.renderMyPrayersPage();
        return;
      }
      this.showToast(data?.error || 'Failed to add prayer');
    } catch (e) {
      console.error('createPersonalPrayer error:', e);
      this.showToast('Failed to add prayer');
    }
  }

  async setPrayerAnswered(prayerId, isAnswered) {
    const id = Number(prayerId);
    if (!id || Number.isNaN(id)) return;

    try {
      const res = await fetch(this.buildApiUrl(`/api/personal-prayers/${id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ is_answered: !!isAnswered })
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        this.showToast(!!isAnswered ? 'Marked answered' : 'Marked unanswered');
        return;
      }
      this.showToast(data?.error || 'Failed to update prayer');
    } catch (e) {
      console.error('setPrayerAnswered error:', e);
      this.showToast('Failed to update prayer');
    }
  }

  async deletePersonalPrayer(prayerId) {
    const id = Number(prayerId);
    if (!id || Number.isNaN(id)) return;
    if (!window.confirm('Delete this prayer?')) return;

    try {
      const res = await fetch(this.buildApiUrl(`/api/personal-prayers/${id}`), {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        this.showToast('Deleted');
        if (window.location.pathname === '/my-prayers') this.renderMyPrayersPage();
        return;
      }
      this.showToast(data?.error || 'Failed to delete prayer');
    } catch (e) {
      console.error('deletePersonalPrayer error:', e);
      this.showToast('Failed to delete prayer');
    }
  }

  async showAddToCollectionModal() {
    if (!this.currentVerse) return;
    if (!this.currentUser) {
      this.showToast('Please login to use collections');
      this.showLoginModal();
      return;
    }

    this.showModal('Add to Collection', `
      <div id="addToCollectionBody" class="space-y-3">
        <div class="text-sm text-gray-600 dark:text-gray-400">Loading collections…</div>
      </div>
    `);

    try {
      const res = await fetch(this.buildApiUrl('/api/collections'), { credentials: 'include' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        const msg = data?.error || 'Unable to load collections.';
        document.getElementById('addToCollectionBody').innerHTML = `<div class="text-sm text-red-600">${this.escapeHtml(msg)}</div>`;
        return;
      }

      const collections = Array.isArray(data.collections) ? data.collections : [];
      const buttons = collections.length
        ? collections.map(c => {
            const name = this.escapeHtml(c.name || 'Untitled');
            return `<button class="w-full btn-secondary text-left" onclick="window.churchTapApp.addCurrentVerseToCollection(${Number(c.id)}); window.churchTapApp.closeModal();">${name}</button>`;
          }).join('')
        : `<div class="text-sm text-gray-600 dark:text-gray-400">No collections yet. Create one from the Collections page.</div>`;

      document.getElementById('addToCollectionBody').innerHTML = `
        <div class="space-y-2">${buttons}</div>
        <button class="w-full btn-primary" onclick="window.churchTapApp.closeModal(); window.churchTapApp.navigate('/collections');">Manage Collections</button>
      `;
    } catch (e) {
      console.error('showAddToCollectionModal error:', e);
      const body = document.getElementById('addToCollectionBody');
      if (body) body.innerHTML = `<div class="text-sm text-red-600">Unable to load collections.</div>`;
    }
  }

  updateFavoriteButton() {
    if (!this.currentVerse) return;
    
    const favoriteBtn = document.querySelector('#favoriteBtn svg');
    if (this.favorites.includes(this.currentVerse.id)) {
      favoriteBtn.style.fill = 'currentColor';
    } else {
      favoriteBtn.style.fill = 'none';
    }
  }

  updateEngagementState() {
    this.updateFavoriteButton();
  }

  async shareVerse() {
    if (!this.currentVerse) return;
    
    const shareData = {
      title: 'Church Tap',
      text: this.currentVerse.content_type === 'text' 
        ? `"${this.plainTextFromVerseText(this.currentVerse.verse_text)}" - ${this.currentVerse.bible_reference || 'Bible'}`
        : `From ${this.currentVerse.bible_reference || 'Bible'}`,
      url: `${window.location.origin}/verse/${this.currentVerse.date}`
    };
    
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        this.trackAnalytics('share', this.currentVerse.id);
      } catch (error) {
        if (error.name !== 'AbortError') {
          this.fallbackShare(shareData);
        }
      }
    } else {
      this.fallbackShare(shareData);
    }
  }

  fallbackShare(shareData) {
    const shareText = `${shareData.text}\n\n${shareData.url}`;
    
    if (navigator.clipboard) {
      navigator.clipboard.writeText(shareText);
      this.showToast('📋 Copied to clipboard!');
    } else {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = shareText;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      this.showToast('📋 Copied to clipboard!');
    }
    
    this.trackAnalytics('share', this.currentVerse.id);
  }

  async downloadVerseImage() {
    if (!this.currentVerse) return;
    
    if (this.currentVerse.content_type === 'image') {
      // Download existing image
      const link = document.createElement('a');
      link.href = this.currentVerse.image_path;
      link.download = `verse-${this.currentVerse.date}.jpg`;
      link.click();
    } else {
      // Generate image from text
      try {
        const response = await fetch('/api/verse/generate-image', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            verse_id: this.currentVerse.id
          })
        });
        
        if (response.ok) {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `verse-${this.currentVerse.date}.png`;
          link.click();
          window.URL.revokeObjectURL(url);
          this.showToast('📸 Image downloaded!');
        }
      } catch (error) {
        console.error('Error generating image:', error);
        this.showToast('Failed to generate image');
      }
    }
    
    this.trackAnalytics('download', this.currentVerse.id);
  }

  async showQRCode() {
    if (!this.currentVerse) return;
    
    try {
      const response = await fetch(`/api/verse/qr/${this.currentVerse.id}`);
      const data = await response.json();
      
      if (data.success) {
        // Show QR code in modal
        this.showModal('QR Code', `
          <div class="text-center">
            <img src="${data.qr_code}" alt="QR Code" class="mx-auto mb-4 w-48 h-48">
            <p class="text-sm text-gray-600 dark:text-gray-400">
              Scan to share this verse
            </p>
          </div>
        `);
      }
    } catch (error) {
      console.error('Error generating QR code:', error);
      this.showToast('Failed to generate QR code');
    }
    
    this.trackAnalytics('qr_code', this.currentVerse.id);
  }

  refreshVerse() {
    // Only refresh on the verse (Today) view.
    if (!this.isVerseRoute(window.location.pathname)) return;
    this.loadVerse(this.currentDate);
    this.showToast('🔄 Refreshed!');
  }

  openSearch() {
    this.showModal('Search Verses', `
      <form id="searchForm" class="space-y-4">
        <div>
          <label for="searchQuery" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Search for verses, references, or topics
          </label>
          <input 
            type="text" 
            id="searchQuery" 
            placeholder="Enter search terms..."
            class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:text-white"
            required
          >
        </div>
        <div class="flex space-x-3">
          <button type="submit" class="flex-1 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg font-medium transition-colors duration-200">
            🔍 Search
          </button>
          <button type="button" onclick="app.closeModal()" class="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 font-medium transition-colors duration-200">
            Cancel
          </button>
        </div>
      </form>
      <div id="searchResults" class="mt-6 hidden">
        <h4 class="font-medium text-gray-800 dark:text-white mb-3">Search Results</h4>
        <div id="searchResultsList" class="space-y-3 max-h-64 overflow-y-auto">
          <!-- Results will be loaded here -->
        </div>
      </div>
    `);

    // Handle search form submission
    document.getElementById('searchForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const query = document.getElementById('searchQuery').value.trim();
      if (query.length >= 2) {
        await this.performSearch(query);
      }
    });
  }

  async performSearch(query) {
    try {
      const response = await fetch(`/api/verses/search?q=${encodeURIComponent(query)}&limit=10`);
      const data = await response.json();
      
      const searchResults = document.getElementById('searchResults');
      const searchResultsList = document.getElementById('searchResultsList');
      
      if (data.success && data.verses.length > 0) {
        searchResultsList.innerHTML = data.verses.map(verse => {
          const safeRef = this.escapeHtml(verse.bible_reference || '');
          const safeDate = this.escapeHtml(verse.date || '');
          const preview = verse.verse_text ? this.plainTextFromVerseText(verse.verse_text) : '';
          const safePreview = preview
            ? this.escapeHtml(preview.substring(0, 100) + (preview.length > 100 ? '...' : ''))
            : '';
          const displayTags = this.getDisplayTags(verse.tags);
          const safeTags = displayTags.length ? this.escapeHtml(displayTags.join(', ')) : '';

          return `
            <div class="p-3 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors" onclick="app.goToDate('${this.escapeHtml(verse.date)}')">
              <div class="font-medium text-sm text-primary-600 dark:text-primary-400 mb-1">${safeRef}</div>
              <div class="text-sm text-gray-600 dark:text-gray-400 mb-1">${safeDate}</div>
              ${safePreview ? `<div class="text-sm text-gray-800 dark:text-gray-200 line-clamp-2">${safePreview}</div>` : ''}
              ${safeTags ? `<div class="text-xs text-gray-500 dark:text-gray-400 mt-1">${safeTags}</div>` : ''}
            </div>
          `;
        }).join('');
        
        searchResults.classList.remove('hidden');
      } else {
        searchResultsList.innerHTML = `
          <div class="text-center py-4 text-gray-500 dark:text-gray-400">
            No verses found for "${query}"
          </div>
        `;
        searchResults.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Search error:', error);
      this.showToast('❌ Search failed. Please try again.');
    }
  }

  goToDate(date) {
    this.closeModal();
    this.currentDate = date;
    this.updateDateDisplay();
    this.loadVerse();
  }

  openFeedback() {
    this.showModal('Send Feedback', `
      <form id="feedbackForm" class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-2">Your feedback:</label>
          <textarea 
            id="feedbackText" 
            rows="4" 
            class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            placeholder="Tell us what you think..."
            required
          ></textarea>
        </div>
        <div class="flex space-x-3">
          <button type="submit" class="btn-primary flex-1">Send Feedback</button>
          <button type="button" onclick="window.churchTapApp.closeModal()" class="btn-secondary">Cancel</button>
        </div>
      </form>
    `);
    
    document.getElementById('feedbackForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const feedback = document.getElementById('feedbackText').value;
      
      try {
        const response = await fetch('/api/feedback', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            feedback: feedback,
            user_token: this.userToken,
            url: window.location.href
          })
        });
        
        if (response.ok) {
          this.closeModal();
          this.showToast('📝 Feedback sent! Thank you!');
        } else {
          this.showToast('Failed to send feedback');
        }
      } catch (error) {
        console.error('Error sending feedback:', error);
        this.showToast('Failed to send feedback');
      }
    });
  }

  showModal(title, content, opts = {}) {
    // Close any existing modal first
    if (this.currentModal) {
      this.closeModal();
    }
    
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
    if (opts && opts.zIndex) {
      modal.style.zIndex = String(opts.zIndex);
    }
    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-lg max-w-md w-full p-6 relative max-h-screen overflow-y-auto">
        <h3 class="text-lg font-semibold mb-4 text-gray-900 dark:text-white">${title}</h3>
        ${content}
      </div>
    `;
    
    modal.addEventListener('click', (e) => {
      // Only close if clicking the backdrop (the modal container itself), not the content
      if (e.target === modal) {
        this.closeModal();
      }
    });
    
    document.body.appendChild(modal);
    this.currentModal = modal;
  }

  closeModal() {
    if (this.currentModal) {
      document.body.removeChild(this.currentModal);
      this.currentModal = null;
    }
  }

  showToast(message, duration = 3000) {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-24 left-1/2 transform -translate-x-1/2 bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-800 px-4 py-2 rounded-lg z-50 animate-slide-up';
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
      if (document.body.contains(toast)) {
        document.body.removeChild(toast);
      }
    }, duration);
  }

  hideSplashScreen() {
    setTimeout(() => {
      const splash = document.getElementById('splash');
      const appShell = document.getElementById('app');
      if (splash) splash.style.display = 'none';
      if (appShell) appShell.classList.remove('hidden');
    }, 1500);
  }

  getUserToken() {
    let token = localStorage.getItem('userToken');
    if (!token) {
      token = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('userToken', token);
    }
    return token;
  }

  // Helper method to add org and tag_id parameters to API URLs
  buildApiUrl(path) {
    try {
      let url = path;
      let hasParams = path.includes('?');
      
      // If logged in, org context is derived server-side from active_organization_id.
      if (this.orgParam && !(this.currentUser && this.membershipContext?.active_organization_id)) {
        const separator = hasParams ? '&' : '?';
        url += `${separator}org=${this.orgParam}`;
        hasParams = true;
      }
      
      if (this.currentTagId) {
        const separator = hasParams ? '&' : '?';
        url += `${separator}tag_id=${this.currentTagId}`;
      }
      
      return url;
    } catch (error) {
      console.error('Error in buildApiUrl:', error);
      return path;
    }
  }

  async refreshFavoritesFromServer() {
    if (!this.currentUser) return false;
    if (!this.membershipContext?.active_organization_id) return false;

    try {
      const res = await fetch(this.buildApiUrl('/api/favorites'), { credentials: 'include' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) return false;

      const favorites = Array.isArray(data.favorites) ? data.favorites : [];
      this.favorites = favorites.map(v => Number(v.id)).filter(v => v && !Number.isNaN(v));
      localStorage.setItem('favorites', JSON.stringify(this.favorites));
      this.updateFavoriteButton();
      return true;
    } catch (e) {
      return false;
    }
  }

  async importLocalFavoritesToServer() {
    if (!this.currentUser) return false;
    if (!this.membershipContext?.active_organization_id) return false;

    const local = JSON.parse(localStorage.getItem('favorites') || '[]');
    const verseIds = Array.isArray(local) ? local.map(v => Number(v)).filter(v => v && !Number.isNaN(v)) : [];
    if (verseIds.length === 0) return true;

    try {
      await fetch(this.buildApiUrl('/api/favorites/import'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ verse_ids: verseIds })
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  async refreshForActiveGroupChange() {
    // Ensure we stop forcing old orgParam once account-driven groups are active.
    if (this.currentUser && this.membershipContext?.active_organization_id) {
      this.orgParam = null;
    }

    // Refresh UI + data that depends on org context.
    this.updateGroupDisplay();
    await this.loadVerse(this.currentDate).catch(() => null);
    await this.loadOrganizationLinks?.();
    await this.initCTA?.();
    await this.loadCommunity(this.currentDate).catch(() => null);
    await this.refreshFavoritesFromServer().catch(() => null);
  }

  getDefaultTranslation() {
    const userT = String(this.currentUser?.preferredTranslation || this.currentUser?.preferences?.preferredTranslation || '').trim();
    if (userT) return userT.toUpperCase();
    try {
      const localT = String(localStorage.getItem('defaultTranslation.v1') || '').trim();
      if (localT) return localT.toUpperCase();
    } catch (e) {}
    return 'NASB';
  }

  getUserPreferredTranslation() {
    // Back-compat: many call sites expect this name.
    return this.getDefaultTranslation();
  }

  async readFullChapter(reference) {
    if (!reference) {
      this.showToast('No Bible reference available');
      return;
    }

    const translation = this.getUserPreferredTranslation();
    return this.readFullChapterInTranslation(reference, translation);
  }

  async readFullChapterInTranslation(reference, translation) {
    if (!reference) {
      this.showToast('No Bible reference available');
      return;
    }

    // Parse the Bible reference to get book and chapter
    const parsedRef = this.parseBibleReference(reference);
    if (!parsedRef) {
      console.log('Could not parse reference for chapter reading:', reference);
      // Fallback to external Bible app/website
      this.openExternalBibleApp(reference, translation);
      return;
    }

    try {
      this.showToast(`Loading full chapter in ${translation}...`);
      
      // Use bolls.life API to fetch the whole chapter
      const bollsTranslation = this.getBollsTranslationId(translation);
      const apiUrl = `https://bolls.life/get-text/${bollsTranslation}/${parsedRef.book}/${parsedRef.chapter}/`;
      console.log('Fetching chapter from bolls.life:', apiUrl);
      
      const response = await fetch(apiUrl);
      console.log('Chapter response status:', response.status);
      
      if (response.ok) {
        const data = await response.json();
        console.log('Chapter data:', data);
        this.showChapterModal(data, reference, translation, { scrollVerse: parsedRef.verse });
      } else {
        console.log('Chapter API failed, falling back to external app');
        this.openExternalBibleApp(reference, translation);
      }
    } catch (error) {
      console.error('Error fetching chapter:', error);
      console.log('Network error, falling back to external app');
      this.openExternalBibleApp(reference, translation);
    }
  }

  openExternalBibleApp(reference, translation) {
    // Clean up the reference for URL encoding
    const cleanRef = reference.replace(/\s+/g, '%20');
    
    // Detect mobile device
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    try {
      if (isMobile) {
        // Try to open Bible app first (YouVersion)
        const youVersionURL = `https://www.bible.com/bible/${this.getTranslationId(translation)}/${cleanRef}`;
        const bibleAppURL = `bible://${cleanRef}`;
        
        // Try native Bible app first, fallback to YouVersion
        window.open(bibleAppURL, '_blank');
        
        // Fallback to YouVersion web if app doesn't open
        setTimeout(() => {
          window.open(youVersionURL, '_blank');
        }, 1000);
      } else {
        // Desktop: use Bible Gateway
        const bibleGatewayURL = `https://www.biblegateway.com/passage/?search=${cleanRef}&version=${translation}`;
        window.open(bibleGatewayURL, '_blank');
      }
      
      this.showToast(`Opening ${reference} in ${translation}...`);
    } catch (error) {
      console.error('Error opening Bible reference:', error);
      this.showToast('Error opening Bible reference');
    }
  }

  getTranslationId(translation) {
    // Map our translations to YouVersion Bible IDs
    const translationIds = {
      'NASB': '100', // NASB1995
      'ESV': '59',   // ESV
      'NIV': '111',  // NIV
      'NLT': '116',  // NLT
      'KJV': '1',    // KJV
      'MSG': '97',   // MSG
      'CSB': '1713'  // CSB
    };
    return translationIds[translation] || translationIds['NASB'];
  }

  getBollsTranslationId(translation) {
    // Map our translations to bolls.life API IDs
    const bollsTranslationIds = {
      'NASB': 'NASB',
      'ESV': 'ESV',
      'NIV': 'NIV',
      'NLT': 'NLT',
      'KJV': 'KJV',
      'MSG': 'MSG',
      'CSB': 'CSB',
      'ASV': 'ASV',
      'WEB': 'WEB'
    };
    return bollsTranslationIds[translation] || bollsTranslationIds['NASB'];
  }

  parseBibleReference(reference) {
    // Parse references like "John 3:16", "1 Corinthians 13:4-8", "Genesis 1:1"
    // Returns {book: number, chapter: number, verse: number} or null if parsing fails
    
    const bookNumbers = {
      'genesis': 1, 'gen': 1,
      'exodus': 2, 'exo': 2, 'exod': 2,
      'leviticus': 3, 'lev': 3,
      'numbers': 4, 'num': 4,
      'deuteronomy': 5, 'deut': 5, 'deu': 5,
      'joshua': 6, 'josh': 6, 'jos': 6,
      'judges': 7, 'judg': 7, 'jdg': 7,
      'ruth': 8, 'rut': 8,
      '1 samuel': 9, '1samuel': 9, '1sam': 9, '1sa': 9,
      '2 samuel': 10, '2samuel': 10, '2sam': 10, '2sa': 10,
      '1 kings': 11, '1kings': 11, '1kgs': 11, '1ki': 11,
      '2 kings': 12, '2kings': 12, '2kgs': 12, '2ki': 12,
      '1 chronicles': 13, '1chronicles': 13, '1chron': 13, '1chr': 13, '1ch': 13,
      '2 chronicles': 14, '2chronicles': 14, '2chron': 14, '2chr': 14, '2ch': 14,
      'ezra': 15, 'ezr': 15,
      'nehemiah': 16, 'neh': 16,
      'esther': 17, 'est': 17,
      'job': 18,
      'psalm': 19, 'psalms': 19, 'psa': 19, 'ps': 19,
      'proverbs': 20, 'prov': 20, 'pro': 20,
      'ecclesiastes': 21, 'eccl': 21, 'ecc': 21,
      'song of solomon': 22, 'song': 22, 'sos': 22,
      'isaiah': 23, 'isa': 23,
      'jeremiah': 24, 'jer': 24,
      'lamentations': 25, 'lam': 25,
      'ezekiel': 26, 'ezek': 26, 'eze': 26,
      'daniel': 27, 'dan': 27,
      'hosea': 28, 'hos': 28,
      'joel': 29, 'joe': 29,
      'amos': 30, 'amo': 30,
      'obadiah': 31, 'obad': 31, 'oba': 31,
      'jonah': 32, 'jon': 32,
      'micah': 33, 'mic': 33,
      'nahum': 34, 'nah': 34,
      'habakkuk': 35, 'hab': 35,
      'zephaniah': 36, 'zeph': 36, 'zep': 36,
      'haggai': 37, 'hag': 37,
      'zechariah': 38, 'zech': 38, 'zec': 38,
      'malachi': 39, 'mal': 39,
      'matthew': 40, 'matt': 40, 'mat': 40,
      'mark': 41, 'mar': 41,
      'luke': 42, 'luk': 42,
      'john': 43, 'joh': 43,
      'acts': 44, 'act': 44,
      'romans': 45, 'rom': 45,
      '1 corinthians': 46, '1corinthians': 46, '1cor': 46, '1co': 46,
      '2 corinthians': 47, '2corinthians': 47, '2cor': 47, '2co': 47,
      'galatians': 48, 'gal': 48,
      'ephesians': 49, 'eph': 49,
      'philippians': 50, 'phil': 50, 'php': 50,
      'colossians': 51, 'col': 51,
      '1 thessalonians': 52, '1thessalonians': 52, '1thess': 52, '1th': 52,
      '2 thessalonians': 53, '2thessalonians': 53, '2thess': 53, '2th': 53,
      '1 timothy': 54, '1timothy': 54, '1tim': 54, '1ti': 54,
      '2 timothy': 55, '2timothy': 55, '2tim': 55, '2ti': 55,
      'titus': 56, 'tit': 56,
      'philemon': 57, 'phlm': 57, 'phm': 57,
      'hebrews': 58, 'heb': 58,
      'james': 59, 'jas': 59,
      '1 peter': 60, '1peter': 60, '1pet': 60, '1pe': 60,
      '2 peter': 61, '2peter': 61, '2pet': 61, '2pe': 61,
      '1 john': 62, '1john': 62, '1joh': 62, '1jn': 62,
      '2 john': 63, '2john': 63, '2joh': 63, '2jn': 63,
      '3 john': 64, '3john': 64, '3joh': 64, '3jn': 64,
      'jude': 65, 'jud': 65,
      'revelation': 66, 'rev': 66
    };

    try {
      // Clean up the reference
      const cleanRef = reference.trim();
      
      // Match patterns like "John 3:16" or "1 Corinthians 13:4"
      const match = cleanRef.match(/^(.+?)\s+(\d+):(\d+)(?:-\d+)?$/i);
      if (!match) return null;
      
      const bookName = match[1].toLowerCase().replace(/\s+/g, ' ').trim();
      const chapter = parseInt(match[2]);
      const verse = parseInt(match[3]);
      
      const bookNum = bookNumbers[bookName];
      if (!bookNum) return null;
      
      return {
        book: bookNum,
        chapter: chapter,
        verse: verse
      };
    } catch (error) {
      console.error('Error parsing Bible reference:', error);
      return null;
    }
  }

  viewInTranslation(reference) {
    if (!reference) {
      this.showToast('No Bible reference available');
      return;
    }

    // Show translation selection modal
    this.showTranslationSelectionModal(reference);
  }

  showTranslationSelectionModal(reference) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
    
    const catalog = (this.translationCatalog && this.translationCatalog.length > 0)
      ? this.translationCatalog
      : [
          { code: 'NASB', name: 'New American Standard Bible' },
          { code: 'ESV', name: 'English Standard Version' },
          { code: 'NIV', name: 'New International Version' },
          { code: 'NLT', name: 'New Living Translation' },
          { code: 'KJV', name: 'King James Version' },
          { code: 'MSG', name: 'The Message' },
          { code: 'CSB', name: 'Christian Standard Bible' },
          { code: 'AMP', name: 'Amplified Bible' },
          { code: 'ASV', name: 'American Standard Version' },
          { code: 'WEB', name: 'World English Bible' }
        ];

    const enabledSet = new Set(this.getEnabledTranslationCodes().map(c => String(c).toUpperCase()));
    const availableTranslations = catalog
      .map(t => ({ code: String(t.code || '').toUpperCase(), name: t.name || String(t.code || '').toUpperCase() }))
      .filter(t => enabledSet.has(t.code));

    if (availableTranslations.length === 0) {
      this.showToast('Bible translations are disabled for this group.');
      return;
    }

    const translationOptions = availableTranslations.map(trans => `
      <button onclick="app.fetchTranslation('${reference}', '${trans.code}'); this.closest('.fixed').remove();" 
              class="w-full text-left p-3 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex justify-between items-center">
        <span class="font-medium">${trans.code}</span>
        <span class="text-sm text-gray-600 dark:text-gray-400">${trans.name}</span>
      </button>
    `).join('');
    
    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-xl max-w-md w-full p-6 max-h-96 overflow-y-auto">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white">📚 Choose Translation</h3>
          <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        <div class="space-y-1">
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-3">Select a Bible translation to view ${reference}:</p>
          ${translationOptions}
        </div>
      </div>
    `;
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });
    
    document.body.appendChild(modal);

    // Study Mode: allow selecting a word to define it
    if (this.isStudyModeEnabled()) {
      const verseContainer = modal.querySelector('.verse-text') || modal;
      this.attachStudyWordSelectionHandlers(verseContainer);
    }
  }

  async fetchTranslation(reference, selectedTranslation) {
    // Parse the Bible reference first
    const parsedRef = this.parseBibleReference(reference);
    if (!parsedRef) {
      console.log('Could not parse reference:', reference);
      // Fallback to Bible Gateway if parsing fails
      const bibleGatewayURL = `https://www.biblegateway.com/passage/?search=${encodeURIComponent(reference)}&version=${selectedTranslation}`;
      window.open(bibleGatewayURL, '_blank');
      this.showToast(`Opening ${reference} in ${selectedTranslation}...`);
      return;
    }
    
    // For KJV, fetch with Strong's numbers
    if (selectedTranslation === 'KJV') {
      try {
        const response = await fetch(`/api/strongs/${parsedRef.book}/${parsedRef.chapter}/${parsedRef.verse}`);
        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            data.reference = reference;
            data.translation_name = 'King James Version';
            this.showStrongsModal(data, selectedTranslation);
            return;
          }
        }
      } catch (error) {
        console.log('Strong\'s API failed, falling back to regular KJV');
      }
    }

    try {
      this.showToast(`Loading ${reference} in ${selectedTranslation}...`);
      
      // Use bolls.life API with correct format: /get-verse/<translation>/<book>/<chapter>/<verse>/
      const bollsTranslation = this.getBollsTranslationId(selectedTranslation);
      const apiUrl = `https://bolls.life/get-verse/${bollsTranslation}/${parsedRef.book}/${parsedRef.chapter}/${parsedRef.verse}/`;
      console.log('Fetching from bolls.life:', apiUrl);
      console.log('Parsed reference:', parsedRef);
      
      const response = await fetch(apiUrl);
      console.log('Bolls.life response status:', response.status);
      
      if (response.ok) {
        const data = await response.json();
        console.log('Bolls.life data:', data);
        // Add the original reference to the response
        data.reference = reference;
        this.showTranslationModal(data, selectedTranslation);
      } else {
        console.log('Bolls.life API failed, falling back to Bible Gateway');
        // Fallback to Bible Gateway if API fails
        const bibleGatewayURL = `https://www.biblegateway.com/passage/?search=${encodeURIComponent(reference)}&version=${selectedTranslation}`;
        window.open(bibleGatewayURL, '_blank');
        this.showToast(`Opening ${reference} in ${selectedTranslation}...`);
      }
    } catch (error) {
      console.error('Error fetching translation:', error);
      console.log('Network error, falling back to Bible Gateway');
      // Fallback to external link
      const bibleGatewayURL = `https://www.biblegateway.com/passage/?search=${encodeURIComponent(reference)}&version=${selectedTranslation}`;
      window.open(bibleGatewayURL, '_blank');
      this.showToast(`Opening ${reference} in ${selectedTranslation}...`);
    }
  }

  showTranslationModal(verseData, translation) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
    
    // Handle bolls.life API response format
    const reference = verseData.reference || verseData.citation || 'Bible Verse';
    const text = verseData.text || verseData.verse_text || verseData.content || 'Verse text not available';
    const translationName = verseData.translation_name || translation;
    
    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-xl max-w-lg w-full p-6 max-h-96 overflow-y-auto">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white">📚 ${translation} Translation</h3>
          <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        <div class="space-y-4">
          <div class="text-sm font-medium text-primary-600 dark:text-primary-400">${reference}</div>
          <blockquote class="verse-text text-gray-800 dark:text-gray-200 leading-relaxed border-l-4 border-primary-500 pl-4 italic size-${this.textSize}">
            ${text}
          </blockquote>
          <div class="text-xs text-gray-500 dark:text-gray-400">${translationName}</div>
        </div>
        <div class="mt-6 flex justify-end space-x-3">
          <button onclick="this.closest('.fixed').remove()" class="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
            Close
          </button>
          <button onclick="app.readFullChapterInTranslation('${reference}', '${translation}')" class="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg">
            📖 Read Full Chapter in ${translation}
          </button>
        </div>
      </div>
    `;
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });
    
    document.body.appendChild(modal);
  }

  showChapterModal(chapterData, reference, translation, options = {}) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4';
    modal.style.zIndex = '9999';
    const scrollVerse = Number.isFinite(Number(options?.scrollVerse)) ? Number(options.scrollVerse) : null;
    
    // Parse reference to get book and chapter for title
    const parsedRef = this.parseBibleReference(reference);
    const chapterTitle = parsedRef ? `Chapter ${parsedRef.chapter}` : 'Bible Chapter';
    
    // Handle bolls.life chapter response - it returns an array of verse objects
    let versesHtml = '';
    if (Array.isArray(chapterData)) {
      versesHtml = chapterData.map(verse => `
        <button type="button"
                class="w-full text-left mb-3 scroll-mt-24 rounded-lg px-2 py-1 -mx-2 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                data-verse-row="1"
                data-book="${parsedRef?.book || ''}"
                data-chapter="${parsedRef?.chapter || ''}"
                data-verse="${verse.verse}">
          <span class="text-sm font-medium text-primary-600 dark:text-primary-400 mr-2">${verse.verse}</span>
          <span class="verse-text text-gray-800 dark:text-gray-200 size-${this.textSize}">${verse.text}</span>
        </button>
      `).join('');
    } else {
      versesHtml = '<p class="text-gray-600 dark:text-gray-400">Chapter text not available</p>';
    }
    
    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-xl w-full max-w-4xl h-full max-h-[85vh] overflow-hidden flex flex-col mx-auto my-4 shadow-2xl">
        <div class="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white">📖 ${reference} - ${translation}</h3>
          <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        <div class="p-4 overflow-y-auto flex-1 min-h-0" data-chapter-scroll>
          <div class="space-y-3 leading-relaxed">
            ${versesHtml}
          </div>
        </div>
        <div class="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-between items-center flex-shrink-0">
          <div class="text-xs text-gray-500 dark:text-gray-400">${translation} Translation</div>
          <button onclick="this.closest('.fixed').remove()" class="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors">
            Close
          </button>
        </div>
      </div>
    `;
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });
    
    document.body.appendChild(modal);

    // Apply any saved highlights for this chapter (best-effort)
    if (parsedRef && Number.isFinite(parsedRef.book) && Number.isFinite(parsedRef.chapter)) {
      this.applyScriptureHighlightsToOpenChapterModal(modal, parsedRef.book, parsedRef.chapter).catch(() => {});
    }

    // Verse click -> action sheet (highlight, note, commentary)
    if (parsedRef && Number.isFinite(parsedRef.book) && Number.isFinite(parsedRef.chapter)) {
      modal.addEventListener('click', (e) => {
        const row = e.target?.closest?.('[data-verse-row="1"]');
        if (!row) return;

        // If user is selecting text, don't hijack.
        const sel = window.getSelection?.();
        if (sel && !sel.isCollapsed && String(sel.toString() || '').trim()) return;

        const book = Number(row.getAttribute('data-book'));
        const chapter = Number(row.getAttribute('data-chapter'));
        const verseNum = Number(row.getAttribute('data-verse'));
        if (!book || !chapter || !verseNum) return;

        const verseTextEl = row.querySelector('.verse-text');
        const verseText = verseTextEl ? String(verseTextEl.textContent || '').trim() : '';
        const ref = `${this.getBookName(book)} ${chapter}:${verseNum}`;
        this.showChapterVerseActionSheet({ book, chapter, verse: verseNum, reference: ref, translation, rowEl: row, text: verseText });
      });
    }

    // Study Mode: allow selecting a word to define it
    if (this.isStudyModeEnabled()) {
      const scrollEl = modal.querySelector('[data-chapter-scroll]') || modal;
      this.attachStudyWordSelectionHandlers(scrollEl);
    }

    if (scrollVerse) {
      // Defer until after layout so scrollIntoView can compute positions.
      requestAnimationFrame(() => {
        const target = modal.querySelector(`[data-verse="${scrollVerse}"]`);
        if (!target) return;
        target.classList.add(
          'bg-primary-50',
          'dark:bg-primary-900/20',
          'ring-1',
          'ring-primary-200',
          'dark:ring-primary-800'
        );
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      });
    }
  }

  async applyScriptureHighlightsToOpenChapterModal(modalEl, book, chapter) {
    if (!modalEl) return;
    if (!this.canUsePrivateVerseTools()) return;
    if (!book || !chapter) return;

    try {
      const res = await fetch(this.buildApiUrl(`/api/scripture-highlights/${book}/${chapter}`), { credentials: 'include' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) return;

      const highlights = Array.isArray(data.highlights) ? data.highlights : [];
      if (highlights.length === 0) return;

      // Build quick lookup by verse number
      const byVerse = new Map();
      for (const h of highlights) {
        const v = Number(h?.verse);
        const k = String(h?.color_key || '').trim().toLowerCase();
        if (v && k) byVerse.set(v, k);
      }

      // Apply styles to matching verse rows
      const rows = Array.from(modalEl.querySelectorAll('[data-verse-row="1"][data-verse]'));
      for (const row of rows) {
        const verseNum = Number(row.getAttribute('data-verse'));
        const key = byVerse.get(verseNum) || null;
        if (key) this.applyChapterVerseHighlightClass(row, key);
        else this.clearChapterVerseHighlightClass(row);
      }
    } catch (e) {
      // ignore
    }
  }

  // ===========================
  // Chapter verse actions (highlight / note / commentary)
  // ===========================

  clearChapterVerseHighlightClass(rowEl) {
    if (!rowEl || !rowEl.classList) return;
    rowEl.classList.remove(
      'ct-verse-hl',
      'ct-verse-hl-yellow',
      'ct-verse-hl-amber',
      'ct-verse-hl-orange',
      'ct-verse-hl-red',
      'ct-verse-hl-pink',
      'ct-verse-hl-purple',
      'ct-verse-hl-blue',
      'ct-verse-hl-green'
    );
  }

  applyChapterVerseHighlightClass(rowEl, colorKey) {
    this.clearChapterVerseHighlightClass(rowEl);
    if (!rowEl || !rowEl.classList) return;
    const key = String(colorKey || '').trim().toLowerCase();
    if (!key) return;
    rowEl.classList.add('ct-verse-hl', `ct-verse-hl-${key}`);
  }

  // Dedicated bottom sheet (for chapter verse taps)
  closeBottomSheet() {
    try {
      if (this._bottomSheetKeyHandler) {
        document.removeEventListener('keydown', this._bottomSheetKeyHandler, true);
      }
    } catch (e) {}
    this._bottomSheetKeyHandler = null;

    const root = this._bottomSheetRoot;
    const panel = this._bottomSheetPanel;
    this._bottomSheetRoot = null;
    this._bottomSheetPanel = null;

    if (!root || !document.body.contains(root)) return;

    try {
      if (panel) panel.style.transform = 'translateY(100%)';
      setTimeout(() => {
        try {
          if (document.body.contains(root)) document.body.removeChild(root);
        } catch (e) {}
      }, 180);
    } catch (e) {
      try { document.body.removeChild(root); } catch (e2) {}
    }
  }

  showBottomSheet(renderHtml, opts = {}) {
    this.closeBottomSheet();

    const zIndex = String(opts?.zIndex || 10000);
    const title = String(opts?.title || '').trim();

    const root = document.createElement('div');
    root.className = 'fixed inset-0 bg-black/40 flex items-end justify-center';
    root.style.zIndex = zIndex;

    const panel = document.createElement('div');
    panel.className = 'w-full max-w-lg bg-white dark:bg-gray-800 rounded-t-2xl shadow-2xl';
    panel.style.transform = 'translateY(100%)';
    panel.style.transition = 'transform 160ms ease-out';

    panel.innerHTML = `
      <div class="px-4 pt-3 pb-6" style="padding-bottom: calc(1.5rem + env(safe-area-inset-bottom));">
        <div class="mx-auto w-10 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600 mb-3"></div>
        ${title ? `<div class="text-sm font-semibold text-gray-900 dark:text-white mb-2">${this.escapeHtml(title)}</div>` : ''}
        <div data-sheet-body>
          ${typeof renderHtml === 'function' ? renderHtml() : String(renderHtml || '')}
        </div>
      </div>
    `;

    root.appendChild(panel);
    document.body.appendChild(root);

    requestAnimationFrame(() => {
      panel.style.transform = 'translateY(0)';
    });

    root.addEventListener('click', (e) => {
      if (e.target === root) this.closeBottomSheet();
    });

    const keyHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeBottomSheet();
      }
    };
    document.addEventListener('keydown', keyHandler, true);

    this._bottomSheetRoot = root;
    this._bottomSheetPanel = panel;
    this._bottomSheetKeyHandler = keyHandler;

    return { root, panel };
  }

  async showChapterVerseActionSheet(ctx) {
    const { book, chapter, verse, reference, rowEl } = ctx || {};
    if (!book || !chapter || !verse) return;

    // If user is selecting text, don't hijack.
    const sel = window.getSelection?.();
    if (sel && !sel.isCollapsed && String(sel.toString() || '').trim()) return;

    // Store row element so highlight UI updates immediately
    this._chapterActiveRowEl = rowEl || null;
    this._chapterActiveRef = { book, chapter, verse, reference };

    const canUsePrivate = this.canUsePrivateVerseTools();

    // Best-effort load current highlight state
    let currentColor = null;
    if (canUsePrivate) {
      try {
        const hlRes = await fetch(this.buildApiUrl(`/api/scripture-highlights/${book}/${chapter}/${verse}`), { credentials: 'include' });
        const hlData = await hlRes.json().catch(() => null);
        currentColor = hlRes.ok && hlData?.success ? (hlData.highlight?.color_key || null) : null;
      } catch (e) {}
    }

    const colors = [
      { key: 'yellow', label: 'Yellow', swatch: 'var(--hl-yellow-bg)' },
      { key: 'amber', label: 'Amber', swatch: 'var(--hl-amber-bg)' },
      { key: 'orange', label: 'Orange', swatch: 'var(--hl-orange-bg)' },
      { key: 'red', label: 'Red', swatch: 'var(--hl-red-bg)' },
      { key: 'pink', label: 'Pink', swatch: 'var(--hl-pink-bg)' },
      { key: 'purple', label: 'Purple', swatch: 'var(--hl-purple-bg)' },
      { key: 'blue', label: 'Blue', swatch: 'var(--hl-blue-bg)' },
      { key: 'green', label: 'Green', swatch: 'var(--hl-green-bg)' }
    ];

    const safeRef = this.escapeHtml(String(reference || ''));

    const render = () => {
      const swatches = colors.map(c => {
        const active = String(currentColor || '') === c.key;
        return `
          <button type="button"
                  class="w-9 h-9 rounded-lg border ${active ? 'border-primary-500' : 'border-gray-200 dark:border-gray-700'} bg-white dark:bg-gray-900/30 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors flex items-center justify-center flex-none"
                  data-sheet-action="color"
                  data-color="${this.escapeHtml(c.key)}"
                  aria-label="Highlight color">
            <span class="inline-block w-6 h-6 rounded-md border border-gray-300 dark:border-gray-600" style="background:${c.swatch};"></span>
          </button>
        `;
      }).join('');

      const disabledHint = !canUsePrivate
        ? `<div class="text-xs text-gray-500 dark:text-gray-400">Login and select an active group to add private notes/highlights.</div>`
        : '';

      const clearBtn = (canUsePrivate && currentColor)
        ? `<button type="button"
                   class="px-3 py-2 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30 text-red-700 dark:text-red-300 transition-colors text-xs"
                   data-sheet-action="clear">
              Clear
            </button>`
        : '';

      return `
        <div class="space-y-3">
          <div class="text-xs text-gray-500 dark:text-gray-400">${safeRef}</div>
          ${disabledHint}
          <div class="grid grid-cols-2 gap-2">
            <button type="button"
                    class="w-full px-4 py-3 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 transition-colors text-left disabled:opacity-50"
                    data-sheet-action="note"
                    ${canUsePrivate ? '' : 'disabled'}>
              Note
            </button>
            <button type="button"
                    class="w-full px-4 py-3 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 transition-colors text-left"
                    data-sheet-action="commentary">
              Commentary
            </button>
          </div>

          <div class="flex items-center gap-2">
            <div class="flex items-center gap-2 overflow-x-auto whitespace-nowrap py-1"
                 style="-ms-overflow-style:none; scrollbar-width:none;">
              ${swatches}
            </div>
            ${clearBtn}
          </div>
        </div>
      `;
    };

    const { panel } = this.showBottomSheet(render, { title: 'Verse', zIndex: 10000 });
    const bodyEl = panel.querySelector('[data-sheet-body]');
    if (!bodyEl) return;

    bodyEl.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('[data-sheet-action]');
      if (!btn) return;
      const action = String(btn.getAttribute('data-sheet-action') || '');

      if (action === 'color') {
        const colorKey = String(btn.getAttribute('data-color') || '').trim().toLowerCase();
        if (!colorKey) return;
        currentColor = colorKey;
        this.setScriptureHighlight(book, chapter, verse, colorKey).catch(() => {});
        this.closeBottomSheet();
        return;
      }
      if (action === 'clear') {
        currentColor = null;
        this.setScriptureHighlight(book, chapter, verse, null).catch(() => {});
        this.closeBottomSheet();
        return;
      }
      if (action === 'note') {
        this.closeBottomSheet();
        this.openScriptureNotes(book, chapter, verse, { zIndex: 10000 }).catch(() => {});
        return;
      }
      if (action === 'commentary') {
        this.closeBottomSheet();
        this.openCommentaryForRef(String(reference || ''), { zIndex: 10000 }).catch(() => {});
        return;
      }
    });
  }

  async showChapterVerseActions(ctx) {
    const { book, chapter, verse, reference, rowEl } = ctx || {};
    if (!book || !chapter || !verse) return;

    if (!this.canUsePrivateVerseTools()) {
      // Still allow commentary for guests (if org feature permits), but highlights/notes are private.
      this.showModal('Verse', `
        <div class="space-y-3">
          <div class="text-sm font-semibold text-gray-900 dark:text-white">${this.escapeHtml(reference || 'Verse')}</div>
          <button class="w-full btn-primary" onclick="window.churchTapApp.openCommentaryForRef('${this.escapeHtml(reference)}')">📖 Open commentary</button>
          <button class="w-full btn-secondary" onclick="window.churchTapApp.closeModal()">Close</button>
        </div>
      `);
      return;
    }

    // Load current highlight state for this scripture verse
    let currentColor = null;
    try {
      const hlRes = await fetch(this.buildApiUrl(`/api/scripture-highlights/${book}/${chapter}/${verse}`), { credentials: 'include' });
      const hlData = await hlRes.json().catch(() => null);
      currentColor = hlRes.ok && hlData?.success ? (hlData.highlight?.color_key || null) : null;
    } catch (e) {}

    // Load notes count
    let noteCount = 0;
    try {
      const nRes = await fetch(this.buildApiUrl(`/api/scripture-notes/${book}/${chapter}/${verse}`), { credentials: 'include' });
      const nData = await nRes.json().catch(() => null);
      const notes = nRes.ok && nData?.success && Array.isArray(nData.notes) ? nData.notes : [];
      noteCount = notes.length;
    } catch (e) {}

    const colors = [
      { key: 'yellow', label: 'Yellow', swatch: 'var(--hl-yellow-bg)' },
      { key: 'amber', label: 'Amber', swatch: 'var(--hl-amber-bg)' },
      { key: 'orange', label: 'Orange', swatch: 'var(--hl-orange-bg)' },
      { key: 'red', label: 'Red', swatch: 'var(--hl-red-bg)' },
      { key: 'pink', label: 'Pink', swatch: 'var(--hl-pink-bg)' },
      { key: 'purple', label: 'Purple', swatch: 'var(--hl-purple-bg)' },
      { key: 'blue', label: 'Blue', swatch: 'var(--hl-blue-bg)' },
      { key: 'green', label: 'Green', swatch: 'var(--hl-green-bg)' }
    ];

    const colorButtons = colors.map(c => {
      const isActive = String(currentColor || '') === c.key;
      return `
        <button class="flex items-center justify-between w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                onclick="window.churchTapApp.setScriptureHighlight(${book}, ${chapter}, ${verse}, '${c.key}')">
          <div class="flex items-center gap-3">
            <span class="inline-block w-5 h-5 rounded-md border border-gray-300 dark:border-gray-600" style="background:${c.swatch};"></span>
            <span class="text-sm text-gray-800 dark:text-gray-200">${c.label}</span>
          </div>
          ${isActive ? `<span class="text-xs font-semibold text-primary-600 dark:text-primary-400">Selected</span>` : `<span class="text-xs text-gray-400">›</span>`}
        </button>
      `;
    }).join('');

    const clearBtn = currentColor
      ? `<button class="w-full px-3 py-2 rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                 onclick="window.churchTapApp.setScriptureHighlight(${book}, ${chapter}, ${verse}, null)">
            Clear highlight
         </button>`
      : '';

    // Store row element so we can update highlight UI immediately
    this._chapterActiveRowEl = rowEl || null;
    this._chapterActiveRef = { book, chapter, verse, reference };

    this.showModal('Verse', `
      <div class="space-y-4">
        <div>
          <div class="text-sm font-semibold text-gray-900 dark:text-white">${this.escapeHtml(reference || '')}</div>
          <div class="text-xs text-gray-500 dark:text-gray-400">${noteCount} note${noteCount === 1 ? '' : 's'}</div>
        </div>

        <div class="space-y-2">
          <button class="w-full btn-secondary" onclick="window.churchTapApp.openScriptureNotes(${book}, ${chapter}, ${verse})">📝 Notes</button>
          <button class="w-full btn-secondary" onclick="window.churchTapApp.openCommentaryForRef('${this.escapeHtml(reference)}')">📖 Open commentary</button>
        </div>

        <div class="pt-2 border-t border-gray-200 dark:border-gray-700">
          <div class="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Highlight</div>
          <div class="space-y-2">${colorButtons}</div>
          ${clearBtn}
        </div>
      </div>
    `);
  }

  async setScriptureHighlight(book, chapter, verse, colorKey) {
    if (!this.canUsePrivateVerseTools()) return;
    try {
      const res = await fetch(this.buildApiUrl(`/api/scripture-highlights/${book}/${chapter}/${verse}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ color_key: colorKey })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        this.showToast(data?.error || 'Failed to update highlight');
        return;
      }

      const key = data.highlight?.color_key || null;
      if (this._chapterActiveRowEl) {
        if (key) this.applyChapterVerseHighlightClass(this._chapterActiveRowEl, key);
        else this.clearChapterVerseHighlightClass(this._chapterActiveRowEl);
      }
    } catch (e) {
      console.error('setScriptureHighlight error:', e);
      this.showToast('Failed to update highlight');
    }
  }

  async openScriptureNotes(book, chapter, verse, opts = {}) {
    if (!this.canUsePrivateVerseTools()) return;
    const ref = `${this.getBookName(book)} ${chapter}:${verse}`;

    // Remember opts so refresh/edit/preview stay above chapter modal if needed
    this._scriptureNotesModalOpts = opts && typeof opts === 'object' ? opts : {};
    const z = Number(this._scriptureNotesModalOpts?.zIndex) || null;
    const zObj = z ? `{ zIndex: ${z} }` : '{}';

    this.showModal('Notes', `
      <div class="space-y-3">
        <div class="text-xs text-gray-500 dark:text-gray-400">Private notes for ${this.escapeHtml(ref)}</div>
        <div class="flex items-center gap-2">
          <button class="btn-primary text-sm" onclick="window.churchTapApp.openScriptureNoteEditor(${book}, ${chapter}, ${verse}, null, ${zObj})">+ New Note</button>
          <button class="btn-secondary text-sm" onclick="window.churchTapApp.refreshScriptureNotesList(${book}, ${chapter}, ${verse})">Refresh</button>
        </div>
        <div id="scriptureNotesList" class="space-y-2">
          <div class="text-sm text-gray-600 dark:text-gray-400">Loading…</div>
        </div>
      </div>
    `, this._scriptureNotesModalOpts);

    await this.refreshScriptureNotesList(book, chapter, verse);
  }

  async refreshScriptureNotesList(book, chapter, verse) {
    const listEl = document.getElementById('scriptureNotesList');
    if (!listEl) return;
    try {
      const z = Number(this._scriptureNotesModalOpts?.zIndex) || null;
      const zObj = z ? `{ zIndex: ${z} }` : '{}';

      const res = await fetch(this.buildApiUrl(`/api/scripture-notes/${book}/${chapter}/${verse}`), { credentials: 'include' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        listEl.innerHTML = `<div class="text-sm text-red-600">${this.escapeHtml(data?.error || 'Unable to load notes')}</div>`;
        return;
      }
      const notes = Array.isArray(data.notes) ? data.notes : [];
      if (notes.length === 0) {
        listEl.innerHTML = `<div class="text-sm text-gray-600 dark:text-gray-400">No notes yet. Add one!</div>`;
        return;
      }
      listEl.innerHTML = notes.map(n => {
        const id = Number(n.id);
        const title = n.created_at ? this.escapeHtml(new Date(n.created_at).toLocaleString()) : 'Note';
        const preview = String(n.body_markdown || '').split('\n').slice(0, 2).join(' ').slice(0, 140);
        const created = n.created_at ? new Date(n.created_at).toLocaleString() : '';
        return `
          <div class="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/30">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="text-sm font-semibold text-gray-900 dark:text-white truncate">${title}</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">${this.escapeHtml(created)}</div>
              </div>
              <div class="flex items-center gap-2">
                <button class="btn-secondary text-xs" onclick="window.churchTapApp.openScriptureNoteEditor(${book}, ${chapter}, ${verse}, ${id}, ${zObj})">Edit</button>
                <button class="px-3 py-2 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30 text-red-700 dark:text-red-300 transition-colors text-xs"
                        onclick="window.churchTapApp.deleteScriptureNote(${id}, ${book}, ${chapter}, ${verse})">Delete</button>
              </div>
            </div>
            ${preview ? `<div class="mt-2 text-sm text-gray-700 dark:text-gray-200">${this.renderInlineMarkdown(preview)}</div>` : ''}
          </div>
        `;
      }).join('');
    } catch (e) {
      console.error('refreshScriptureNotesList error:', e);
      listEl.innerHTML = `<div class="text-sm text-red-600">Unable to load notes.</div>`;
    }
  }

  async previewScriptureNote(noteId, book, chapter, verse, opts = {}) {
    const id = Number(noteId);
    if (!id || Number.isNaN(id)) return;
    const res = await fetch(this.buildApiUrl(`/api/scripture-notes/${book}/${chapter}/${verse}`), { credentials: 'include' });
    const data = await res.json().catch(() => null);
    const notes = res.ok && data?.success && Array.isArray(data.notes) ? data.notes : [];
    const note = notes.find(n => Number(n.id) === id);
    if (!note) return;

    const title = note.created_at ? this.escapeHtml(new Date(note.created_at).toLocaleString()) : 'Note';
    const html = this.markdownToSafeHtml(note.body_markdown || '');

    const useOpts = (opts && typeof opts === 'object' && Object.keys(opts).length)
      ? opts
      : (this._scriptureNotesModalOpts || {});

    this.showModal('Note Preview', `
      <div class="space-y-3">
        <div class="text-sm font-semibold text-gray-900 dark:text-white">${title}</div>
        <div class="text-sm text-gray-700 dark:text-gray-200 leading-relaxed space-y-2">${html || '<p>(empty)</p>'}</div>
        <div class="flex justify-end gap-2">
          <button class="btn-secondary" onclick="window.churchTapApp.closeModal()">Close</button>
        </div>
      </div>
    `, useOpts);
  }

  async openScriptureNoteEditor(book, chapter, verse, noteId = null, opts = {}) {
    let existing = null;
    if (noteId) {
      const res = await fetch(this.buildApiUrl(`/api/scripture-notes/${book}/${chapter}/${verse}`), { credentials: 'include' });
      const data = await res.json().catch(() => null);
      const notes = res.ok && data?.success && Array.isArray(data.notes) ? data.notes : [];
      existing = notes.find(n => Number(n.id) === Number(noteId)) || null;
    }

    const initMarkdown = String(existing?.body_markdown || '');
    const ref = `${this.getBookName(book)} ${chapter}:${verse}`;
    const createdLabel = existing?.created_at ? this.escapeHtml(new Date(existing.created_at).toLocaleString()) : '';

    const useOpts = (opts && typeof opts === 'object' && Object.keys(opts).length)
      ? opts
      : (this._scriptureNotesModalOpts || {});

    this.showModal(noteId ? 'Edit Note' : 'New Note', `
      <div class="space-y-3">
        <div class="text-xs text-gray-500 dark:text-gray-400">Private note for ${this.escapeHtml(ref)}</div>
        ${createdLabel ? `<div class="text-xs text-gray-500 dark:text-gray-400">Created ${createdLabel}</div>` : ''}

        <div class="flex flex-wrap items-center gap-2">
          <button class="btn-secondary text-xs" data-note-format="bold" onmousedown="event.preventDefault()" onclick="window.churchTapApp.noteExec('bold')"><strong>B</strong></button>
          <button class="btn-secondary text-xs" data-note-format="italic" onmousedown="event.preventDefault()" onclick="window.churchTapApp.noteExec('italic')"><em>I</em></button>
          <button class="btn-secondary text-xs" onmousedown="event.preventDefault()" onclick="window.churchTapApp.noteExec('ul')">• List</button>
          <button class="btn-secondary text-xs" onmousedown="event.preventDefault()" onclick="window.churchTapApp.noteExec('quote')">❝ Quote</button>
          <button class="btn-secondary text-xs" data-note-format="code" onmousedown="event.preventDefault()" onclick="window.churchTapApp.noteExec('code')">{ } Code</button>
        </div>

        <div id="noteEditorWrap" class="space-y-2">
          <div id="noteBodyInput"
               contenteditable="true"
               role="textbox"
               aria-label="Note editor"
               class="w-full min-h-[12.5rem] px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm leading-relaxed overflow-y-auto"></div>
          <div class="text-xs text-gray-500 dark:text-gray-400">Tip: Use the toolbar to format as you type.</div>
        </div>

        <div class="flex justify-end gap-2">
          <button class="btn-secondary" onclick="window.churchTapApp.closeModal()">Cancel</button>
          <button class="btn-primary" onclick="window.churchTapApp.saveScriptureNote(${book}, ${chapter}, ${verse}, ${noteId ? Number(noteId) : 'null'})">Save</button>
        </div>
      </div>
    `, useOpts);

    this.setNoteEditorMarkdown(initMarkdown);
    this.attachNoteEditorHandlers();
  }

  async saveScriptureNote(book, chapter, verse, noteId) {
    const editor = this.getNoteEditorEl();
    const body = this.noteEditorHtmlToMarkdown(editor?.innerHTML || '');
    if (!body) {
      this.showToast('Please write something first');
      return;
    }

    try {
      if (noteId) {
        const res = await fetch(this.buildApiUrl(`/api/scripture-notes/${Number(noteId)}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ title: null, body_markdown: body })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          this.showToast(data?.error || 'Failed to save note');
          return;
        }
      } else {
        const res = await fetch(this.buildApiUrl(`/api/scripture-notes/${book}/${chapter}/${verse}`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ title: null, body_markdown: body })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          this.showToast(data?.error || 'Failed to save note');
          return;
        }
      }

      this.showToast('Saved');
      await this.openScriptureNotes(book, chapter, verse, this._scriptureNotesModalOpts || {});
    } catch (e) {
      console.error('saveScriptureNote error:', e);
      this.showToast('Failed to save note');
    }
  }

  async deleteScriptureNote(noteId, book, chapter, verse) {
    const id = Number(noteId);
    if (!id || Number.isNaN(id)) return;
    if (!window.confirm('Delete this note?')) return;

    try {
      const res = await fetch(this.buildApiUrl(`/api/scripture-notes/${id}`), {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        this.showToast(data?.error || 'Failed to delete note');
        return;
      }
      this.showToast('Deleted');
      await this.refreshScriptureNotesList(book, chapter, verse);
    } catch (e) {
      console.error('deleteScriptureNote error:', e);
      this.showToast('Failed to delete note');
    }
  }

  async openCommentaryForRef(reference, opts = {}) {
    const ref = String(reference || '').trim();
    if (!ref) return;

    try {
      const sourceKey = String(this.getDefaultCommentarySourceKey?.() || '').trim();
      const sourceParam = sourceKey ? `&source=${encodeURIComponent(sourceKey)}` : '';
      const res = await fetch(this.buildApiUrl(`/api/commentary/lookup?ref=${encodeURIComponent(ref)}${sourceParam}`), { credentials: 'include' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        this.showToast(data?.error || 'Commentary unavailable');
        return;
      }
      const entry = data.entry;
      if (!entry) {
        this.showToast('No commentary found');
        return;
      }
      const title = this.escapeHtml(entry.reference || ref);
      const bodyHtml = this.sanitizeImportedHtml(entry.content || '');
      const source = this.escapeHtml(entry.source_name || '');

      this.showModal('Commentary', `
        <div class="space-y-3">
          <div class="text-sm font-semibold text-gray-900 dark:text-white">${title}</div>
          ${bodyHtml ? `<div class="text-sm text-gray-700 dark:text-gray-200 leading-relaxed space-y-2">${bodyHtml}</div>` : ''}
          ${source ? `<div class="text-xs text-gray-500 dark:text-gray-400">Source: ${source}</div>` : ''}
          <div class="flex justify-end">
            <button class="btn-secondary" onclick="window.churchTapApp.closeModal()">Close</button>
          </div>
        </div>
      `, opts);
    } catch (e) {
      console.error('openCommentaryForRef error:', e);
      this.showToast('Commentary unavailable');
    }
  }

  showBibleReadModal() {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
    modal.style.zIndex = '9999';

    const preferredTranslation = this.getUserPreferredTranslation();
    const catalog = (this.translationCatalog && this.translationCatalog.length > 0)
      ? this.translationCatalog
      : [
          { code: 'NASB', name: 'New American Standard Bible' },
          { code: 'ESV', name: 'English Standard Version' },
          { code: 'NIV', name: 'New International Version' },
          { code: 'NLT', name: 'New Living Translation' },
          { code: 'KJV', name: 'King James Version' },
          { code: 'MSG', name: 'The Message' },
          { code: 'CSB', name: 'Christian Standard Bible' },
          { code: 'AMP', name: 'Amplified Bible' },
          { code: 'ASV', name: 'American Standard Version' },
          { code: 'WEB', name: 'World English Bible' }
        ];

    const enabledSet = new Set(this.getEnabledTranslationCodes().map(c => String(c).toUpperCase()));
    const availableTranslations = catalog
      .map(t => ({ code: String(t.code || '').toUpperCase(), name: t.name || String(t.code || '').toUpperCase() }))
      .filter(t => enabledSet.has(t.code));

    const translationOptions = availableTranslations.length
      ? availableTranslations.map(t => `<option value="${this.escapeHtml(t.code)}">${this.escapeHtml(t.code)} — ${this.escapeHtml(t.name)}</option>`).join('')
      : `<option value="${this.escapeHtml(preferredTranslation)}">${this.escapeHtml(preferredTranslation)}</option>`;

    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-xl max-w-md w-full p-6 shadow-xl">
        <div class="flex justify-between items-center mb-4">
          <div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">📖 Read</h3>
            <p class="text-sm text-gray-600 dark:text-gray-400">Pick a book, chapter, and verse.</p>
          </div>
          <button type="button" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label="Close"
                  onclick="this.closest('.fixed').remove()">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <form id="bibleReadForm" class="space-y-3">
          <div>
            <label class="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Book</label>
            <input id="readBook" type="text" autocomplete="off" inputmode="text"
                   placeholder="e.g. John or 43"
                   class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100" />
            <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Tip: you can type a book name (e.g. <span class="font-medium">1 Corinthians</span>) or a number (<span class="font-medium">1–66</span>).
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Chapter</label>
              <input id="readChapter" inputmode="numeric" type="number" min="1" step="1"
                     class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                     value="1" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Verse</label>
              <input id="readVerse" inputmode="numeric" type="number" min="1" step="1"
                     class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                     value="1" />
            </div>
          </div>

          <div id="readLimits" class="text-xs text-gray-600 dark:text-gray-400"></div>

          <div>
            <label class="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Translation</label>
            <select id="readTranslation" class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
              ${translationOptions}
            </select>
            ${availableTranslations.length === 0 ? `<div class="mt-1 text-xs text-gray-500 dark:text-gray-400">Translations are disabled for this group (or not configured). Using your default.</div>` : ''}
          </div>

          <div class="pt-2 flex items-center justify-end gap-2">
            <button type="button" class="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                    onclick="this.closest('.fixed').remove()">
              Cancel
            </button>
            <button type="submit" class="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors">
              Read Chapter
            </button>
          </div>
        </form>
      </div>
    `;

    modal.addEventListener('click', (e) => {
      if (e.target === modal) document.body.removeChild(modal);
    });

    document.body.appendChild(modal);

    const bookEl = modal.querySelector('#readBook');
    const chapterEl = modal.querySelector('#readChapter');
    const verseEl = modal.querySelector('#readVerse');
    const translationEl = modal.querySelector('#readTranslation');
    const limitsEl = modal.querySelector('#readLimits');
    const form = modal.querySelector('#bibleReadForm');

    // Defaults: John 3:16 (classic)
    if (bookEl) bookEl.value = 'John';
    if (chapterEl) chapterEl.value = '3';
    if (verseEl) verseEl.value = '16';
    if (translationEl && availableTranslations.length) {
      const preferred = String(preferredTranslation).toUpperCase();
      if (availableTranslations.some(t => t.code === preferred)) translationEl.value = preferred;
    }

    const clampInt = (v, min, max) => {
      const n = parseInt(String(v || ''), 10);
      if (!Number.isFinite(n)) return min;
      return Math.min(max, Math.max(min, n));
    };

    const updateLimits = async () => {
      const bookNum = this.resolveBookNumberFromInput(bookEl?.value);
      if (!bookNum) {
        if (limitsEl) limitsEl.textContent = 'Enter a valid book (name or 1–66).';
        if (chapterEl) chapterEl.removeAttribute('max');
        if (verseEl) verseEl.removeAttribute('max');
        return;
      }

      await this.ensureBibleStructureLoaded();
      const meta = this.bibleStructureByNumber?.[bookNum];
      if (!meta || !Array.isArray(meta.verseCounts) || meta.verseCounts.length === 0) {
        if (limitsEl) limitsEl.textContent = 'Limits unavailable (still can try reading).';
        if (chapterEl) chapterEl.removeAttribute('max');
        if (verseEl) verseEl.removeAttribute('max');
        return;
      }

      const maxChapter = meta.verseCounts.length;
      const newChapter = clampInt(chapterEl?.value, 1, maxChapter);
      if (chapterEl) {
        chapterEl.max = String(maxChapter);
        chapterEl.value = String(newChapter);
      }

      const maxVerse = meta.verseCounts[newChapter - 1] || 1;
      const newVerse = clampInt(verseEl?.value, 1, maxVerse);
      if (verseEl) {
        verseEl.max = String(maxVerse);
        verseEl.value = String(newVerse);
      }

      if (limitsEl) {
        limitsEl.textContent = `${this.getBookName(bookNum)} has ${maxChapter} chapters. Chapter ${newChapter} has ${maxVerse} verses.`;
      }
    };

    // Load metadata and keep max values in sync with user input
    updateLimits().catch(() => {});
    bookEl?.addEventListener('input', () => updateLimits().catch(() => {}));
    chapterEl?.addEventListener('input', () => updateLimits().catch(() => {}));
    verseEl?.addEventListener('input', () => updateLimits().catch(() => {}));

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const book = this.resolveBookNumberFromInput(bookEl?.value);
      const chapter = parseInt(String(chapterEl?.value || '0'), 10);
      const verse = parseInt(String(verseEl?.value || '0'), 10);
      const translation = String(translationEl?.value || preferredTranslation).toUpperCase();

      if (!Number.isFinite(book) || book < 1 || book > 66) {
        this.showToast('Please choose a valid book.');
        return;
      }
      if (!Number.isFinite(chapter) || chapter < 1) {
        this.showToast('Please enter a valid chapter.');
        return;
      }
      if (!Number.isFinite(verse) || verse < 1) {
        this.showToast('Please enter a valid verse.');
        return;
      }

      // Enforce known chapter/verse limits if available
      await this.ensureBibleStructureLoaded();
      const meta = this.bibleStructureByNumber?.[book];
      if (meta?.verseCounts?.length) {
        const maxChapter = meta.verseCounts.length;
        if (chapter > maxChapter) {
          this.showToast(`${this.getBookName(book)} only has ${maxChapter} chapters.`);
          return;
        }
        const maxVerse = meta.verseCounts[chapter - 1] || 1;
        if (verse > maxVerse) {
          this.showToast(`Chapter ${chapter} only has ${maxVerse} verses.`);
          return;
        }
      }

      const reference = `${this.getBookName(book)} ${chapter}:${verse}`;
      modal.remove();
      await this.readFullChapterInTranslation(reference, translation);
    });
  }

  updateTranslationButtons() {
    // Translation buttons now show "View in Translation" and open a selection modal
    // No need to update translation names since users select their preferred translation
  }

  addToRecentlyViewed(verse) {
    const existing = this.recentlyViewed.findIndex(v => v.id === verse.id);
    if (existing !== -1) {
      this.recentlyViewed.splice(existing, 1);
    }
    
    const normalizedVerseText = verse.content_type === 'text' ? this.normalizeVerseText(verse.verse_text) : verse.verse_text;
    const previewText = verse.content_type === 'text'
      ? this.plainTextFromVerseText(verse.verse_text)
      : (verse.bible_reference || '');

    this.recentlyViewed.unshift({
      id: verse.id,
      date: verse.date,
      bible_reference: verse.bible_reference,
      preview: verse.content_type === 'text' 
        ? (previewText.substring(0, 50) + (previewText.length > 50 ? '...' : ''))
        : verse.bible_reference,
      content_type: verse.content_type,
      verse_text: normalizedVerseText,
      image_path: verse.image_path,
      context: verse.context,
      tags: verse.tags
    });
    
    if (this.recentlyViewed.length > 10) {
      this.recentlyViewed = this.recentlyViewed.slice(0, 10);
    }
    
    localStorage.setItem('recentlyViewed', JSON.stringify(this.recentlyViewed));
  }

  async showHistory() {
    try {
      this.showToast('Loading verse history...');
      
      // Fetch last 60 days of verses from the server
      const response = await fetch(this.buildApiUrl('/api/verses/history/60'));
      
      if (!response.ok) {
        throw new Error('Failed to fetch verse history');
      }
      
      const historyData = await response.json();
      
      if (!historyData.verses || historyData.verses.length === 0) {
        this.showToast('No verse history available for the last 60 days');
        return;
      }
      
      this.displayHistoryModal(historyData.verses);
    } catch (error) {
      console.error('Error fetching verse history:', error);
      this.showToast('Error loading verse history');
    }
  }

  displayHistoryModal(verses) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
    
    const historyItems = verses.map((verse, index) => `
      <div class="border-b border-gray-200 dark:border-gray-700 last:border-b-0">
        <button onclick="app.loadHistoryVerse('${verse.date}'); this.closest('.fixed').remove();" 
                class="w-full text-left p-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
          <div class="flex justify-between items-start">
            <div class="flex-1">
              <div class="text-sm font-medium text-primary-600 dark:text-primary-400 mb-1">
                ${verse.bible_reference || 'Bible Verse'}
              </div>
              <div class="text-sm text-gray-800 dark:text-gray-200 mb-2">
                ${verse.content_type === 'text' 
                  ? (verse.verse_text ? (app.plainTextFromVerseText(verse.verse_text).substring(0, 80) + (app.plainTextFromVerseText(verse.verse_text).length > 80 ? '...' : '')) : 'Text verse')
                  : verse.bible_reference || 'Image verse'
                }
              </div>
              <div class="flex justify-between items-center">
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  ${new Date(verse.date).toLocaleDateString()}
                </div>
                ${verse.tags ? (() => {
                  const t = app.getDisplayTags(verse.tags);
                  return t.length ? `<div class="text-xs text-primary-500 dark:text-primary-400">${app.escapeHtml(t[0])}</div>` : '';
                })() : ''}
              </div>
            </div>
            <div class="ml-3 text-lg">
              ${verse.content_type === 'image' ? '🖼️' : '📝'}
            </div>
          </div>
        </button>
      </div>
    `).join('');
    
    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-xl max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col">
        <div class="flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white">🕐 Verse History (60 days)</h3>
          <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        <div class="overflow-y-auto flex-1">
          ${historyItems}
        </div>
        <div class="p-4 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div class="text-xs text-gray-500 dark:text-gray-400 text-center">
            Showing ${verses.length} verses from the last 60 days
          </div>
        </div>
      </div>
    `;
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });
    
    document.body.appendChild(modal);
  }

  async loadHistoryVerse(date) {
    // Navigate to the specific date to load the verse
    this.currentDate = date;
    this.updateDateDisplay(date);
    await this.loadVerse(date);
    this.showToast('Loading verse from history...');
  }

  showVerseSearchModal() {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
    
    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-xl max-w-lg w-full p-6">
        <div class="flex justify-between items-center mb-6">
          <h3 class="text-xl font-semibold text-gray-900 dark:text-white">🔍 Search Verses</h3>
          <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">What would you like to search?</label>
            <div class="grid grid-cols-1 gap-3">
              <!-- Church Tap Verses Search -->
              <button onclick="app.showLocalSearchModal(); this.closest('.fixed').remove();" 
                      class="p-4 border-2 border-primary-200 dark:border-primary-700 rounded-lg hover:border-primary-400 dark:hover:border-primary-500 transition-colors text-left">
                <div class="flex items-start space-x-3">
                  <div class="text-2xl">⛪</div>
                  <div class="flex-1">
                    <h4 class="font-medium text-gray-900 dark:text-white mb-1">Church Tap Verses</h4>
                    <p class="text-sm text-gray-600 dark:text-gray-400">
                      Search through your church's curated verses, tags, references, and commentary
                    </p>
                  </div>
                </div>
              </button>
              
              <!-- Bible Database Search -->
              <button onclick="app.showBibleSearchModal(); this.closest('.fixed').remove();" 
                      class="p-4 border-2 border-blue-200 dark:border-blue-700 rounded-lg hover:border-blue-400 dark:hover:border-blue-500 transition-colors text-left">
                <div class="flex items-start space-x-3">
                  <div class="text-2xl">📖</div>
                  <div class="flex-1">
                    <h4 class="font-medium text-gray-900 dark:text-white mb-1">Entire Bible Database</h4>
                    <p class="text-sm text-gray-600 dark:text-gray-400">
                      Search through all verses in multiple Bible translations
                    </p>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });
    
    document.body.appendChild(modal);
  }

  showStudyToolsModal() {
    if (!this.isStudyModeEnabled()) {
      this.showToast('Turn on Study Mode in Me to unlock Study tools');
      this.navigate('/me');
      return;
    }

    this.showModal('Study Tools', `
      <div class="space-y-5">
        <div class="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/20">
          <div class="flex items-start justify-between gap-3 mb-3">
            <div>
              <div class="text-sm font-semibold text-gray-900 dark:text-white">Dictionary</div>
              <div class="text-xs text-gray-500 dark:text-gray-400">Look up a word</div>
            </div>
          </div>

          <form id="studyDictionaryForm" class="flex items-center gap-2">
            <input id="studyDictionaryTerm" type="text" autocomplete="off"
                   placeholder="e.g. faith"
                   class="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100" />
            <button type="submit" class="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors text-sm whitespace-nowrap">
              Search
            </button>
          </form>

          <div id="studyDictionaryResults" class="mt-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-3 text-sm text-gray-700 dark:text-gray-200 hidden"></div>
        </div>

        <div class="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/20">
          <div class="flex items-start justify-between gap-3 mb-3">
            <div>
              <div class="text-sm font-semibold text-gray-900 dark:text-white">Commentary</div>
              <div class="text-xs text-gray-500 dark:text-gray-400">Look up a verse</div>
            </div>
            <button type="button"
                    class="px-3 py-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors whitespace-nowrap"
                    onclick="window.churchTapApp.lookupCommentaryForReference(window.churchTapApp.currentVerse?.bible_reference)">
              Use today’s verse
            </button>
          </div>

          <form id="studyCommentaryForm" class="flex items-center gap-2">
            <input id="studyCommentaryRef" type="text" autocomplete="off"
                   placeholder="e.g. John 3:16"
                   class="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100" />
            <button type="submit" class="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors text-sm whitespace-nowrap">
              Search
            </button>
          </form>

          <div id="studyCommentaryResults" class="mt-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-3 text-sm text-gray-700 dark:text-gray-200 max-h-64 overflow-y-auto hidden"></div>
        </div>

        <div class="text-xs text-gray-500 dark:text-gray-400">
          Tip: In Read/Translation views, select a single word to see a definition.
        </div>
      </div>
    `);

    // Wire dictionary search
    document.getElementById('studyDictionaryForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const term = String(document.getElementById('studyDictionaryTerm')?.value || '').trim();
      await this.lookupDictionaryTerm(term);
    });

    // Wire commentary search
    document.getElementById('studyCommentaryForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const ref = String(document.getElementById('studyCommentaryRef')?.value || '').trim();
      await this.lookupCommentaryForReference(ref);
    });
  }

  sanitizeImportedHtml(html) {
    const raw = String(html || '');
    if (!raw) return '';

    // Very small allow-list sanitizer: keep basic formatting, remove all attributes.
    // This prevents arbitrary HTML/script execution while still rendering imported markup nicely.
    const allowed = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'UL', 'OL', 'LI', 'SUP', 'SUB', 'BLOCKQUOTE', 'CODE', 'PRE']);

    const tpl = document.createElement('template');
    tpl.innerHTML = raw;

    const walk = (node) => {
      const children = Array.from(node.childNodes || []);
      for (const child of children) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const tag = child.tagName;
          if (!allowed.has(tag)) {
            // Replace disallowed element with its text content (keeps readability).
            const text = document.createTextNode(child.textContent || '');
            child.replaceWith(text);
            continue;
          }

          // Strip all attributes (including event handlers).
          const attrs = Array.from(child.attributes || []);
          for (const a of attrs) child.removeAttribute(a.name);

          walk(child);
        } else if (child.nodeType === Node.COMMENT_NODE) {
          child.remove();
        } else {
          // Text / others: keep
        }
      }
    };

    walk(tpl.content);
    return tpl.innerHTML;
  }

  async lookupDictionaryTerm(term) {
    const resultsEl = document.getElementById('studyDictionaryResults');
    if (resultsEl) {
      resultsEl.textContent = '';
      resultsEl.classList.add('hidden');
    }

    const q = String(term || '').trim();
    if (!q) {
      this.showToast('Type a word to look up');
      return;
    }

    try {
      if (resultsEl) {
        resultsEl.textContent = 'Loading…';
        resultsEl.classList.remove('hidden');
      }
      const res = await fetch(this.buildApiUrl(`/api/dictionary/lookup?term=${encodeURIComponent(q)}`), { credentials: 'include' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        const msg = data?.error || 'Dictionary lookup unavailable';
        if (resultsEl) resultsEl.textContent = msg;
        return;
      }

      const entry = data.entry;
      if (!entry) {
        if (resultsEl) resultsEl.textContent = 'No entry found.';
        return;
      }

      const headword = this.escapeHtml(entry.headword || q);
      const definitionHtml = this.sanitizeImportedHtml(entry.definition || '');
      const source = this.escapeHtml(entry.source_name || '');
      if (resultsEl) {
        resultsEl.innerHTML = `
          <div class="font-semibold">${headword}</div>
          ${definitionHtml ? `<div class="mt-2 leading-relaxed space-y-2">${definitionHtml}</div>` : ''}
          ${source ? `<div class="mt-2 text-xs text-gray-500 dark:text-gray-400">Source: ${source}</div>` : ''}
        `;
      }
    } catch (e) {
      if (resultsEl) resultsEl.textContent = 'Dictionary lookup unavailable';
    }
  }

  async lookupCommentaryForReference(reference) {
    const resultsEl = document.getElementById('studyCommentaryResults');
    if (resultsEl) {
      resultsEl.textContent = '';
      resultsEl.classList.add('hidden');
    }

    const ref = String(reference || '').trim();
    if (!ref) {
      this.showToast('No Bible reference available');
      return;
    }

    try {
      if (resultsEl) {
        resultsEl.textContent = 'Loading…';
        resultsEl.classList.remove('hidden');
      }
      const res = await fetch(this.buildApiUrl(`/api/commentary/lookup?ref=${encodeURIComponent(ref)}`), { credentials: 'include' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        const msg = data?.error || 'Commentary lookup unavailable';
        if (resultsEl) resultsEl.textContent = msg;
        return;
      }

      const entry = data.entry;
      if (!entry) {
        if (resultsEl) resultsEl.textContent = 'No commentary found.';
        return;
      }

      const title = this.escapeHtml(entry.reference || ref);
      const bodyHtml = this.sanitizeImportedHtml(entry.content || '');
      const source = this.escapeHtml(entry.source_name || '');
      if (resultsEl) {
        resultsEl.innerHTML = `
          <div class="font-semibold">${title}</div>
          ${bodyHtml ? `<div class="mt-2 leading-relaxed space-y-2">${bodyHtml}</div>` : ''}
          ${source ? `<div class="mt-3 text-xs text-gray-500 dark:text-gray-400">Source: ${source}</div>` : ''}
        `;
      }
    } catch (e) {
      if (resultsEl) resultsEl.textContent = 'Commentary lookup unavailable';
    }
  }

  showLocalSearchModal() {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
    
    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-xl max-w-lg w-full p-6">
        <div class="flex justify-between items-center mb-6">
          <h3 class="text-xl font-semibold text-gray-900 dark:text-white">⛪ Search Church Tap Verses</h3>
          <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        
        <form id="localSearchForm" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Search for:</label>
            <input 
              type="text" 
              id="localSearchQuery" 
              placeholder="Enter words, phrases, Bible references, or tags..."
              class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
              required
            >
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Searches verse text, Bible references, tags, and commentary from your church's curated content
            </p>
          </div>
          
          <div class="flex justify-end space-x-3 pt-4">
            <button type="button" onclick="this.closest('.fixed').remove()" class="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
              Cancel
            </button>
            <button type="submit" class="px-6 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors">
              🔍 Search
            </button>
          </div>
        </form>
      </div>
    `;
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });
    
    // Add form submit handler
    modal.querySelector('#localSearchForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const query = document.getElementById('localSearchQuery').value.trim();
      
      if (!query) {
        this.showToast('Please enter a search term');
        return;
      }
      
      // Close search modal
      document.body.removeChild(modal);
      
      // Perform local search
      await this.searchLocalVerses(query);
    });
    
    document.body.appendChild(modal);
    
    // Focus on search input
    setTimeout(() => {
      const searchInput = modal.querySelector('#localSearchQuery');
      if (searchInput) searchInput.focus();
    }, 100);
  }

  showBibleSearchModal() {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
    
    const availableTranslations = [
      { code: 'NASB', name: 'New American Standard Bible' },
      { code: 'ESV', name: 'English Standard Version' },
      { code: 'NIV', name: 'New International Version' },
      { code: 'NLT', name: 'New Living Translation' },
      { code: 'KJV', name: 'King James Version' },
      { code: 'MSG', name: 'The Message' },
      { code: 'CSB', name: 'Christian Standard Bible' },
      { code: 'ASV', name: 'American Standard Version' },
      { code: 'WEB', name: 'World English Bible' }
    ];

    const translationOptions = availableTranslations.map(trans => 
      `<option value="${trans.code}">${trans.code} - ${trans.name}</option>`
    ).join('');

    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-xl max-w-lg w-full p-6">
        <div class="flex justify-between items-center mb-6">
          <h3 class="text-xl font-semibold text-gray-900 dark:text-white">📖 Search Bible Database</h3>
          <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        
        <form id="bibleSearchForm" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Search for:</label>
            <input 
              type="text" 
              id="bibleSearchQuery" 
              placeholder="Enter words, phrases, or topics (e.g., 'love', 'peace', 'John 3:16')"
              class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
              required
            >
          </div>
          
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Translation:</label>
            <select 
              id="bibleSearchTranslation" 
              class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
              ${translationOptions}
            </select>
          </div>
          
          <div class="grid grid-cols-2 gap-4">
            <label class="flex items-center space-x-2">
              <input type="checkbox" id="bibleMatchCase" class="rounded">
              <span class="text-sm text-gray-700 dark:text-gray-300">Match case</span>
            </label>
            <label class="flex items-center space-x-2">
              <input type="checkbox" id="bibleMatchWhole" class="rounded">
              <span class="text-sm text-gray-700 dark:text-gray-300">Exact phrase</span>
            </label>
          </div>
          
          <div class="flex justify-end space-x-3 pt-4">
            <button type="button" onclick="this.closest('.fixed').remove()" class="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
              Cancel
            </button>
            <button type="submit" class="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">
              🔍 Search
            </button>
          </div>
        </form>
      </div>
    `;
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });
    
    // Add form submit handler
    modal.querySelector('#bibleSearchForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const query = document.getElementById('bibleSearchQuery').value.trim();
      const translation = document.getElementById('bibleSearchTranslation').value;
      const matchCase = document.getElementById('bibleMatchCase').checked;
      const matchWhole = document.getElementById('bibleMatchWhole').checked;
      
      if (!query) {
        this.showToast('Please enter a search term');
        return;
      }
      
      // Close search modal
      document.body.removeChild(modal);
      
      // Perform Bible search (existing functionality)
      await this.searchVerses(query, translation, matchCase, matchWhole);
    });
    
    // Set default translation to user's preferred one
    const preferredTranslation = this.getUserPreferredTranslation();
    const selectElement = modal.querySelector('#bibleSearchTranslation');
    if (selectElement) {
      selectElement.value = preferredTranslation;
    }
    
    document.body.appendChild(modal);
    
    // Focus on search input
    setTimeout(() => {
      const searchInput = modal.querySelector('#bibleSearchQuery');
      if (searchInput) searchInput.focus();
    }, 100);
  }

  async searchLocalVerses(query) {
    try {
      this.showToast(`Searching Church Tap verses for "${query}"...`);
      
      // Search local verse database via server API (using GET endpoint)
      const searchParams = new URLSearchParams({
        q: query,
        limit: '20',
        offset: '0'
      });
      
      const response = await fetch(`/api/verses/search?${searchParams}`);
      
      if (!response.ok) {
        throw new Error(`Local search API error: ${response.status}`);
      }
      
      const searchResults = await response.json();
      console.log('Local search results:', searchResults);
      
      this.displayLocalSearchResults(searchResults, query);
      
    } catch (error) {
      console.error('Error searching local verses:', error);
      this.showToast('Error searching verses. Please try again.');
    }
  }

  displayLocalSearchResults(results, query) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
    modal.style.zIndex = '9999';
    
    if (!results.verses || results.verses.length === 0) {
      modal.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-xl max-w-md w-full p-6">
          <div class="text-center">
            <div class="text-4xl mb-4">⛪</div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">No Results Found</h3>
            <p class="text-gray-600 dark:text-gray-400 mb-4">
              No Church Tap verses found for "<strong>${query}</strong>"
            </p>
            <div class="flex justify-center space-x-3">
              <button onclick="this.closest('.fixed').remove(); app.showLocalSearchModal();" class="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg">
                Try Another Search
              </button>
              <button onclick="this.closest('.fixed').remove()" class="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
                Close
              </button>
            </div>
          </div>
        </div>
      `;
      
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          document.body.removeChild(modal);
        }
      });
      
      document.body.appendChild(modal);
      return;
    }

    const resultItems = results.verses.map(verse => `
      <div class="border-b border-gray-200 dark:border-gray-700 last:border-b-0">
        <button onclick="app.loadHistoryVerse('${verse.date}'); this.closest('.fixed').remove();" 
                class="w-full text-left p-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
          <div class="mb-1">
            <div class="text-sm font-medium text-primary-600 dark:text-primary-400">
              ${verse.bible_reference || 'Bible Verse'} • ${new Date(verse.date).toLocaleDateString()}
            </div>
          </div>
          <div class="text-sm text-gray-800 dark:text-gray-200 leading-relaxed mb-2">
            ${verse.content_type === 'text' 
              ? (verse.verse_text ? (app.plainTextFromVerseText(verse.verse_text).substring(0, 120) + (app.plainTextFromVerseText(verse.verse_text).length > 120 ? '...' : '')) : 'Text verse')
              : (verse.bible_reference || 'Image verse')
            }
          </div>
          ${verse.context ? `
            <div class="text-xs text-gray-600 dark:text-gray-400 mb-1">
              ${verse.context.substring(0, 100)}...
            </div>
          ` : ''}
          ${verse.tags ? `
            <div class="flex flex-wrap gap-1 mt-1">
              ${app.getDisplayTags(verse.tags).slice(0, 3).map(tag => 
                `<span class="px-2 py-0.5 bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 text-xs rounded-full">${app.escapeHtml(tag)}</span>`
              ).join('')}
            </div>
          ` : ''}
        </button>
      </div>
    `).join('');
    
    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-xl max-w-md w-full h-auto max-h-[70vh] shadow-xl">
        <div class="p-4 border-b border-gray-200 dark:border-gray-700">
          <div class="flex justify-between items-center">
            <div class="flex-1">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">⛪ Church Results</h3>
              <p class="text-sm text-gray-600 dark:text-gray-400">
                "${query}" • ${results.verses.length} verses found
              </p>
            </div>
            <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>
        </div>
        <div class="overflow-y-auto" style="max-height: calc(70vh - 140px);">
          ${resultItems}
        </div>
        <div class="p-3 border-t border-gray-200 dark:border-gray-700">
          <div class="text-xs text-gray-500 dark:text-gray-400 text-center">
            Click any verse to view it
          </div>
        </div>
      </div>
    `;
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });
    
    document.body.appendChild(modal);
  }

  async searchVerses(query, translation, matchCase = false, matchWhole = false, page = 1) {
    try {
      this.showToast(`Searching for "${query}" in ${translation}...`);
      
      // Use bolls.life search API
      const bollsTranslation = this.getBollsTranslationId(translation);
      const searchParams = new URLSearchParams({
        search: query,
        match_case: matchCase.toString(),
        match_whole: matchWhole.toString(),
        page: page.toString(),
        limit: '20'
      });
      
      const apiUrl = `https://bolls.life/v2/find/${bollsTranslation}?${searchParams}`;
      console.log('Searching verses:', apiUrl);
      
      const response = await fetch(apiUrl);
      
      if (!response.ok) {
        throw new Error(`Search API error: ${response.status}`);
      }
      
      const searchResults = await response.json();
      console.log('Search results:', searchResults);
      
      this.displaySearchResults(searchResults, query, translation, matchCase, matchWhole, page);
      
    } catch (error) {
      console.error('Error searching verses:', error);
      this.showToast('Error searching verses. Please try again.');
    }
  }

  displaySearchResults(results, query, translation, matchCase, matchWhole, currentPage) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
    modal.style.zIndex = '9999';
    
    if (!results.results || results.results.length === 0) {
      modal.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-xl max-w-md w-full p-6">
          <div class="text-center">
            <div class="text-4xl mb-4">🔍</div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">No Results Found</h3>
            <p class="text-gray-600 dark:text-gray-400 mb-4">
              No verses found for "<strong>${query}</strong>" in ${translation}
            </p>
            <div class="flex justify-center space-x-3">
              <button onclick="this.closest('.fixed').remove(); app.showVerseSearchModal();" class="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg">
                Try Another Search
              </button>
              <button onclick="this.closest('.fixed').remove()" class="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
                Close
              </button>
            </div>
          </div>
        </div>
      `;
      
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          document.body.removeChild(modal);
        }
      });
      
      document.body.appendChild(modal);
      return;
    }

    const resultItems = results.results.map(verse => `
      <div class="border-b border-gray-200 dark:border-gray-700 last:border-b-0">
        <button onclick="app.viewSearchResult(${verse.book}, ${verse.chapter}, ${verse.verse}, '${translation}'); this.closest('.fixed').remove();" 
                class="w-full text-left p-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
          <div class="mb-1">
            <div class="text-sm font-medium text-primary-600 dark:text-primary-400">
              ${this.getBookName(verse.book)} ${verse.chapter}:${verse.verse}
            </div>
          </div>
          <div class="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
            ${verse.text.replace(/<[^>]*>/g, '').substring(0, 120)}...
          </div>
        </button>
      </div>
    `).join('');

    const hasMorePages = results.total > (currentPage * 20);
    const paginationControls = `
      <div class="flex justify-between items-center text-sm">
        ${currentPage > 1 ? 
          `<button onclick="app.searchVerses('${query}', '${translation}', ${matchCase}, ${matchWhole}, ${currentPage - 1}); this.closest('.fixed').remove();" class="px-3 py-1 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 rounded text-sm">← Prev</button>` 
          : '<div></div>'
        }
        <span class="text-xs text-gray-500 dark:text-gray-400">
          ${results.total} results
        </span>
        ${hasMorePages ? 
          `<button onclick="app.searchVerses('${query}', '${translation}', ${matchCase}, ${matchWhole}, ${currentPage + 1}); this.closest('.fixed').remove();" class="px-3 py-1 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 rounded text-sm">Next →</button>` 
          : '<div></div>'
        }
      </div>
    `;
    
    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-xl max-w-md w-full h-auto max-h-[70vh] shadow-xl">
        <div class="p-4 border-b border-gray-200 dark:border-gray-700">
          <div class="flex justify-between items-center">
            <div class="flex-1">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">🔍 Results</h3>
              <p class="text-sm text-gray-600 dark:text-gray-400">
                "${query}" in ${translation}
              </p>
            </div>
            <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>
        </div>
        <div class="overflow-y-auto" style="max-height: calc(70vh - 140px);">
          ${resultItems}
        </div>
        <div class="p-3 border-t border-gray-200 dark:border-gray-700">
          ${paginationControls}
        </div>
      </div>
    `;
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });
    
    document.body.appendChild(modal);
  }

  async viewSearchResult(book, chapter, verse, translation) {
    // Create a reference string and use existing translation modal
    const reference = `${this.getBookName(book)} ${chapter}:${verse}`;
    this.showToast(`Loading ${reference} in ${translation}...`);
    
    try {
      // Use existing fetchTranslation method
      await this.fetchTranslation(reference, translation);
    } catch (error) {
      console.error('Error loading search result:', error);
      this.showToast('Error loading verse');
    }
  }

  getBookName(bookNumber) {
    const bookNames = {
      1: 'Genesis', 2: 'Exodus', 3: 'Leviticus', 4: 'Numbers', 5: 'Deuteronomy',
      6: 'Joshua', 7: 'Judges', 8: 'Ruth', 9: '1 Samuel', 10: '2 Samuel',
      11: '1 Kings', 12: '2 Kings', 13: '1 Chronicles', 14: '2 Chronicles', 15: 'Ezra',
      16: 'Nehemiah', 17: 'Esther', 18: 'Job', 19: 'Psalm', 20: 'Proverbs',
      21: 'Ecclesiastes', 22: 'Song of Solomon', 23: 'Isaiah', 24: 'Jeremiah', 25: 'Lamentations',
      26: 'Ezekiel', 27: 'Daniel', 28: 'Hosea', 29: 'Joel', 30: 'Amos',
      31: 'Obadiah', 32: 'Jonah', 33: 'Micah', 34: 'Nahum', 35: 'Habakkuk',
      36: 'Zephaniah', 37: 'Haggai', 38: 'Zechariah', 39: 'Malachi',
      40: 'Matthew', 41: 'Mark', 42: 'Luke', 43: 'John', 44: 'Acts',
      45: 'Romans', 46: '1 Corinthians', 47: '2 Corinthians', 48: 'Galatians', 49: 'Ephesians',
      50: 'Philippians', 51: 'Colossians', 52: '1 Thessalonians', 53: '2 Thessalonians',
      54: '1 Timothy', 55: '2 Timothy', 56: 'Titus', 57: 'Philemon', 58: 'Hebrews',
      59: 'James', 60: '1 Peter', 61: '2 Peter', 62: '1 John', 63: '2 John',
      64: '3 John', 65: 'Jude', 66: 'Revelation'
    };
    return bookNames[bookNumber] || `Book ${bookNumber}`;
  }

  async trackAnalytics(action, verseId = null) {
    try {
      // Resolve originating tag id from current app state / storage / URL param
      let originatingTagId = this.currentTagId;
      if (!originatingTagId) {
        try {
          const stored = JSON.parse(localStorage.getItem('nfc_tag_session') || 'null');
          if (stored && stored.tagId) originatingTagId = stored.tagId;
        } catch (_) {}
      }
      if (!originatingTagId) {
        const url = new URL(window.location.href);
        originatingTagId = url.searchParams.get('tag_id') || undefined;
      }

      await fetch('/api/analytics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include cookies in request
        body: JSON.stringify({
          action: action,
          verse_id: verseId,
          user_token: this.userToken,
          timestamp: Date.now(),
          originating_tag_id: originatingTagId
        })
      });
    } catch (error) {
      console.error('Analytics error:', error);
    }
  }

  async logTagScan(tagId) {
    try {
      console.log(`🏷️ Logging tag scan: ${tagId}`);
      await fetch('/api/nfc/scan/' + tagId, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
    } catch (error) {
      console.error('Tag scan logging error:', error);
    }
  }

  checkNotificationPermission() {
    if ('Notification' in window && 'serviceWorker' in navigator) {
      if (Notification.permission === 'default') {
        // Don't ask immediately, wait for user engagement
        setTimeout(() => {
          this.requestNotificationPermission();
        }, 30000); // Wait 30 seconds
      }
    }
  }

  async requestNotificationPermission() {
    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        this.showToast('🔔 Daily notifications enabled!');
        this.scheduleNotifications();
      }
    }
  }

  scheduleNotifications() {
    // Schedule daily notifications at 8 AM
    // This would be handled by the server in a real app
    console.log('Notifications scheduled for daily verse reminders');
  }

  detectNFCSupport() {
    if ('NDEFReader' in window) {
      console.log('NFC supported');
      this.nfcSupported = true;
    } else {
      console.log('NFC not supported');
      this.nfcSupported = false;
    }
  }

  // Tag ID Tracking Functions
  setupTagIdTracking() {
    // If tag_id is in URL (new scan), store it in cookie
    if (this.tagIdParam) {
      console.log(`🏷️ New tag scan detected: ${this.tagIdParam}`);
      this.setTagIdCookie(this.tagIdParam);
      this.currentTagId = this.tagIdParam;
    } else {
      // Check if we have any stored tag sessions
      const lastTagId = this.getLastTagId();
      if (lastTagId) {
        this.currentTagId = lastTagId;
        console.log(`🔄 Returning to previous tag session: ${lastTagId}`);
      }
    }
    
    // Track tag-specific interactions
    if (this.currentTagId) {
      this.trackTagSession();
    }
  }

  setTagIdCookie(tagId) {
    // Set cookie to expire in 10 years (effectively indefinite)
    const expires = new Date();
    expires.setTime(expires.getTime() + (10 * 365 * 24 * 60 * 60 * 1000));
    
    // Store individual tag session data
    const cookieName = `nfc_tag_${tagId}`;
    const sessionData = JSON.stringify({
      tagId: tagId,
      firstSeen: Date.now(),
      lastSeen: Date.now()
    });
    
    document.cookie = `${cookieName}=${sessionData}; expires=${expires.toUTCString()}; path=/; SameSite=Strict`;
    
    // Also set a "last active tag" cookie
    document.cookie = `nfc_last_tag=${tagId}; expires=${expires.toUTCString()}; path=/; SameSite=Strict`;
    
    console.log(`🍪 Tag cookie set for: ${tagId} (persists indefinitely)`);
  }

  getTagIdCookie(tagId) {
    const cookieName = `nfc_tag_${tagId}`;
    const name = `${cookieName}=`;
    const decodedCookie = decodeURIComponent(document.cookie);
    const ca = decodedCookie.split(';');
    
    for(let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === ' ') {
        c = c.substring(1);
      }
      if (c.indexOf(name) === 0) {
        try {
          return JSON.parse(c.substring(name.length, c.length));
        } catch (e) {
          return null;
        }
      }
    }
    return null;
  }

  getLastTagId() {
    const name = "nfc_last_tag=";
    const decodedCookie = decodeURIComponent(document.cookie);
    const ca = decodedCookie.split(';');
    
    for(let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === ' ') {
        c = c.substring(1);
      }
      if (c.indexOf(name) === 0) {
        return c.substring(name.length, c.length);
      }
    }
    return null;
  }

  clearTagIdCookie() {
    if (this.currentTagId) {
      const cookieName = `nfc_tag_${this.currentTagId}`;
      document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Strict`;
      document.cookie = `nfc_last_tag=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Strict`;
      localStorage.removeItem('nfc_tag_session');
      this.currentTagId = null;
      console.log('🗑️ Current tag session cleared');
    }
  }

  removeUrlParameter(url, parameter) {
    const urlParts = url.split('?');
    if (urlParts.length >= 2) {
      const prefix = encodeURIComponent(parameter) + '=';
      const parts = urlParts[1].split(/[&;]/g);
      
      for (let i = parts.length; i-- > 0;) {
        if (parts[i].lastIndexOf(prefix, 0) !== -1) {
          parts.splice(i, 1);
        }
      }
      
      return urlParts[0] + (parts.length > 0 ? '?' + parts.join('&') : '');
    }
    return url;
  }

  trackTagSession() {
    // Track that user is in a tag-based session
    const sessionData = {
      tagId: this.currentTagId,
      orgParam: this.orgParam,
      startTime: Date.now(),
      lastActivity: Date.now(),
      pageViews: 1
    };

    // Load existing session or create new one
    const existingSession = JSON.parse(localStorage.getItem('nfc_tag_session') || 'null');
    if (existingSession && existingSession.tagId === this.currentTagId) {
      sessionData.startTime = existingSession.startTime;
      sessionData.pageViews = (existingSession.pageViews || 0) + 1;
    }

    localStorage.setItem('nfc_tag_session', JSON.stringify(sessionData));
    console.log(`📊 Tag session tracked: ${this.currentTagId} (${sessionData.pageViews} views)`);

    // If this is a new tag session (not returning to existing), log the scan
    if (!existingSession || existingSession.tagId !== this.currentTagId) {
      this.logTagScan(this.currentTagId);
    }
  }

  getTagSession() {
    return JSON.parse(localStorage.getItem('nfc_tag_session') || 'null');
  }

  updateTagSessionUI() {
    const tagSessionInfo = document.getElementById('tagSessionInfo');
    const tagSessionId = document.getElementById('tagSessionId');
    // Menu is now a dedicated page; these elements won't exist on most routes.
    if (!tagSessionInfo || !tagSessionId) return;
    
    if (this.currentTagId) {
      tagSessionInfo.classList.remove('hidden');
      // Keep NFC details hidden from end users; UI just indicates connection.
      tagSessionId.textContent = 'NFC Connected';
    } else {
      tagSessionInfo.classList.add('hidden');
    }
  }

  clearTagSession() {
    if (confirm('Clear your NFC tag session? This will disconnect from the current tag.')) {
      this.clearTagIdCookie();
      localStorage.removeItem('nfc_tag_session');
      this.updateTagSessionUI();
      this.showToast('NFC session cleared');
      
      // Hide menu after action
      this.hideQuickMenu();
    }
  }

  // PWA Install Functions
  setupPWAInstall() {
    window.addEventListener('beforeinstallprompt', (e) => {
      console.log('PWA install prompt available');
      e.preventDefault();
      this.deferredPrompt = e;
      this.showInstallButton();
    });

    window.addEventListener('appinstalled', () => {
      console.log('PWA was installed');
      this.hideInstallButton();
      this.deferredPrompt = null;
    });
  }

  showInstallButton() {
    // Create install button if it doesn't exist
    let installBtn = document.getElementById('installAppBtn');
    if (!installBtn) {
      installBtn = document.createElement('button');
      installBtn.id = 'installAppBtn';
      installBtn.innerHTML = `
        <span class="flex items-center space-x-2">
          <span>📱</span>
          <span>Install App</span>
        </span>
      `;
      installBtn.className = 'w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors text-green-600 dark:text-green-400';
      
      // Add to menu page (preferred). Fallback: legacy quick menu popover if present.
      const mount = document.getElementById('menuInstallInsertPoint') || document.querySelector('#quickMenu .border-t');
      if (mount && mount.parentNode) {
        mount.parentNode.insertBefore(installBtn, mount);
      }
      
      installBtn.addEventListener('click', () => {
        this.installApp();
      });
    }
    installBtn.style.display = 'block';
  }

  hideInstallButton() {
    const installBtn = document.getElementById('installAppBtn');
    if (installBtn) {
      installBtn.style.display = 'none';
    }
  }

  async installApp() {
    if (!this.deferredPrompt) {
      return;
    }

    try {
      this.deferredPrompt.prompt();
      const { outcome } = await this.deferredPrompt.userChoice;
      
      if (outcome === 'accepted') {
        console.log('User accepted the install prompt');
      } else {
        console.log('User dismissed the install prompt');
      }
      
      this.deferredPrompt = null;
      this.hideInstallButton();
    } catch (error) {
      console.error('Install prompt error:', error);
    }
  }

  // Community Functions
  async loadCommunity(date) {
    try {
      const shouldRenderCommunity = window.location.pathname === '/community' || this.isVerseRoute(window.location.pathname);
      const response = await fetch(this.buildApiUrl(`/api/community/${date}`), {
        credentials: 'include'
      });

      // Option B: community is locked unless logged-in + active membership.
      if (response.status === 401) {
        if (shouldRenderCommunity) this.showCommunityLocked('LOGIN_REQUIRED');
        return;
      }
      if (response.status === 403) {
        const errData = await response.json().catch(() => null);
        const code = errData?.code || 'FORBIDDEN';
        if (code === 'NO_ACTIVE_GROUP') {
          if (shouldRenderCommunity) this.showCommunityLocked('NO_ACTIVE_GROUP');
        } else if (code === 'MEMBERSHIP_PENDING') {
          if (shouldRenderCommunity) this.showCommunityLocked('MEMBERSHIP_PENDING');
        } else {
          if (shouldRenderCommunity) this.showCommunityLocked('NOT_A_MEMBER');
        }
        return;
      }

      const data = await response.json();
      
      if (data.success) {
        this.currentCommunity = data.community;
        this.updateCommunityHeader(date);
        if (shouldRenderCommunity) this.displayCommunity(data.community);
      } else {
        this.showEmptyCommunity();
      }
    } catch (error) {
      console.error('Error loading community:', error);
      this.showEmptyCommunity();
    }
  }

  showCommunityLocked(reason) {
    document.getElementById('loadingCommunity').classList.add('hidden');
    document.getElementById('communitySection').classList.remove('hidden');
    document.getElementById('prayerRequestsSection').classList.add('hidden');
    document.getElementById('praiseReportsSection').classList.add('hidden');
    document.getElementById('verseInsightsSection').classList.add('hidden');

    const emptyEl = document.getElementById('emptyCommunity');
    emptyEl.classList.remove('hidden');

    const messageMap = {
      LOGIN_REQUIRED: 'Sign in to join a group and access community features.',
      NO_ACTIVE_GROUP: 'Join a group to access community features.',
      MEMBERSHIP_PENDING: 'Your membership is pending approval. Community will unlock once approved.',
      NOT_A_MEMBER: 'Join a group to access community features.',
      FORBIDDEN: 'Community is locked. Join a group to continue.'
    };

    const msg = messageMap[reason] || messageMap.FORBIDDEN;

    emptyEl.innerHTML = `
      <div class="text-center py-8">
        <div class="text-5xl mb-4">🔒</div>
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Community Locked</h3>
        <p class="text-gray-600 dark:text-gray-400 mb-6">${msg}</p>
        <div class="space-y-3 max-w-xs mx-auto">
          <button class="w-full btn-primary" onclick="window.churchTapApp.showLoginModal()">Sign in / Create account</button>
          <button class="w-full btn-secondary" onclick="window.location.href='/choose-organization'">Join a group</button>
        </div>
      </div>
    `;
  }

  updateCommunityHeader(date) {
    const today = new Date().toISOString().split('T')[0];
    const header = document.getElementById('communityDateHeader');
    if (!header) return;
    
    if (date === today) {
      header.textContent = "Today's Community";
    } else {
      const dateObj = new Date(date + 'T00:00:00');
      const formattedDate = dateObj.toLocaleDateString('en-US', { 
        weekday: 'long', 
        month: 'short', 
        day: 'numeric' 
      });
      header.textContent = `${formattedDate}'s Community`;
    }
  }

  displayCommunity(community) {
    const prayerEnabled = this.isFeatureEnabled('prayer_requests_enabled');
    const praiseEnabled = this.isFeatureEnabled('praise_reports_enabled');
    const insightsEnabled = this.isFeatureEnabled('insights_enabled');

    const prayer_requests = prayerEnabled ? community.prayer_requests : [];
    const praise_reports = praiseEnabled ? community.praise_reports : [];
    const verse_insights = insightsEnabled ? community.verse_insights : [];
    
    const loading = document.getElementById('loadingCommunity');
    const section = document.getElementById('communitySection');
    if (loading) loading.classList.add('hidden');
    if (section) section.classList.remove('hidden');
    
    // Display prayer requests
    if (prayerEnabled && prayer_requests && prayer_requests.length > 0) {
      this.displayPrayerRequests(prayer_requests);
      document.getElementById('prayerRequestsSection')?.classList.remove('hidden');
    } else {
      document.getElementById('prayerRequestsSection')?.classList.add('hidden');
    }
    
    // Display verse insights
    if (insightsEnabled && verse_insights && verse_insights.length > 0) {
      this.displayVerseInsights(verse_insights);
      document.getElementById('verseInsightsSection')?.classList.remove('hidden');
    } else {
      document.getElementById('verseInsightsSection')?.classList.add('hidden');
    }
    
    // Display praise reports
    if (praiseEnabled && praise_reports && praise_reports.length > 0) {
      this.displayPraiseReports(praise_reports);
      document.getElementById('praiseReportsSection')?.classList.remove('hidden');
    } else {
      document.getElementById('praiseReportsSection')?.classList.add('hidden');
    }
    
    // Show empty state if no content
    if ((!prayer_requests || prayer_requests.length === 0) && 
        (!praise_reports || praise_reports.length === 0) && 
        (!verse_insights || verse_insights.length === 0)) {
      document.getElementById('emptyCommunity')?.classList.remove('hidden');
    } else {
      document.getElementById('emptyCommunity')?.classList.add('hidden');
    }
  }

  displayPrayerRequests(prayerRequests) {
    const container = document.getElementById('prayerRequestsList');
    
    container.innerHTML = prayerRequests.map(request => {
      const hasUserPrayed = this.userInteractions[`prayer_${request.id}`];
      
      return `
        <div class="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
          <p class="text-gray-800 dark:text-gray-200 text-sm mb-3 leading-relaxed">${this.escapeHtml(request.content)}</p>
          <div class="flex items-center justify-between">
            <span class="text-xs text-gray-500 dark:text-gray-400">
              ${this.formatTimeAgo(request.created_at)}
            </span>
            <button 
              onclick="window.churchTapApp.prayForRequest(${request.id})" 
              class="flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                hasUserPrayed 
                  ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 cursor-default' 
                  : 'bg-blue-500 hover:bg-blue-600 text-white'
              }"
              ${hasUserPrayed ? 'disabled' : ''}
            >
              <span>🙏</span>
              <span>${hasUserPrayed ? 'Prayed' : 'Pray'}</span>
              <span class="bg-white/20 px-1 rounded">${request.prayer_count || 0}</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  displayVerseInsights(verseInsights) {
    const container = document.getElementById('verseInsightsList');
    
    container.innerHTML = verseInsights.map(insight => {
      const hasUserHearted = this.userInteractions[`insight_${insight.id}`];
      
      return `
        <div class="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4">
          <div class="flex items-start justify-between mb-2">
            <span class="text-xs text-purple-600 dark:text-purple-400 font-medium">${insight.verse_reference || 'Today\'s Verse'}</span>
            <div class="flex items-center space-x-1">
              <button onclick="app.heartInsight(${insight.id}, this)" class="flex items-center space-x-1 text-xs px-2 py-1 rounded-full ${hasUserHearted ? 'bg-red-100 text-red-600 cursor-not-allowed' : 'bg-gray-100 hover:bg-red-100 text-gray-600 hover:text-red-600'} transition-colors" ${hasUserHearted ? 'disabled' : ''}>
                <span>❤️</span>
                <span class="heart-count">${insight.heart_count || 0}</span>
              </button>
            </div>
          </div>
          <p class="text-gray-800 dark:text-gray-200 text-sm mb-3 leading-relaxed">${this.escapeHtml(insight.content)}</p>
          <div class="text-xs text-gray-500">
            ${new Date(insight.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
          </div>
        </div>
      `;
    }).join('');
  }

  displayPraiseReports(praiseReports) {
    const container = document.getElementById('praiseReportsList');
    
    container.innerHTML = praiseReports.map(report => {
      const hasUserCelebrated = this.userInteractions[`celebration_${report.id}`];
      
      return `
        <div class="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4">
          <p class="text-gray-800 dark:text-gray-200 text-sm mb-3 leading-relaxed">${this.escapeHtml(report.content)}</p>
          <div class="flex items-center justify-between">
            <span class="text-xs text-gray-500 dark:text-gray-400">
              ${this.formatTimeAgo(report.created_at)}
            </span>
            <button 
              onclick="window.churchTapApp.celebrateReport(${report.id})" 
              class="flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                hasUserCelebrated 
                  ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-600 dark:text-yellow-300 cursor-default' 
                  : 'bg-yellow-500 hover:bg-yellow-600 text-white'
              }"
              ${hasUserCelebrated ? 'disabled' : ''}
            >
              <span>🎉</span>
              <span>${hasUserCelebrated ? 'Celebrated' : 'Celebrate'}</span>
              <span class="bg-white/20 px-1 rounded">${report.celebration_count || 0}</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  showEmptyCommunity() {
    const loading = document.getElementById('loadingCommunity');
    const section = document.getElementById('communitySection');
    const prayers = document.getElementById('prayerRequestsSection');
    const praise = document.getElementById('praiseReportsSection');
    const empty = document.getElementById('emptyCommunity');
    if (loading) loading.classList.add('hidden');
    if (section) section.classList.remove('hidden');
    if (prayers) prayers.classList.add('hidden');
    if (praise) praise.classList.add('hidden');
    if (empty) empty.classList.remove('hidden');
  }

  showPrayerRequestModal() {
    const allowAnonymous = this.isFeatureEnabled('anonymous_posts_enabled');
    this.showModal('Submit Prayer Request', `
      <form id="prayerRequestForm" class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Prayer request</label>
          <textarea 
            id="prayerRequestText" 
            rows="4" 
            maxlength="500"
            class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none"
            placeholder="Please pray for..."
            required
          ></textarea>
          <div class="text-right text-xs text-gray-500 mt-1">
            <span id="prayerCharCount">0</span>/500 characters
          </div>
        </div>
        ${allowAnonymous ? `
          <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input id="prayerAnonymous" type="checkbox" class="h-4 w-4" checked>
            Post anonymously
          </label>
        ` : ''}
        <div class="flex space-x-3">
          <button type="submit" class="btn-primary flex-1">🙏 Submit Prayer Request</button>
          <button type="button" onclick="window.churchTapApp.closeModal()" class="btn-secondary">Cancel</button>
        </div>
      </form>
    `);
    
    // Character counter
    const textarea = document.getElementById('prayerRequestText');
    const counter = document.getElementById('prayerCharCount');
    textarea.addEventListener('input', () => {
      counter.textContent = textarea.value.length;
    });
    
    // Form submission
    document.getElementById('prayerRequestForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const isAnonymous = allowAnonymous ? !!document.getElementById('prayerAnonymous')?.checked : false;
      this.submitPrayerRequest(textarea.value, isAnonymous);
    });
  }

  showVerseInsightModal() {
    const verseReference = this.currentVerse?.bible_reference || 'Today\'s Verse';
    const allowAnonymous = this.isFeatureEnabled('anonymous_posts_enabled');
    
    this.showModal('Share Verse Insight', `
      <form id="verseInsightForm" class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
            Your insight about: <strong>${verseReference}</strong>
          </label>
          <textarea 
            id="verseInsightText" 
            rows="4" 
            maxlength="500"
            class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 dark:bg-gray-700 dark:text-white resize-none"
            placeholder="Share what this verse means to you, how it applies to your life, or an insight you'd like others to know..."
            required
          ></textarea>
          <div class="text-right text-xs text-gray-500 mt-1">
            <span id="insightCharCount">0</span>/500 characters
          </div>
        </div>
        ${allowAnonymous ? `
          <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input id="insightAnonymous" type="checkbox" class="h-4 w-4" checked>
            Post anonymously
          </label>
        ` : ''}
        <div class="text-xs text-gray-500">
          Insights will appear after moderation.
        </div>
        <div class="flex space-x-3">
          <button type="submit" class="flex-1 text-white px-4 py-2 rounded-lg font-medium transition-colors duration-200 flex items-center justify-center space-x-2" style="background-color: #2563eb !important;">💭 Share Insight</button>
          <button type="button" onclick="window.churchTapApp.closeModal()" class="btn-secondary">Cancel</button>
        </div>
      </form>
    `);

    // Add character counter
    const textarea = document.getElementById('verseInsightText');
    const charCount = document.getElementById('insightCharCount');
    textarea.addEventListener('input', () => {
      charCount.textContent = textarea.value.length;
    });

    // Handle form submission
    document.getElementById('verseInsightForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const content = textarea.value.trim();
      if (content) {
        const isAnonymous = allowAnonymous ? !!document.getElementById('insightAnonymous')?.checked : false;
        this.submitVerseInsight(content, verseReference, isAnonymous);
      }
    });
  }

  showPraiseReportModal() {
    const allowAnonymous = this.isFeatureEnabled('anonymous_posts_enabled');
    this.showModal('Submit Praise Report', `
      <form id="praiseReportForm" class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
            Share what you're celebrating:
          </label>
          <textarea 
            id="praiseReportText" 
            rows="4" 
            maxlength="500"
            class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none"
            placeholder="I'm grateful for..."
            required
          ></textarea>
          <div class="text-right text-xs text-gray-500 mt-1">
            <span id="praiseCharCount">0</span>/500 characters
          </div>
        </div>
        ${allowAnonymous ? `
          <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input id="praiseAnonymous" type="checkbox" class="h-4 w-4" checked>
            Post anonymously
          </label>
        ` : ''}
        <div class="flex space-x-3">
          <button type="submit" class="btn-primary flex-1">🎉 Submit Praise Report</button>
          <button type="button" onclick="window.churchTapApp.closeModal()" class="btn-secondary">Cancel</button>
        </div>
      </form>
    `);
    
    // Character counter
    const textarea = document.getElementById('praiseReportText');
    const counter = document.getElementById('praiseCharCount');
    textarea.addEventListener('input', () => {
      counter.textContent = textarea.value.length;
    });
    
    // Form submission
    document.getElementById('praiseReportForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const isAnonymous = allowAnonymous ? !!document.getElementById('praiseAnonymous')?.checked : false;
      this.submitPraiseReport(textarea.value, isAnonymous);
    });
  }

  async submitPrayerRequest(content, is_anonymous = false) {
    try {
      const response = await fetch(this.buildApiUrl('/api/prayer-request'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: content,
          user_token: this.userToken,
          date: this.currentDate,
          is_anonymous: !!is_anonymous
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.closeModal();
        this.showToast('🙏 Prayer request submitted!');
        this.loadCommunity(this.currentDate); // Reload community
        this.trackAnalytics('prayer_request_submitted');
      } else {
        this.showToast(data.error || 'Failed to submit prayer request', 'error');
      }
    } catch (error) {
      console.error('Error submitting prayer request:', error);
      this.showToast('Connection error', 'error');
    }
  }

  async submitVerseInsight(content, verseReference, is_anonymous = false) {
    try {
      const response = await fetch(this.buildApiUrl('/api/verse-community'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content,
          verse_reference: verseReference,
          user_token: this.userToken,
          date: this.currentDate || new Date().toISOString().split('T')[0],
          is_anonymous: !!is_anonymous
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.closeModal();
        this.showToast('💭 Verse insight submitted!');
        this.loadCommunity(this.currentDate); // Reload community
        this.trackAnalytics('verse_insight_submitted');
      } else {
        this.showToast(data.error || 'Failed to submit insight', 'error');
      }
    } catch (error) {
      console.error('Error submitting verse insight:', error);
      this.showToast('Connection error', 'error');
    }
  }

  async submitPraiseReport(content, is_anonymous = false) {
    try {
      const response = await fetch(this.buildApiUrl('/api/praise-report'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: content,
          user_token: this.userToken,
          date: this.currentDate,
          is_anonymous: !!is_anonymous
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.closeModal();
        this.showToast('🎉 Praise report submitted!');
        this.loadCommunity(this.currentDate); // Reload community
        this.trackAnalytics('praise_report_submitted');
      } else {
        this.showToast(data.error || 'Failed to submit praise report', 'error');
      }
    } catch (error) {
      console.error('Error submitting praise report:', error);
      this.showToast('Connection error', 'error');
    }
  }

  async prayForRequest(prayerRequestId) {
    try {
      const response = await fetch(this.buildApiUrl('/api/prayer-request/pray'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prayer_request_id: prayerRequestId,
          user_token: this.userToken
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        // Mark as prayed in local storage
        this.userInteractions[`prayer_${prayerRequestId}`] = true;
        localStorage.setItem('userInteractions', JSON.stringify(this.userInteractions));
        
        // Reload community to show updated counts
        this.loadCommunity(this.currentDate);
        
        this.showToast('🙏 Thank you for praying!');
        this.trackAnalytics('prayer_interaction', prayerRequestId);
        navigator.vibrate && navigator.vibrate(25);
      } else {
        this.showToast(data.error || 'Failed to record prayer', 'error');
      }
    } catch (error) {
      console.error('Error praying for request:', error);
      this.showToast('Connection error', 'error');
    }
  }

  async heartInsight(insightId, buttonElement) {
    try {
      const response = await fetch(this.buildApiUrl('/api/verse-community/heart'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          post_id: insightId,
          user_token: this.userToken
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        const heartCountEl = buttonElement.querySelector('.heart-count');
        heartCountEl.textContent = data.heart_count;
        
        // Update button state
        buttonElement.classList.remove('hover:bg-red-100', 'text-gray-600', 'hover:text-red-600');
        buttonElement.classList.add('bg-red-100', 'text-red-600', 'cursor-not-allowed');
        buttonElement.disabled = true;
        
        // Track interaction
        this.userInteractions[`insight_${insightId}`] = true;
        this.saveUserInteractions();
        
        this.showToast('❤️');
        this.trackAnalytics('insight_hearted');
      } else {
        this.showToast(data.error || 'Already hearted!', 'info');
      }
    } catch (error) {
      console.error('Error hearting insight:', error);
      this.showToast('Connection error', 'error');
    }
  }

  async celebrateReport(praiseReportId) {
    try {
      const response = await fetch(this.buildApiUrl('/api/praise-report/celebrate'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          praise_report_id: praiseReportId,
          user_token: this.userToken
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        // Mark as celebrated in local storage
        this.userInteractions[`celebration_${praiseReportId}`] = true;
        localStorage.setItem('userInteractions', JSON.stringify(this.userInteractions));
        
        // Reload community to show updated counts
        this.loadCommunity(this.currentDate);
        
        this.showToast('🎉 Celebration added!');
        this.trackAnalytics('celebration_interaction', praiseReportId);
        navigator.vibrate && navigator.vibrate(25);
      } else {
        this.showToast(data.error || 'Failed to record celebration', 'error');
      }
    } catch (error) {
      console.error('Error celebrating report:', error);
      this.showToast('Connection error', 'error');
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  formatTimeAgo(timestamp) {
    const now = new Date();
    const time = new Date(timestamp);
    const diffMs = now - time;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return time.toLocaleDateString();
  }

  // Authentication Functions
  normalizeUser(user) {
    if (!user) return user;
    const prefs = user.preferences || {};

    const interests = Array.isArray(user.interests)
      ? user.interests
      : (Array.isArray(prefs.interests) ? prefs.interests : []);

    const struggles = Array.isArray(user.struggles)
      ? user.struggles
      : (Array.isArray(prefs.struggles) ? prefs.struggles : []);

    return {
      ...user,
      // Keep original nested object if present, but also expose fields at top-level
      // because the UI code expects these keys on `currentUser`.
      lifeStage: user.lifeStage ?? prefs.lifeStage ?? null,
      prayerFrequency: user.prayerFrequency ?? prefs.prayerFrequency ?? null,
      preferredTranslation: user.preferredTranslation ?? prefs.preferredTranslation ?? null,
      defaultCommentarySourceKey: user.defaultCommentarySourceKey ?? prefs.defaultCommentarySourceKey ?? null,
      defaultDictionarySourceKey: user.defaultDictionarySourceKey ?? prefs.defaultDictionarySourceKey ?? null,
      studyModeEnabled: user.studyModeEnabled ?? prefs.studyModeEnabled,
      interests,
      struggles
    };
  }

  async refreshCurrentUserFromServer() {
    const response = await fetch(this.buildApiUrl('/api/auth/me'), { credentials: 'include' });
    if (!response.ok) return false;
    const data = await response.json().catch(() => null);
    if (!data?.success) return false;
    this.currentUser = this.normalizeUser(data.user);
    this.syncStudyModeFromUser?.();
    this.syncStudyDefaultsFromUser?.();
    this.updateTranslationButtons();
    return true;
  }

  async checkAuthStatus() {
    try {
      const response = await fetch(this.buildApiUrl('/api/auth/me'), {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          this.currentUser = this.normalizeUser(data.user);
          this.syncStudyModeFromUser?.();
          this.syncStudyDefaultsFromUser?.();
          this.updateUIForLoggedInUser();
          // Load memberships + active group for group switcher/community gating UI
          this.membershipContext = await this.fetchMembershipContext();
          this.adminOrganizations = await this.fetchAdminOrganizations();
          this.updateGroupDisplay();
          this.updateVersePrivateToolsVisibility();
          // Sync favorites for the active group
          this.refreshFavoritesFromServer().catch(() => {});
        } else {
          this.updateUIForLoggedOutUser();
        }
      } else {
        this.updateUIForLoggedOutUser();
      }
    } catch (error) {
      console.error('Auth check error:', error);
      this.updateUIForLoggedOutUser();
    }
  }

  updateUIForLoggedInUser() {
    // Show logged in elements (safely handle missing elements)
    const loginBtn = document.getElementById('loginBtn');
    const userMenuBtn = document.getElementById('userMenuBtn');
    const userMenuItems = document.getElementById('userMenuItems');
    const guestMenuItems = document.getElementById('guestMenuItems');
    
    if (loginBtn) loginBtn.classList.add('hidden');
    if (userMenuBtn) userMenuBtn.classList.remove('hidden');
    if (userMenuItems) userMenuItems.classList.remove('hidden');
    if (guestMenuItems) guestMenuItems.classList.add('hidden');

    // Update user avatar with initials
    if (this.currentUser) {
      const initials = this.getUserInitials(this.currentUser);
      const userAvatar = document.getElementById('userAvatar');
      if (userAvatar) userAvatar.textContent = initials;
    }
    
    // Update translation button labels with user preferences
    this.updateTranslationButtons();
  }

  updateUIForLoggedOutUser() {
    // Show logged out elements (safely handle missing elements)
    const loginBtn = document.getElementById('loginBtn');
    const userMenuBtn = document.getElementById('userMenuBtn');
    const userMenuItems = document.getElementById('userMenuItems');
    const guestMenuItems = document.getElementById('guestMenuItems');
    
    if (loginBtn) loginBtn.classList.remove('hidden');
    if (userMenuBtn) userMenuBtn.classList.add('hidden');
    if (userMenuItems) userMenuItems.classList.add('hidden');
    if (guestMenuItems) guestMenuItems.classList.remove('hidden');
    
    this.currentUser = null;
    this.updateVersePrivateToolsVisibility();
  }

  getUserInitials(user) {
    const firstName = user.firstName || '';
    const lastName = user.lastName || '';
    const displayName = user.displayName || '';
    
    if (firstName && lastName) {
      return (firstName[0] + lastName[0]).toUpperCase();
    } else if (displayName) {
      const names = displayName.split(' ');
      return names.length > 1 ? 
        (names[0][0] + names[names.length - 1][0]).toUpperCase() :
        names[0].substring(0, 2).toUpperCase();
    } else if (user.email) {
      return user.email.substring(0, 2).toUpperCase();
    }
    return 'U';
  }

  showLoginModal() {
    this.showModal('Welcome Back', `
      <form id="loginForm" class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Email</label>
          <input 
            type="email" 
            id="loginEmail" 
            required
            class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            placeholder="your@email.com"
          >
        </div>
        <div>
          <label class="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Password</label>
          <input 
            type="password" 
            id="loginPassword" 
            required
            class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            placeholder="Your password"
          >
        </div>
        <div id="loginError" class="hidden text-red-600 text-sm"></div>
        <div class="flex space-x-3">
          <button type="submit" class="btn-primary flex-1">🔑 Login</button>
          <button type="button" onclick="window.churchTapApp.closeModal()" class="btn-secondary">Cancel</button>
        </div>
        <div class="text-center">
          <button type="button" onclick="window.churchTapApp.closeModal(); window.churchTapApp.showRegisterModal();" class="text-primary-600 dark:text-primary-400 text-sm hover:underline">
            Don't have an account? Create one
          </button>
        </div>
      </form>
    `);

    document.getElementById('loginForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleLogin();
    });
  }

  showRegisterModal() {
    this.showModal('Create Your Account', `
      <form id="registerForm" class="space-y-4">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">First Name</label>
            <input 
              type="text" 
              id="registerFirstName" 
              class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              placeholder="John"
            >
          </div>
          <div>
            <label class="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Last Name</label>
            <input 
              type="text" 
              id="registerLastName" 
              class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              placeholder="Doe"
            >
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Email</label>
          <input 
            type="email" 
            id="registerEmail" 
            required
            class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            placeholder="your@email.com"
          >
        </div>
        <div>
          <label class="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Password</label>
          <input 
            type="password" 
            id="registerPassword" 
            required
            minlength="6"
            class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            placeholder="At least 6 characters"
          >
        </div>
        <div>
          <label class="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Display Name (Optional)</label>
          <input 
            type="text" 
            id="registerDisplayName" 
            class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            placeholder="How others will see you"
          >
        </div>
        <div id="registerError" class="hidden text-red-600 text-sm"></div>
        <div class="flex space-x-3">
          <button type="submit" class="btn-primary flex-1">✨ Create Account</button>
          <button type="button" onclick="window.churchTapApp.closeModal()" class="btn-secondary">Cancel</button>
        </div>
        <div class="text-center">
          <button type="button" onclick="window.churchTapApp.closeModal(); window.churchTapApp.showLoginModal();" class="text-primary-600 dark:text-primary-400 text-sm hover:underline">
            Already have an account? Login
          </button>
        </div>
      </form>
    `);

    document.getElementById('registerForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleRegister();
    });
  }

  async handleLogin() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (data.success) {
        this.currentUser = this.normalizeUser(data.user);
        this.authToken = data.token;
        this.closeModal();
        this.updateUIForLoggedInUser();

        // Hydrate full profile + preferences (best effort) for UI consistency.
        // This also ensures Profile Settings shows the right saved values.
        this.refreshCurrentUserFromServer().catch(() => {});

        // Default post-login flow: if user has no active group, send them to Join Group picker.
        const membershipContext = await this.fetchMembershipContext();
        this.membershipContext = membershipContext;
        this.adminOrganizations = await this.fetchAdminOrganizations().catch(() => ({ organizations: [] }));
        this.updateGroupDisplay();
        const activeOrgId = membershipContext?.active_organization_id;
        if (!activeOrgId) {
          window.location.href = '/choose-organization';
          return;
        }

        // Import any local favorites and then refresh from server
        await this.importLocalFavoritesToServer().catch(() => false);
        await this.refreshFavoritesFromServer().catch(() => false);

        this.showToast('Welcome back! 🙏');
      } else {
        errorEl.textContent = data.error || 'Login failed';
        errorEl.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Login error:', error);
      errorEl.textContent = 'Connection error';
      errorEl.classList.remove('hidden');
    }
  }

  async handleRegister() {
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    const firstName = document.getElementById('registerFirstName').value;
    const lastName = document.getElementById('registerLastName').value;
    const displayName = document.getElementById('registerDisplayName').value;
    const errorEl = document.getElementById('registerError');

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ 
          email, 
          password, 
          firstName, 
          lastName, 
          displayName 
        })
      });

      const data = await response.json();

      if (data.success) {
        this.currentUser = this.normalizeUser(data.user);
        this.authToken = data.token;
        this.closeModal();
        this.updateUIForLoggedInUser();
        this.showToast('Account created! Welcome! ✨');

        // Hydrate full profile + preferences (best effort).
        this.refreshCurrentUserFromServer().catch(() => {});

        // Default post-register flow: send them to Join Group picker (with a Not right now option).
        window.location.href = '/choose-organization';
      } else {
        errorEl.textContent = data.error || 'Registration failed';
        errorEl.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Registration error:', error);
      errorEl.textContent = 'Connection error';
      errorEl.classList.remove('hidden');
    }
  }

  async handleLogout() {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
      
      this.currentUser = null;
      this.authToken = null;
      this.updateUIForLoggedOutUser();
      this.showToast('Logged out successfully');
    } catch (error) {
      console.error('Logout error:', error);
    }
  }

  // Deprecated: onboarding questionnaire was too intrusive on login/register.
  // Keep the method for backwards compatibility, but route to Profile Settings instead.
  showOnboardingModal() {
    this.showToast('You can update preferences in your profile');
    this.showProfileModal();
  }

  showProfileModal() {
    if (!this.currentUser) {
      this.showToast('Please login to view your profile');
      return;
    }

    this.showModal('Profile Settings', `
      <div class="space-y-6">
        <!-- Profile Information -->
        <div>
          <h4 class="text-md font-semibold mb-3 text-gray-900 dark:text-white">Profile Information</h4>
          <form id="profileForm" class="space-y-4">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">First Name</label>
                <input type="text" id="profileFirstName" value="${this.currentUser.firstName || ''}" class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
              </div>
              <div>
                <label class="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Last Name</label>
                <input type="text" id="profileLastName" value="${this.currentUser.lastName || ''}" class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Display Name</label>
              <input type="text" id="profileDisplayName" value="${this.currentUser.displayName || ''}" class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
            </div>
            <div id="profileError" class="hidden text-red-600 text-sm"></div>
            <button type="submit" class="w-full btn-primary">Update Profile</button>
          </form>
        </div>

        <!-- Preferences -->
        <div>
          <h4 class="text-md font-semibold mb-3 text-gray-900 dark:text-white">Personalization Preferences</h4>
          <form id="preferencesForm" class="space-y-4">
            <div>
              <label class="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Life Stage</label>
              <select id="profileLifeStage" class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                <option value="">Select your life stage</option>
                <option value="teen" ${this.currentUser.lifeStage === 'teen' ? 'selected' : ''}>Teen (13-19)</option>
                <option value="young_adult" ${this.currentUser.lifeStage === 'young_adult' ? 'selected' : ''}>Young Adult (20-29)</option>
                <option value="adult" ${this.currentUser.lifeStage === 'adult' ? 'selected' : ''}>Adult (30-49)</option>
                <option value="middle_aged" ${this.currentUser.lifeStage === 'middle_aged' ? 'selected' : ''}>Middle-aged (50-64)</option>
                <option value="senior" ${this.currentUser.lifeStage === 'senior' ? 'selected' : ''}>Senior (65+)</option>
              </select>
            </div>

            <div>
              <label class="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Interests (Select all that apply)</label>
              <div id="profileInterestsGrid" class="grid grid-cols-2 gap-2">
                <label class="flex items-center space-x-2">
                  <input type="checkbox" value="faith_growth" class="rounded" ${(this.currentUser.interests || []).includes('faith_growth') ? 'checked' : ''}>
                  <span class="text-sm">Faith Growth</span>
                </label>
                <label class="flex items-center space-x-2">
                  <input type="checkbox" value="family" class="rounded" ${(this.currentUser.interests || []).includes('family') ? 'checked' : ''}>
                  <span class="text-sm">Family</span>
                </label>
                <label class="flex items-center space-x-2">
                  <input type="checkbox" value="relationships" class="rounded" ${(this.currentUser.interests || []).includes('relationships') ? 'checked' : ''}>
                  <span class="text-sm">Relationships</span>
                </label>
                <label class="flex items-center space-x-2">
                  <input type="checkbox" value="work_career" class="rounded" ${(this.currentUser.interests || []).includes('work_career') ? 'checked' : ''}>
                  <span class="text-sm">Work/Career</span>
                </label>
                <label class="flex items-center space-x-2">
                  <input type="checkbox" value="health" class="rounded" ${(this.currentUser.interests || []).includes('health') ? 'checked' : ''}>
                  <span class="text-sm">Health</span>
                </label>
                <label class="flex items-center space-x-2">
                  <input type="checkbox" value="finances" class="rounded" ${(this.currentUser.interests || []).includes('finances') ? 'checked' : ''}>
                  <span class="text-sm">Finances</span>
                </label>
                <label class="flex items-center space-x-2">
                  <input type="checkbox" value="service" class="rounded" ${(this.currentUser.interests || []).includes('service') ? 'checked' : ''}>
                  <span class="text-sm">Service</span>
                </label>
                <label class="flex items-center space-x-2">
                  <input type="checkbox" value="leadership" class="rounded" ${(this.currentUser.interests || []).includes('leadership') ? 'checked' : ''}>
                  <span class="text-sm">Leadership</span>
                </label>
              </div>
            </div>

            <div>
              <label class="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Current Struggles (Optional)</label>
              <div id="profileStrugglesGrid" class="grid grid-cols-2 gap-2">
                <label class="flex items-center space-x-2">
                  <input type="checkbox" value="anxiety" class="rounded" ${(this.currentUser.struggles || []).includes('anxiety') ? 'checked' : ''}>
                  <span class="text-sm">Anxiety</span>
                </label>
                <label class="flex items-center space-x-2">
                  <input type="checkbox" value="depression" class="rounded" ${(this.currentUser.struggles || []).includes('depression') ? 'checked' : ''}>
                  <span class="text-sm">Depression</span>
                </label>
                <label class="flex items-center space-x-2">
                  <input type="checkbox" value="loneliness" class="rounded" ${(this.currentUser.struggles || []).includes('loneliness') ? 'checked' : ''}>
                  <span class="text-sm">Loneliness</span>
                </label>
                <label class="flex items-center space-x-2">
                  <input type="checkbox" value="grief" class="rounded" ${(this.currentUser.struggles || []).includes('grief') ? 'checked' : ''}>
                  <span class="text-sm">Grief</span>
                </label>
                <label class="flex items-center space-x-2">
                  <input type="checkbox" value="anger" class="rounded" ${(this.currentUser.struggles || []).includes('anger') ? 'checked' : ''}>
                  <span class="text-sm">Anger</span>
                </label>
                <label class="flex items-center space-x-2">
                  <input type="checkbox" value="doubt" class="rounded" ${(this.currentUser.struggles || []).includes('doubt') ? 'checked' : ''}>
                  <span class="text-sm">Doubt</span>
                </label>
                <label class="flex items-center space-x-2">
                  <input type="checkbox" value="addiction" class="rounded" ${(this.currentUser.struggles || []).includes('addiction') ? 'checked' : ''}>
                  <span class="text-sm">Addiction</span>
                </label>
                <label class="flex items-center space-x-2">
                  <input type="checkbox" value="forgiveness" class="rounded" ${(this.currentUser.struggles || []).includes('forgiveness') ? 'checked' : ''}>
                  <span class="text-sm">Forgiveness</span>
                </label>
              </div>
            </div>
            
            <div>
              <label class="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Prayer Frequency</label>
              <select id="profilePrayerFrequency" class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                <option value="">Select frequency</option>
                <option value="multiple_daily" ${this.currentUser.prayerFrequency === 'multiple_daily' ? 'selected' : ''}>Multiple times daily</option>
                <option value="daily" ${this.currentUser.prayerFrequency === 'daily' ? 'selected' : ''}>Daily</option>
                <option value="weekly" ${this.currentUser.prayerFrequency === 'weekly' ? 'selected' : ''}>Weekly</option>
                <option value="occasionally" ${this.currentUser.prayerFrequency === 'occasionally' ? 'selected' : ''}>Occasionally</option>
                <option value="as_needed" ${this.currentUser.prayerFrequency === 'as_needed' ? 'selected' : ''}>As needed</option>
                <option value="rarely" ${this.currentUser.prayerFrequency === 'rarely' ? 'selected' : ''}>Rarely</option>
              </select>
            </div>

            <div>
              <label class="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Preferred Bible Translation</label>
              <select id="profilePreferredTranslation" class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                <option value="NASB" ${this.currentUser.preferredTranslation === 'NASB' ? 'selected' : ''}>NASB - New American Standard Bible</option>
                <option value="ESV" ${this.currentUser.preferredTranslation === 'ESV' ? 'selected' : ''}>ESV - English Standard Version</option>
                <option value="NIV" ${this.currentUser.preferredTranslation === 'NIV' ? 'selected' : ''}>NIV - New International Version</option>
                <option value="NLT" ${this.currentUser.preferredTranslation === 'NLT' ? 'selected' : ''}>NLT - New Living Translation</option>
                <option value="KJV" ${this.currentUser.preferredTranslation === 'KJV' ? 'selected' : ''}>KJV - King James Version</option>
                <option value="MSG" ${this.currentUser.preferredTranslation === 'MSG' ? 'selected' : ''}>MSG - The Message</option>
                <option value="CSB" ${this.currentUser.preferredTranslation === 'CSB' ? 'selected' : ''}>CSB - Christian Standard Bible</option>
              </select>
            </div>
            
            <div id="preferencesError" class="hidden text-red-600 text-sm"></div>
            <button type="submit" class="w-full btn-primary">Update Preferences</button>
          </form>
        </div>

        <!-- Bracelet & Organization -->
        <div id="braceletOrgSection">
          <h4 class="text-md font-semibold mb-3 text-gray-900 dark:text-white">🏷️ Bracelet & Organization</h4>
          <div id="braceletOrgContent" class="space-y-4">
            <div class="text-center text-gray-500 dark:text-gray-400">
              Loading bracelet information...
            </div>
          </div>
        </div>

        <div class="flex space-x-3">
          <button type="button" onclick="window.churchTapApp.closeModal()" class="btn-secondary flex-1">Close</button>
        </div>
      </div>
    `);

    // Add event listeners
    document.getElementById('profileForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleProfileUpdate();
    });

    document.getElementById('preferencesForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handlePreferencesUpdate();
    });

    // Load bracelet information
    this.loadBraceletInfo();
  }

  async handleProfileUpdate() {
    const firstName = document.getElementById('profileFirstName').value;
    const lastName = document.getElementById('profileLastName').value;
    const displayName = document.getElementById('profileDisplayName').value;
    const errorEl = document.getElementById('profileError');

    try {
      const response = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          firstName,
          lastName,
          displayName
        })
      });

      const data = await response.json();

      if (data.success) {
        this.currentUser.firstName = firstName;
        this.currentUser.lastName = lastName;
        this.currentUser.displayName = displayName;
        this.updateUIForLoggedInUser();
        this.showToast('Profile updated successfully! 👤');
        errorEl.classList.add('hidden');
      } else {
        errorEl.textContent = data.error || 'Failed to update profile';
        errorEl.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Profile update error:', error);
      errorEl.textContent = 'Connection error';
      errorEl.classList.remove('hidden');
    }
  }

  async handlePreferencesUpdate() {
    const lifeStage = document.getElementById('profileLifeStage').value;
    const prayerFrequency = document.getElementById('profilePrayerFrequency').value;
    const preferredTranslation = document.getElementById('profilePreferredTranslation').value;
    const errorEl = document.getElementById('preferencesError');

    const interests = Array.from(document.querySelectorAll('#profileInterestsGrid input[type="checkbox"]:checked'))
      .map(cb => cb.value);
    const struggles = Array.from(document.querySelectorAll('#profileStrugglesGrid input[type="checkbox"]:checked'))
      .map(cb => cb.value);

    try {
      const response = await fetch('/api/auth/preferences', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          lifeStage,
          interests,
          struggles,
          prayerFrequency,
          preferredTranslation
        })
      });

      const data = await response.json();

      if (data.success) {
        this.currentUser.lifeStage = lifeStage;
        this.currentUser.interests = interests;
        this.currentUser.struggles = struggles;
        this.currentUser.prayerFrequency = prayerFrequency;
        this.currentUser.preferredTranslation = preferredTranslation;
        this.showToast('Preferences updated successfully! 🎯');
        errorEl.classList.add('hidden');
      } else {
        errorEl.textContent = data.error || 'Failed to update preferences';
        errorEl.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Preferences update error:', error);
      errorEl.textContent = 'Connection error';
      errorEl.classList.remove('hidden');
    }
  }

  
  escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
  
  // STRONG'S NUMBERS METHODS
  
  showStrongsModal(verseData, translation) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
    
    const reference = verseData.reference || 'Bible Verse';
    const text = this.processStrongsNumbers(verseData.verse || verseData.text, reference);
    const translationName = verseData.translation_name || translation;
    
    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white">📚 ${translation} with Strong's Numbers</h3>
          <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        <div class="space-y-4">
          <div class="text-sm font-medium text-primary-600 dark:text-primary-400">${reference}</div>
          <blockquote class="verse-text text-gray-800 dark:text-gray-200 leading-relaxed border-l-4 border-primary-500 pl-4 size-${this.textSize}">
            ${text}
          </blockquote>
          <div class="text-xs text-gray-500 dark:text-gray-400">
            ${translationName} • Click on Strong's numbers (highlighted) to see definitions
          </div>
        </div>
        <div class="mt-6 flex justify-end space-x-3">
          <button onclick="this.closest('.fixed').remove()" class="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
            Close
          </button>
        </div>
      </div>
    `;
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });
    
    document.body.appendChild(modal);
  }
  
  isNewTestamentBook(reference) {
    if (!reference) return false;
    
    // Extract book name from reference (e.g., "Matthew 5:1" -> "Matthew")
    const bookName = reference.split(' ')[0].toLowerCase();
    
    // New Testament books
    const newTestamentBooks = [
      'matthew', 'mark', 'luke', 'john', 'acts',
      'romans', 'corinthians', '1corinthians', '2corinthians',
      'galatians', 'ephesians', 'philippians', 'colossians',
      'thessalonians', '1thessalonians', '2thessalonians',
      'timothy', '1timothy', '2timothy', 'titus', 'philemon',
      'hebrews', 'james', 'peter', '1peter', '2peter',
      'john', '1john', '2john', '3john', 'jude', 'revelation'
    ];
    
    return newTestamentBooks.some(ntBook => 
      bookName.includes(ntBook) || ntBook.includes(bookName)
    );
  }
  
  processStrongsNumbers(text, reference = '') {
    if (!text) return '';
    
    // Determine if this is Old Testament (Hebrew - H) or New Testament (Greek - G)
    const isNewTestament = this.isNewTestamentBook(reference);
    const prefix = isNewTestament ? 'G' : 'H';
    
    // Replace Strong's number tags with clickable elements
    return text.replace(/<S>(\d+)<\/S>/g, (match, number) => {
      const strongsNumber = number.startsWith('H') || number.startsWith('G') ? number : `${prefix}${number}`;
      return `<span class="strongs-number" 
                    style="display: inline-block; background: #fef3c7; color: #92400e; padding: 2px 4px; border-radius: 4px; font-size: 11px; font-family: monospace; cursor: pointer; margin-left: 2px; border: 1px solid #d97706;" 
                    onclick="app.showStrongsDefinition('${strongsNumber}')" 
                    title="Click to see Strong's #${strongsNumber} definition"
                    onmouseover="this.style.background='#fde68a'" 
                    onmouseout="this.style.background='#fef3c7'">
                ${strongsNumber}
              </span>`;
    });
  }
  
  async showStrongsDefinition(strongsNumber) {
    try {
      const response = await fetch(`/api/strongs/definition/${strongsNumber}`);
      const data = await response.json();
      
      if (data.success) {
        this.displayStrongsDefinition(data.definition);
      } else {
        this.showToast('Definition not available');
      }
    } catch (error) {
      console.error('Error fetching Strong\'s definition:', error);
      this.showToast('Network error');
    }
  }
  
  displayStrongsDefinition(definition) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4';
    modal.style.zIndex = '10000';
    
    const languageFlag = definition.language === 'Hebrew' ? '🇮🇱' : '🇬🇷';
    const languageColor = definition.language === 'Hebrew' ? 'text-orange-600' : 'text-blue-600';
    
    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-6">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
            ${languageFlag} Strong's #${definition.number}
          </h3>
          <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        <div class="space-y-3">
          <div class="flex items-center space-x-2">
            <span class="text-sm font-medium ${languageColor}">${definition.language}</span>
            ${definition.transliteration ? `<span class="text-sm italic text-gray-600 dark:text-gray-400">[${definition.transliteration}]</span>` : ''}
            ${definition.phonetics ? `<span class="text-xs text-gray-500 dark:text-gray-500">/${definition.phonetics}/</span>` : ''}
          </div>
          
          ${definition.short_definition ? `
            <div>
              <h4 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Short Definition:</h4>
              <p class="text-sm text-gray-600 dark:text-gray-400">${definition.short_definition}</p>
            </div>
          ` : ''}
          
          <div>
            <h4 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Definition:</h4>
            <p class="text-sm text-gray-600 dark:text-gray-400">${definition.definition}</p>
          </div>
          
          ${definition.outline ? `
            <div>
              <h4 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Lexeme:</h4>
              <p class="text-sm text-gray-600 dark:text-gray-400 font-hebrew">${definition.outline}</p>
            </div>
          ` : ''}
          
          ${definition.kjv_occurrences ? `
            <div class="pt-2 border-t border-gray-200 dark:border-gray-600">
              <span class="text-xs text-gray-500">KJV occurrences: ${definition.kjv_occurrences}</span>
            </div>
          ` : ''}
        </div>
        <div class="mt-4 flex justify-end">
          <button onclick="this.closest('.fixed').remove()" class="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm">
            Close
          </button>
        </div>
      </div>
    `;
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });
    
    document.body.appendChild(modal);
  }

  // Load and display organization links [UPDATED v2]
  async loadOrganizationLinks() {
    try {
      console.log('🔗 [v2] Loading organization links...');
      const url = this.withOrg('/api/organization/links');
      console.log('🔗 [v2] Fetching URL:', url);
      
      const response = await fetch(url);
      console.log('🔗 [v2] Response status:', response.status);
      console.log('🔗 [v2] Response ok:', response.ok);
      
      if (!response.ok) {
        console.log('🔗 [v2] No organization links available - response not ok, status:', response.status);
        const errorText = await response.text();
        console.log('🔗 [v2] Error response:', errorText);
        return;
      }
      
      const links = await response.json();
      console.log('🔗 [v2] Loaded organization links:', links);
      this.displayOrganizationLinks(links);
    } catch (error) {
      console.error('🔗 [v2] Error loading organization links:', error);
    }
  }

  displayOrganizationLinks(links) {
    const isLinksPage = String(window.location.pathname || '') === '/links';
    const pageContainer = document.getElementById('linksPageList');
    const linksContainer = (isLinksPage && pageContainer) ? pageContainer : document.getElementById('quickLinksList');
    const linksButton = document.getElementById('tabLinksBtn');
    
    const hasLinks = Array.isArray(links) && links.length > 0;

    // Show/hide the Links tab button regardless of which route we're on.
    const shouldShowLinksTab = hasLinks || !!this._fundraising;
    if (linksButton) linksButton.style.display = shouldShowLinksTab ? 'flex' : 'none';

    // If we're not on the Links page (or container isn't present), nothing else to render.
    if (!linksContainer) return;

    if (!hasLinks) {
      if (isLinksPage) {
        linksContainer.innerHTML = `<div class="text-sm text-gray-600 dark:text-gray-400 py-2">No links available for this group.</div>`;
      } else {
        // Legacy popover no longer exists; nothing to render here.
      }
      return;
    }

    // Icon mapping for organization links
    const iconMap = {
      website: '🌐',
      calendar: '📅',
      email: '✉️',
      phone: '📞',
      facebook: '📘',
      youtube: '📺',
      instagram: '📷',
      twitter: '🐦',
      church: '⛪',
      bible: '📖',
      pray: '🙏',
      donate: '💝',
      music: '🎵',
      sermon: '🎤',
      news: '📰',
      event: '🎉'
    };

    // Avoid injecting untrusted URLs into inline onclick/HTML.
    linksContainer.innerHTML = '';
    const frag = document.createDocumentFragment();

    for (const link of links) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center space-x-2';

      const iconSpan = document.createElement('span');
      iconSpan.textContent = iconMap[link?.icon] || '🌐';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'truncate';
      titleSpan.textContent = (link?.title || '').toString();

      const url = (link?.url || '').toString();
      btn.addEventListener('click', () => {
        if (!url) return;
        const w = window.open(url, '_blank', 'noopener,noreferrer');
        if (w) w.opener = null;
      });

      btn.appendChild(iconSpan);
      btn.appendChild(titleSpan);
      frag.appendChild(btn);
    }

    linksContainer.appendChild(frag);
    
    // Button already set above.
  }

  // ===== Calendar & CTA additions =====
  formatLocalDateString(dateInput) {
    const d = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  normalizeDateKey(dateInput) {
    // Prefer YYYY-MM-DD if already provided
    const raw = String(dateInput || '').trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

    // If it starts with YYYY-MM-DD, take that (handles ISO timestamps)
    const prefix = raw.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(prefix)) return prefix;

    // Fall back to local date parsing
    try {
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime())) return this.formatLocalDateString(d);
    } catch (_) {
      // ignore
    }
    return '';
  }

  formatDisplayDate(dateInput) {
    const key = this.normalizeDateKey(dateInput);
    if (!key) return '';
    const d = new Date(`${key}T00:00:00`);
    // Short, human-friendly date (no time)
    return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  }
  async updateCalendarIndicatorForToday() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const res = await fetch(this.withOrg('/api/organization/calendar/daily', { date: today }));
      const data = await res.json();
      console.log('[Calendar] daily events for', today, data);
      const pill = document.getElementById('todayEventPill');
      const pillText = document.getElementById('todayEventPillText');
      if (!pill) return;

      const count = data?.success ? (data.events || []).length : 0;
      if (count > 0) {
        pill.classList.remove('hidden');
        if (pillText) pillText.textContent = count === 1 ? '1 event today' : `${count} events today`;
      } else {
        pill.classList.add('hidden');
      }
    } catch (e) {
      // ignore
    }
  }

  async openCalendarModal() {
    // Respect org feature flag if loaded
    if (this.orgFeatures && !this.isFeatureEnabled('group_calendar_enabled')) {
      this.showToast('Calendar is disabled for this group', 'info');
      return;
    }
    this.trackAnalytics && this.trackAnalytics('calendar_open');
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    this._calendar = { ym, events: [], selectedDate: null };
    this.loadMonth(ym).then(() => {
      this.renderCalendarMonth();
      const modal = document.getElementById('calendarModal');
      modal && modal.classList.remove('hidden');
    });
  }

  closeCalendarModal() {
    const modal = document.getElementById('calendarModal');
    modal && modal.classList.add('hidden');
  }

  shiftCalendarMonth(delta) {
    if (!this._calendar) return;
    const [y, m] = this._calendar.ym.split('-').map(n => parseInt(n,10));
    const d = new Date(y, m-1+delta, 1);
    this._calendar.ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    this.loadMonth(this._calendar.ym).then(() => this.renderCalendarMonth());
  }

  async loadMonth(ym) {
    const res = await fetch(this.withOrg('/api/organization/calendar/month', { ym }));
    const data = await res.json();
    this._calendar.events = data?.events || [];
  }

  renderCalendarMonth() {
    const grid = document.getElementById('calendarGrid');
    const label = document.getElementById('calendarMonthLabel');
    const list = document.getElementById('calendarEventList');
    if (!grid || !label || !list || !this._calendar) return;

    const [y, m] = this._calendar.ym.split('-').map(n => parseInt(n,10));
    const first = new Date(y, m-1, 1);
    const monthName = first.toLocaleString([], { month: 'long', year: 'numeric' });
    label.textContent = monthName;

    const startIdx = first.getDay();
    const daysInMonth = new Date(y, m, 0).getDate();

    const daysWithEvents = new Set(
      this._calendar.events.map(ev => this.formatLocalDateString(ev.start_at))
    );

    grid.innerHTML = '';
    for (let i=0;i<startIdx;i++) {
      const cell = document.createElement('div');
      cell.className = 'h-10 sm:h-12 rounded-lg';
      grid.appendChild(cell);
    }
    for (let d=1; d<=daysInMonth; d++) {
      const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const cell = document.createElement('button');
      cell.className = 'h-10 sm:h-12 rounded-lg text-sm flex items-center justify-center relative bg-white border border-gray-200 hover:bg-gray-50 transition-colors dark:bg-gray-800 dark:border-gray-700 dark:hover:bg-gray-700';
      cell.innerHTML = `<span>${d}</span>`;
      if (daysWithEvents.has(dateStr)) {
        const dot = document.createElement('span');
        dot.className = 'absolute bottom-1 w-1.5 h-1.5 bg-primary-600 rounded-full';
        cell.appendChild(dot);
        cell.classList.add('font-semibold','text-primary-700','ring-1','ring-primary-300','bg-primary-50','dark:text-primary-300','dark:ring-primary-800');
      }
      const todayLocal = new Date();
      const todayStr = `${todayLocal.getFullYear()}-${String(todayLocal.getMonth()+1).padStart(2,'0')}-${String(todayLocal.getDate()).padStart(2,'0')}`;
      if (dateStr === todayStr) {
        cell.classList.add('outline','outline-1','outline-primary-400','dark:outline-primary-700');
      }
      cell.addEventListener('click', () => this.renderEventListForDate(dateStr));
      grid.appendChild(cell);
    }

    const today = new Date().toISOString().slice(0,10);
    const defaultDate = today.startsWith(`${y}-${String(m).padStart(2,'0')}`) ? today : `${y}-${String(m).padStart(2,'0')}-01`;
    this.renderEventListForDate(defaultDate);
  }

  renderEventListForDate(dateStr) {
    this.trackAnalytics && this.trackAnalytics('calendar_day_select');
    if (!this._calendar) return;
    this._calendar.selectedDate = dateStr;
    const list = document.getElementById('calendarEventList');
    if (!list) return;

    // Render a stable shell immediately (verse preview + events)
    list.innerHTML = `
      <div class="mb-3">
        <div class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Verse</div>
        <div id="calendarVerseDetails" class="p-3 bg-white border border-gray-200 rounded-lg text-sm dark:bg-gray-900/40 dark:border-gray-700">
          <div class="text-gray-600 dark:text-gray-400">Loading verse…</div>
        </div>
      </div>
      <div>
        <div class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Events</div>
        <div id="calendarEventsForDay"></div>
      </div>
    `;

    const eventsContainer = document.getElementById('calendarEventsForDay');
    const items = this._calendar.events.filter(ev => this.formatLocalDateString(ev.start_at) === dateStr);

    const fmtTime = (ev) => {
      if (ev.all_day) return 'All day';
      const s = new Date(ev.start_at);
      const e = ev.end_at ? new Date(ev.end_at) : null;
      const f = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return e ? `${f(s)} – ${f(e)}` : f(s);
    };
    if (eventsContainer) {
      if (items.length === 0) {
        eventsContainer.innerHTML = `<div class="text-sm text-gray-500 dark:text-gray-400 py-2">No events on ${this.escapeHtml(dateStr)}</div>`;
      } else {
        eventsContainer.innerHTML = items.map(ev => {
          const dateLabel = new Date(ev.start_at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
          const timeLabel = fmtTime(ev);
          const addressAnchor = ev.address ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.address)}" target="_blank" class="underline">${this.escapeHtml(ev.address)}</a>` : '';
          const directionsBtn = ev.address ? `<a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(ev.address)}" target="_blank" class="px-2 py-1 rounded-md text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600">Directions</a>` : '';
          const detailsBtn = ev.link ? `<a href="${this.escapeHtml(ev.link)}" target="_blank" class="px-2 py-1 rounded-md text-xs bg-primary-600 hover:bg-primary-700 text-white" onclick="app.trackAnalytics && app.trackAnalytics('calendar_details_click')">Details</a>` : '';
          return `
            <div class="p-3 mb-2 bg-gray-50 border border-gray-200 rounded-lg text-sm dark:bg-gray-900/40 dark:border-gray-700">
              <div class="font-semibold text-gray-900 dark:text-gray-100">${this.escapeHtml(ev.title || '')}</div>
              <div class="mt-1 space-y-1 text-gray-700 dark:text-gray-300">
                <div class="flex items-start gap-2"><span>🗓️</span><span>${this.escapeHtml(dateLabel)} • ${this.escapeHtml(timeLabel)}</span></div>
                ${ev.location ? `<div class="flex items-start gap-2"><span>🏛️</span><span>${this.escapeHtml(ev.location)}</span></div>` : ''}
                ${ev.address ? `<div class="flex items-start gap-2"><span>📍</span><span>${addressAnchor}</span></div>` : ''}
              </div>
              ${ev.description ? `<div class="mt-2 text-gray-600 dark:text-gray-400">${this.escapeHtml(ev.description)}</div>` : ''}
              ${(detailsBtn || directionsBtn) ? `<div class="mt-3 flex items-center gap-2">${detailsBtn}${directionsBtn}</div>` : ''}
            </div>
          `;
        }).join('');
      }
    }

    // Load verse preview async
    this.loadCalendarVersePreview(dateStr).catch(() => {});
  }

  async loadCalendarVersePreview(dateStr) {
    const container = document.getElementById('calendarVerseDetails');
    if (!container) return;

    container.innerHTML = `<div class="text-gray-600 dark:text-gray-400">Loading verse…</div>`;

    try {
      const res = await fetch(this.buildApiUrl(`/api/verse/${dateStr}`));
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success || !data?.verse) {
        container.innerHTML = `
          <div class="flex items-center justify-between gap-3">
            <div class="text-gray-600 dark:text-gray-400">No verse for ${this.escapeHtml(dateStr)}.</div>
            <button class="px-3 py-1.5 rounded-lg text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600"
                    onclick="window.churchTapApp.navigate('/verse/${this.escapeHtml(dateStr)}'); window.churchTapApp.closeCalendarModal();">
              Open
            </button>
          </div>
        `;
        return;
      }

      const verse = data.verse;
      const ref = this.escapeHtml(verse.bible_reference || 'Bible Verse');
      const isText = verse.content_type === 'text';
      const excerpt = isText && verse.verse_text
        ? this.escapeHtml(this.plainTextFromVerseText(verse.verse_text).slice(0, 120) + (this.plainTextFromVerseText(verse.verse_text).length > 120 ? '…' : ''))
        : '';

      const media = isText
        ? `<div class="mt-2 text-gray-700 dark:text-gray-200">${excerpt || ''}</div>`
        : (verse.image_path
          ? `<img src="${this.escapeHtml(verse.image_path)}" alt="${ref}" class="mt-2 w-full max-h-40 object-cover rounded-lg border border-gray-200 dark:border-gray-700">`
          : '');

      container.innerHTML = `
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="font-semibold text-gray-900 dark:text-gray-100 truncate">${ref}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">${this.escapeHtml(dateStr)}</div>
          </div>
          <button class="px-3 py-1.5 rounded-lg text-xs bg-primary-600 hover:bg-primary-700 text-white"
                  onclick="window.churchTapApp.navigate('/verse/${this.escapeHtml(dateStr)}'); window.churchTapApp.closeCalendarModal();">
            Open
          </button>
        </div>
        ${media}
      `;
    } catch (e) {
      container.innerHTML = `<div class="text-gray-600 dark:text-gray-400">Unable to load verse.</div>`;
    }
  }

  async initCTA() {
    try {
      const res = await fetch(this.withOrg('/api/organization/cta'));
      const data = await res.json();
      console.log('[CTA] response', data);
      const cta = data?.cta;
      if (!cta) {
        this.adjustHeaderPosition(false); // No CTA - move header to top
        return;
      }
      this.renderCTACrawl(cta);
      this.adjustHeaderPosition(true); // CTA present - keep header offset
    } catch (e) {
      console.warn('[CTA] fetch failed', e);
      this.adjustHeaderPosition(false); // Error - assume no CTA
    }
  }

  adjustHeaderPosition(hasCTA) {
    const header = document.querySelector('header.glass-effect');
    if (header) {
      const topPosition = hasCTA ? '44px' : '0px';
      header.style.top = topPosition;
      console.log(`[CTA] Adjusted header to top: ${topPosition} (CTA: ${hasCTA ? 'present' : 'hidden'})`);
    }

    // Remove any custom padding - let natural flow handle positioning
    const mainContent = document.querySelector('main');
    if (mainContent) {
      mainContent.style.paddingTop = ''; // Reset to default
      console.log(`[CTA] Reset main content padding to natural flow (CTA: ${hasCTA ? 'present' : 'hidden'})`);
    }

    // Hide CTA element if no CTA
    if (!hasCTA) {
      const ctaCrawl = document.getElementById('ctaCrawl');
      if (ctaCrawl) {
        ctaCrawl.classList.add('hidden');
        ctaCrawl.style.display = 'none';
      }
    }
  }

  renderCTACrawl(cta) {
    let shell = document.getElementById('ctaCrawl');
    let inner = document.getElementById('ctaCrawlInner');
    let textEl = document.getElementById('ctaCrawlText');
    let iconEl = document.getElementById('ctaCrawlIcon');
    // If the container isn't in DOM (or got removed by reload), create it dynamically
    if (!shell) {
      shell = document.createElement('div');
      shell.id = 'ctaCrawl';
      shell.innerHTML = `
        <div id="ctaCrawlInner" class="relative w-full mx-auto px-3 py-2 overflow-hidden flex items-center space-x-2">
          <span id="ctaCrawlIcon">📣</span>
          <div class="relative overflow-hidden" style="width: calc(100% - 60px);">
            <div id="ctaCrawlText" class="whitespace-nowrap"></div>
          </div>
        </div>`;
      document.body.appendChild(shell);
      inner = shell.querySelector('#ctaCrawlInner');
      textEl = shell.querySelector('#ctaCrawlText');
      iconEl = shell.querySelector('#ctaCrawlIcon');
    } else {
      // Reparent to end of body to ensure top stacking order
      document.body.appendChild(shell);
    }
    if (!shell || !inner || !textEl || !iconEl) {
      console.warn('[CTA] elements missing', { shell: !!shell, inner: !!inner, textEl: !!textEl, iconEl: !!iconEl });
      return;
    }

    inner.style.backgroundColor = cta.bg_color || '#055089';
    inner.style.color = cta.text_color || '#ffffff';
    iconEl.textContent = cta.icon || '📣';
    textEl.textContent = cta.text || '';
    // Blue bar style - flat like top menu
    inner.style.borderRadius = '0';
    inner.style.boxShadow = 'none';
    inner.style.border = 'none';
    inner.style.padding = '10px 12px';
    iconEl.style.display = 'inline-flex';
    iconEl.style.alignItems = 'center';
    iconEl.style.justifyContent = 'center';
    iconEl.style.width = '22px';
    iconEl.style.height = '22px';
    iconEl.style.borderRadius = '9999px';
    iconEl.style.backgroundColor = 'rgba(255,255,255,0.9)';
    iconEl.style.color = '#333';
    textEl.style.fontWeight = '600';
    textEl.style.fontSize = '14px';
    textEl.style.letterSpacing = '0.2px';
    textEl.style.whiteSpace = 'nowrap';
    textEl.style.willChange = 'transform';
    shell.classList.remove('hidden');
    shell.style.position = 'fixed';
    shell.style.left = '0';
    shell.style.right = '0';
    shell.style.top = '0px';
    shell.style.padding = '0';
    shell.style.display = 'block';
    shell.style.zIndex = '2147483647';
    shell.style.pointerEvents = 'none';
    inner.style.pointerEvents = 'auto';
    inner.style.transition = 'all 0.2s ease';
    
    // Add subtle hover effect and right arrow to indicate clickability
    const rightArrow = document.createElement('div');
    rightArrow.innerHTML = '▶';
    rightArrow.style.position = 'absolute';
    rightArrow.style.right = '12px';
    rightArrow.style.top = '50%';
    rightArrow.style.transform = 'translateY(-50%)';
    rightArrow.style.color = 'rgba(255,255,255,0.9)';
    rightArrow.style.fontSize = '12px';
    rightArrow.style.fontWeight = 'bold';
    rightArrow.style.pointerEvents = 'none';
    rightArrow.style.transition = 'all 0.2s ease';
    inner.appendChild(rightArrow);
    
    inner.addEventListener('mouseenter', () => {
      inner.style.backgroundColor = `color-mix(in srgb, ${cta.bg_color || '#055089'} 90%, white 10%)`;
      rightArrow.style.transform = 'translateY(-50%) translateX(2px)';
    });
    inner.addEventListener('mouseleave', () => {
      inner.style.backgroundColor = cta.bg_color || '#055089';
      rightArrow.style.transform = 'translateY(-50%) translateX(0px)';
    });
    
    console.log('[CTA] rendering crawl, visible now');

    // Simple marquee effect
    const parent = textEl.parentElement;
    parent.style.overflow = 'hidden';
    
    // Edge fades for marquee
    const bg = cta.bg_color || '#055089';
    const leftFade = document.createElement('div');
    leftFade.style.position = 'absolute';
    leftFade.style.left = '0';
    leftFade.style.top = '0';
    leftFade.style.bottom = '0';
    leftFade.style.width = '8px';
    leftFade.style.background = `linear-gradient(90deg, ${bg} 0%, ${bg} 40%, rgba(0,0,0,0) 100%)`;
    leftFade.style.pointerEvents = 'none';
    leftFade.style.zIndex = '2';
    const rightFade = document.createElement('div');
    rightFade.style.position = 'absolute';
    rightFade.style.right = '30px'; // Stop fade before arrow
    rightFade.style.top = '0';
    rightFade.style.bottom = '0';
    rightFade.style.width = '8px';
    rightFade.style.background = `linear-gradient(270deg, ${bg} 0%, ${bg} 40%, rgba(0,0,0,0) 100%)`;
    rightFade.style.pointerEvents = 'none';
    rightFade.style.zIndex = '2';
    // Ensure only one set of fades
    Array.from(inner.querySelectorAll('.cta-fade')).forEach(n => n.remove());
    leftFade.className = 'cta-fade';
    rightFade.className = 'cta-fade';
    inner.appendChild(leftFade);
    inner.appendChild(rightFade);
    const animate = () => {
      const parentWidth = parent.clientWidth;
      const textWidth = textEl.scrollWidth;
      const arrowSpace = 50; // More conservative space for arrow + padding
      const availableWidth = parentWidth - arrowSpace;
      
      if (textWidth <= availableWidth) {
        // Text fits, position it normally at left
        textEl.style.transform = 'translateX(0px)';
        return;
      }
      
      // Text needs to scroll - loop from right to left
      let pos = availableWidth; // Start from right edge of available space
      const speed = 40;
      let last = performance.now();
      
      const step = (now) => {
        const dt = (now - last) / 1000;
        last = now;
        pos -= speed * dt;
        
        // Loop: when text completely scrolls off left, restart from right
        if (pos < -textWidth) {
          pos = availableWidth;
        }
        
        textEl.style.transform = `translateX(${pos}px)`;
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    setTimeout(animate, 150);

    // Guard: if some layout change hides it, re-assert visibility shortly after
    setTimeout(() => {
      shell.style.display = 'block';
      shell.classList.remove('hidden');
    }, 500);

    // Impression once visible
    try { this.trackAnalytics && this.trackAnalytics('cta_impression'); } catch(_) {}

    inner.onclick = () => {
      this.trackAnalytics && this.trackAnalytics('cta_expand');
      const modal = document.createElement('div');
      modal.className = 'fixed inset-0 z-50 bg-black/40 flex items-center justify-center';
      
      // Only show Open button if there's a valid URL
      const hasUrl = cta.url && cta.url.trim() !== '';
      const openButton = hasUrl ? 
        `<a href="${cta.url}" target="_blank" class="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm" onclick="app.trackAnalytics && app.trackAnalytics('cta_click')">Open</a>` : 
        '';
      
      modal.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md mx-4">
          <div class="px-5 py-4">
            <div class="text-2xl mb-2">${cta.icon || '📣'}</div>
            <div class="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-line">${cta.text || ''}</div>
            <div class="mt-4 flex justify-end space-x-2">
              ${openButton}
              <button id="ctaCloseBtn" class="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 text-sm">Close</button>
            </div>
          </div>
        </div>`;
      modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.id === 'ctaCloseBtn') modal.remove();
      });
      document.body.appendChild(modal);
    };
  }

  // Update menu indicators for theme and text size
  updateMenuIndicators() {
    // Update theme indicator
    const themeIndicator = document.getElementById('themeIndicator');
    const themeMenuIcon = document.getElementById('themeMenuIcon');
    if (themeIndicator && themeMenuIcon) {
      if (this.theme === 'dark') {
        themeIndicator.textContent = 'Dark';
        themeMenuIcon.textContent = '🌙';
      } else {
        themeIndicator.textContent = 'Light';
        themeMenuIcon.textContent = '☀️';
      }
    }

    // Update text size indicator
    const textSizeIndicator = document.getElementById('textSizeIndicator');
    if (textSizeIndicator) {
      const sizeNames = {
        'small': 'Small',
        'medium': 'Medium',
        'large': 'Large',
        'xl': 'Extra Large'
      };
      textSizeIndicator.textContent = sizeNames[this.textSize] || 'Medium';
    }

    // Update study mode toggle
    const studyToggle = document.getElementById('studyModeMenuToggle');
    if (studyToggle) {
      studyToggle.checked = !!this.isStudyModeEnabled();
    }

    // Update group display
    this.updateGroupDisplay();
  }

  // Update the current group display in the menu
  updateGroupDisplay() {
    const currentGroupName = document.getElementById('currentGroupName');
    const groupSection = document.getElementById('groupSection');
    const groupQuickList = document.getElementById('groupQuickList');
    const changeGroupBtn = document.getElementById('changeGroupBtn');
    const adminPanelBtn = document.getElementById('adminPanelBtn');

    if (currentGroupName) {
      const activeOrgId = this.membershipContext?.active_organization_id;
      const memberships = this.membershipContext?.memberships || [];
      const active = activeOrgId ? memberships.find(m => Number(m.organization_id) === Number(activeOrgId)) : null;

      if (active) {
        const suffix = active.status === 'pending' ? ' (Pending)' : '';
        currentGroupName.textContent = `${active.organization_name}${suffix}`;
      } else if (this.currentUser) {
        currentGroupName.textContent = 'No Group Selected';
      } else {
        currentGroupName.textContent = 'Guest';
      }

      if (groupSection) groupSection.style.display = 'block';
    }

    // Toggle admin panel link: show only if user is an admin of the active group
    if (adminPanelBtn) {
      if (!this.currentUser) {
        adminPanelBtn.classList.add('hidden');
      } else {
        const activeOrgId = this.membershipContext?.active_organization_id;
        const adminOrgs = this.adminOrganizations?.organizations || [];
        const isAdminOfActive = !!activeOrgId && adminOrgs.some(o => Number(o.organization_id) === Number(activeOrgId));
        adminPanelBtn.classList.toggle('hidden', !isAdminOfActive);
      }
    }

    // Render quick switch list (up to 5 groups)
    if (groupQuickList) {
      if (!this.currentUser) {
        groupQuickList.innerHTML = '';
        if (changeGroupBtn) changeGroupBtn.style.display = '';
        return;
      }

      const memberships = (this.membershipContext?.memberships || [])
        .filter(m => m.status === 'active' || m.status === 'pending');

      // Hide "Switch Group" button when chips cover all groups (<= 5)
      if (changeGroupBtn) {
        changeGroupBtn.style.display = memberships.length > 5 ? '' : 'none';
      }

      const activeOrgId = this.membershipContext?.active_organization_id;
      const top = memberships.slice(0, 5);

      if (top.length === 0) {
        groupQuickList.innerHTML = `
          <button class="w-full btn-secondary text-sm" onclick="window.location.href='/choose-organization'">
            👥 Join a group
          </button>
        `;
        if (changeGroupBtn) changeGroupBtn.style.display = 'none';
        return;
      }

      // Chip row: horizontal scroll with snap
      const chips = top.map(m => {
        const isActive = activeOrgId && Number(m.organization_id) === Number(activeOrgId);
        const pending = m.status === 'pending';

        const badge = pending
          ? `<span class="ml-1 inline-block w-2 h-2 rounded-full bg-yellow-400" aria-label="Pending"></span>`
          : '';

        const cls = isActive
          ? 'inline-flex items-center px-3 py-2 rounded-full bg-blue-600 text-white text-sm font-medium whitespace-nowrap'
          : 'inline-flex items-center px-3 py-2 rounded-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium whitespace-nowrap hover:bg-gray-50 dark:hover:bg-gray-600';

        const onclick = isActive ? '' : `onclick="window.churchTapApp.switchActiveGroup(${m.organization_id})"`;

        return `
          <button class="${cls} snap-start" ${onclick} ${isActive ? 'disabled' : ''} title="${this.escapeHtml(m.organization_name)}">
            ${this.escapeHtml(m.organization_name)}
            ${badge}
          </button>
        `;
      }).join('');

      const moreChip = memberships.length > 5
        ? `
          <button class="inline-flex items-center px-3 py-2 rounded-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium whitespace-nowrap hover:bg-gray-50 dark:hover:bg-gray-600 snap-start"
                  onclick="window.churchTapApp.showGroupSwitcherModal()">
            More…
          </button>
        `
        : '';

      groupQuickList.innerHTML = `
        <div class="flex gap-2 overflow-x-auto pb-1 snap-x snap-mandatory" style="-webkit-overflow-scrolling: touch;">
          ${chips}
          ${moreChip}
        </div>
      `;
    }
  }

  // Handle change group button click
  changeGroup() {
    this.showGroupSwitcherModal();
    this.hideQuickMenu();
  }

  // Handle request group button click
  requestGroup() {
    // Group discovery is now account-driven (bracelets are optional).
    window.location.href = '/choose-organization';

    // Hide menu after action
    this.hideQuickMenu();
  }

  async showGroupSwitcherModal() {
    if (!this.currentUser) {
      this.showLoginModal();
      return;
    }

    // Refresh memberships when opening switcher so it’s always current
    this.membershipContext = await this.fetchMembershipContext();
    this.updateVersePrivateToolsVisibility();
    const memberships = this.membershipContext?.memberships || [];
    const activeOrgId = this.membershipContext?.active_organization_id;

    if (!memberships.length) {
      this.showModal('Switch Group', `
        <div class="space-y-4">
          <p class="text-sm text-gray-600 dark:text-gray-400">You haven’t joined any groups yet.</p>
          <button class="w-full btn-primary" onclick="window.location.href='/choose-organization'">Join a group</button>
          <button class="w-full btn-secondary" onclick="window.churchTapApp.closeModal()">Not right now</button>
        </div>
      `);
      return;
    }

    const rowsHtml = memberships.map(m => {
      const isActive = activeOrgId && Number(m.organization_id) === Number(activeOrgId);
      const statusBadge =
        m.status === 'active' ? '' :
        m.status === 'pending' ? `<span class="text-xs px-2 py-1 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300">Pending</span>` :
        `<span class="text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">${m.status}</span>`;

      const switchDisabled = isActive ? 'disabled' : '';
      const switchBtnClass = isActive ? 'btn-secondary opacity-60 cursor-default' : 'btn-primary';

      return `
        <div class="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700">
          <div class="min-w-0">
            <div class="flex items-center space-x-2">
              <div class="font-medium text-gray-900 dark:text-white truncate">${this.escapeHtml(m.organization_name)}</div>
              ${statusBadge}
              ${isActive ? `<span class="text-xs px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300">Active</span>` : ''}
            </div>
            <div class="text-xs text-gray-500 dark:text-gray-400 truncate">@${this.escapeHtml(m.organization_subdomain || '')}</div>
          </div>
          <div class="flex items-center space-x-2 ml-3">
            <button class="${switchBtnClass}" ${switchDisabled} onclick="window.churchTapApp.switchActiveGroup(${m.organization_id})">Switch</button>
            <button class="btn-secondary" onclick="window.churchTapApp.leaveGroup(${m.organization_id})">Leave</button>
          </div>
        </div>
      `;
    }).join('');

    this.showModal('Switch Group', `
      <div class="space-y-4">
        <div class="space-y-2">${rowsHtml}</div>
        <button class="w-full btn-secondary" onclick="window.location.href='/choose-organization'">Join another group</button>
      </div>
    `);
  }

  async switchActiveGroup(organizationId) {
    try {
      const response = await fetch('/api/memberships/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ organization_id: organizationId })
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to switch group');

      this.membershipContext = await this.fetchMembershipContext();
      this.updateVersePrivateToolsVisibility();
      this.closeModal();
      await this.refreshForActiveGroupChange();
      this.showToast('Group switched');
    } catch (e) {
      console.error('Switch group error:', e);
      this.showToast(e.message || 'Failed to switch group', 'error');
    }
  }

  async leaveGroup(organizationId) {
    if (!confirm('Leave this group? You can rejoin later if it is open.')) return;

    try {
      const response = await fetch('/api/memberships/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ organization_id: organizationId })
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to leave group');

      this.membershipContext = await this.fetchMembershipContext();
      this.updateVersePrivateToolsVisibility();
      this.closeModal();
      await this.refreshForActiveGroupChange();
      this.showToast('Left group');
    } catch (e) {
      console.error('Leave group error:', e);
      this.showToast(e.message || 'Failed to leave group', 'error');
    }
  }

  async loadBraceletInfo() {
    const contentEl = document.getElementById('braceletOrgContent');
    if (!contentEl) return;

    try {
      // Check if we have current tag ID from session or URL
      const currentTagId = this.tagIdParam || this.getCurrentTagId();
      
      if (!currentTagId) {
        contentEl.innerHTML = `
          <div class="text-center py-4">
            <div class="text-gray-500 dark:text-gray-400 mb-2">
              🔍 No bracelet detected
            </div>
            <p class="text-sm text-gray-600 dark:text-gray-400">
              Tap your bracelet to see organization information
            </p>
          </div>
        `;
        return;
      }

      // Fetch bracelet information from the API
      const response = await fetch(`/api/bracelet/info/${currentTagId}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch bracelet information');
      }

      const data = await response.json();
      
      if (data.success && data.bracelet) {
        this.displayBraceletInfo(data.bracelet, currentTagId);
      } else {
        this.displayUnclaimedBracelet(currentTagId);
      }
    } catch (error) {
      console.error('Error loading bracelet info:', error);
      contentEl.innerHTML = `
        <div class="text-center py-4">
          <div class="text-red-500 mb-2">❌ Error loading bracelet information</div>
          <button onclick="window.churchTapApp.loadBraceletInfo()" class="btn-secondary">
            🔄 Retry
          </button>
        </div>
      `;
    }
  }

  displayBraceletInfo(bracelet, tagId) {
    const contentEl = document.getElementById('braceletOrgContent');
    const { organization, status, last_scanned_at, scan_count } = bracelet;

    contentEl.innerHTML = `
      <div class="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center space-x-2">
            <span class="text-blue-600 dark:text-blue-400">🏷️</span>
            <span class="font-medium text-gray-900 dark:text-white">Your Bracelet</span>
          </div>
          <span class="text-xs px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 rounded-full">
            ${status}
          </span>
        </div>
        
        <div class="space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-gray-600 dark:text-gray-300">Bracelet ID:</span>
            <code class="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">${tagId}</code>
          </div>
          
          ${organization ? `
            <div class="flex justify-between">
              <span class="text-gray-600 dark:text-gray-300">Organization:</span>
              <span class="font-medium text-gray-900 dark:text-white">${organization.name}</span>
            </div>
            
            <div class="flex justify-between">
              <span class="text-gray-600 dark:text-gray-300">Type:</span>
              <span class="text-gray-900 dark:text-white">${organization.org_type || 'N/A'}</span>
            </div>
          ` : ''}
          
          <div class="flex justify-between">
            <span class="text-gray-600 dark:text-gray-300">Total Scans:</span>
            <span class="text-gray-900 dark:text-white">${scan_count || 0}</span>
          </div>
          
          ${last_scanned_at ? `
            <div class="flex justify-between">
              <span class="text-gray-600 dark:text-gray-300">Last Used:</span>
              <span class="text-gray-900 dark:text-white">${new Date(last_scanned_at).toLocaleDateString()}</span>
            </div>
          ` : ''}
        </div>
        
        ${organization ? `
          <div class="mt-4 pt-3 border-t border-blue-200 dark:border-blue-700 space-y-2">
            <button onclick="window.churchTapApp.showChangeOrgModal('${tagId}')" 
                    class="w-full btn-secondary text-sm">
              🔄 Change Organization
            </button>
            
            ${this.currentUser ? `
              <div class="text-center">
                <div id="braceletLinkStatus-${tagId}" class="text-xs">
                  <span class="text-gray-500">Checking link status...</span>
                </div>
              </div>
            ` : `
              <div class="text-center">
                <div class="text-xs text-gray-500 dark:text-gray-400 mb-1">
                  💡 Have multiple bracelets?
                </div>
                <button onclick="window.churchTapApp.showAccountBenefitsModal('${tagId}')" 
                        class="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline">
                  Learn about accounts
                </button>
              </div>
            `}
          </div>
        ` : `
          <div class="mt-4 pt-3 border-t border-blue-200 dark:border-blue-700">
            <button onclick="window.location.href = '/choose-organization'" 
                    class="w-full btn-primary text-sm">
              👥 Join a Group
            </button>
          </div>
        `}
      </div>
    `;

    // Check link status if user is logged in
    if (this.currentUser && organization) {
      this.checkAndUpdateLinkStatus(tagId);
    }
  }

  displayUnclaimedBracelet(tagId) {
    const contentEl = document.getElementById('braceletOrgContent');
    
    contentEl.innerHTML = `
      <div class="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg">
        <div class="flex items-center space-x-2 mb-3">
          <span class="text-yellow-600 dark:text-yellow-400">🏷️</span>
          <span class="font-medium text-gray-900 dark:text-white">Unclaimed Bracelet</span>
        </div>
        
        <div class="space-y-2 text-sm mb-4">
          <div class="flex justify-between">
            <span class="text-gray-600 dark:text-gray-300">Bracelet ID:</span>
            <code class="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">${tagId}</code>
          </div>
        </div>
        
        <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
          This bracelet hasn't been claimed to an organization yet.
        </p>
        
        <button onclick="window.location.href = '/choose-organization'" 
                class="w-full btn-primary text-sm">
          👥 Join a Group
        </button>
      </div>
    `;
  }

  getCurrentTagId() {
    // Try to get from current session
    const session = this.getTagSession();
    if (session && session.tagId) {
      return session.tagId;
    }
    
    // Try to get from URL parameters
    if (this.tagIdParam) {
      return this.tagIdParam;
    }
    
    return null;
  }

  showChangeOrgModal(tagId) {
    this.showModal('Change Organization', `
      <div class="space-y-4">
        <div class="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg">
          <div class="flex items-center space-x-2 mb-2">
            <span class="text-yellow-600 dark:text-yellow-400">⚠️</span>
            <span class="font-medium text-gray-900 dark:text-white">Important</span>
          </div>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            Groups are now account-based. Choose a group to join or switch.
          </p>
        </div>
        
        <div class="space-y-3">
          <button onclick="window.location.href = '/choose-organization'" 
                  class="w-full btn-primary">
            🔄 Choose Group
          </button>
          
          <button onclick="window.churchTapApp.closeModal()" 
                  class="w-full btn-secondary">
            Cancel
          </button>
        </div>
      </div>
    `);
  }

  async isBraceletLinked(tagId) {
    // Check if this bracelet is already linked to the current user account
    if (!this.currentUser) {
      return false;
    }

    try {
      const response = await fetch(`/api/user/bracelet/${tagId}/linked`, {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        return data.success && data.linked;
      }
    } catch (error) {
      console.error('Error checking bracelet link:', error);
    }
    
    return false;
  }

  async linkBraceletToAccount(tagId) {
    this.showToast('To link a bracelet, just tap it while you are signed in.');
  }

  async checkAndUpdateLinkStatus(tagId) {
    const statusEl = document.getElementById(`braceletLinkStatus-${tagId}`);
    if (!statusEl) return;

    try {
      const isLinked = await this.isBraceletLinked(tagId);
      
      if (isLinked) {
        statusEl.innerHTML = `
          <div class="text-green-600 dark:text-green-400 flex items-center justify-center space-x-1">
            <span>✓</span>
            <span>Linked to your account</span>
          </div>
        `;
      } else {
        statusEl.innerHTML = `
          <button onclick="window.churchTapApp.linkBraceletToAccount('${tagId}')" 
                  class="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline">
            🔗 Link to your account
          </button>
        `;
      }
    } catch (error) {
      console.error('Error updating link status:', error);
      statusEl.innerHTML = `
        <span class="text-gray-500">Link status unavailable</span>
      `;
    }
  }

  showAccountBenefitsModal(tagId) {
    this.showModal('Account Benefits', `
      <div class="space-y-4">
        <div class="text-center">
          <div class="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <span class="text-2xl">🔗</span>
          </div>
          <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">
            Sync Across Multiple Bracelets
          </h3>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Create an account to link multiple bracelets and keep your favorites, 
            prayers, and preferences synced.
          </p>
        </div>
        
        <div class="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
          <h4 class="font-medium text-gray-900 dark:text-white mb-2">✨ Benefits:</h4>
          <ul class="text-sm text-gray-600 dark:text-gray-400 space-y-1">
            <li>• Never lose your favorite verses</li>
            <li>• Access prayer history from any bracelet</li>
            <li>• Seamless experience when you get a new bracelet</li>
            <li>• Optional - works great without an account too!</li>
          </ul>
        </div>
        
        <div class="space-y-3">
          <button onclick="window.churchTapApp.showLoginModal()" 
                  class="w-full btn-primary">
            🔑 Login / Create Account
          </button>
          
          <button onclick="window.churchTapApp.closeModal()" 
                  class="w-full btn-secondary">
            Maybe Later
          </button>
        </div>
      </div>
    `);
  }
}

// Initialize the app
window.churchTapApp = new ChurchTapApp();
// Also make it available as 'app' for convenience in HTML onclick handlers
window.app = window.churchTapApp;