class AdminDashboard {
  constructor() {
    this.currentAdmin = null;
    this.verses = [];
    this.currentEditingVerse = null;
    this.filters = { search: '', type: 'all', status: 'all' };
    this.brand = null;
    
    this.init();
  }

  init() {
    this.setupEventListeners();
    this.checkAuthStatus();
    this.applySavedBrandTheme();
  }

  setupEventListeners() {
    // Login form
    document.getElementById('loginForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleLogin();
    });

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', () => {
      this.handleLogout();
    });

    // Mobile menu
    document.getElementById('mobileMenuBtn').addEventListener('click', () => {
      this.showMobileMenu();
    });
    
    document.getElementById('closeMobileMenu').addEventListener('click', () => {
      this.hideMobileMenu();
    });
    
    document.getElementById('mobileMenuBackdrop').addEventListener('click', () => {
      this.hideMobileMenu();
    });

    // Mobile navigation items
    document.querySelectorAll('.mobile-nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const target = item.getAttribute('data-target');
        const tabName = target.replace('Content', '');
        this.showTab(tabName);
        this.hideMobileMenu();
      });
    });

    // Mobile logout in nav
    document.getElementById('mobileLogoutBtnNav').addEventListener('click', () => {
      this.handleLogout();
    });

    // Sidebar navigation
    document.getElementById('dashboardNav').addEventListener('click', (e) => {
      e.preventDefault();
      this.showTab('dashboard');
    });
    document.getElementById('versesNav').addEventListener('click', (e) => {
      e.preventDefault();
      this.showTab('verses');
    });
    document.getElementById('analyticsNav').addEventListener('click', (e) => {
      e.preventDefault();
      this.showTab('analytics');
    });
    document.getElementById('communityNav').addEventListener('click', (e) => {
      e.preventDefault();
      this.showTab('community');
    });
    document.getElementById('usersNav').addEventListener('click', (e) => {
      e.preventDefault();
      this.showTab('users');
    });
    document.getElementById('linksNav').addEventListener('click', (e) => {
      e.preventDefault();
      this.showTab('links');
    });
    document.getElementById('verseImportNav').addEventListener('click', (e) => {
      e.preventDefault();
      this.showTab('verseImport');
    });
    document.getElementById('settingsNav').addEventListener('click', (e) => {
      e.preventDefault();
      this.showTab('settings');
    });

    // Add verse
    document.getElementById('addVerseBtn').addEventListener('click', () => {
      this.showVerseModal();
    });

    // Modal events
    document.getElementById('cancelModal').addEventListener('click', () => {
      this.hideVerseModal();
    });

    document.getElementById('verseModal').addEventListener('click', (e) => {
      if (e.target === document.getElementById('verseModal')) {
        this.hideVerseModal();
      }
    });

    // Verse form
    document.getElementById('verseForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleVerseSubmit();
    });

    // Content type change
    document.getElementById('contentType').addEventListener('change', (e) => {
      this.toggleContentFields(e.target.value);
    });

    // Community refresh button
    const refreshCommunityBtn = document.getElementById('refreshCommunity');
    if (refreshCommunityBtn) {
      refreshCommunityBtn.addEventListener('click', () => {
        this.loadCommunityData();
      });
    }

    // Community filter
    const communityFilter = document.getElementById('communityDaysFilter');
    if (communityFilter) {
      communityFilter.addEventListener('change', () => {
        this.loadCommunityData();
      });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideVerseModal();
      }
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        this.showVerseModal();
      }
    });

    // Verses filters
    const searchInput = document.getElementById('verseSearch');
    const typeFilter = document.getElementById('verseTypeFilter');
    const statusFilter = document.getElementById('verseStatusFilter');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.filters.search = e.target.value.toLowerCase();
        this.renderVersesList();
      });
    }
    if (typeFilter) {
      typeFilter.addEventListener('change', (e) => {
        this.filters.type = e.target.value;
        this.renderVersesList();
      });
    }
    if (statusFilter) {
      statusFilter.addEventListener('change', (e) => {
        this.filters.status = e.target.value;
        this.renderVersesList();
      });
    }
    // Settings: brand colors inputs (if present)
    ['brandPrimary','brandAccent','brandBg','brandMuted','brandSuccess','brandBlack'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          this.updateBrandTheme({
            primary: document.getElementById('brandPrimary').value,
            accent: document.getElementById('brandAccent').value,
            bg: document.getElementById('brandBg').value,
            muted: document.getElementById('brandMuted').value,
            success: document.getElementById('brandSuccess').value,
            black: document.getElementById('brandBlack').value,
          });
        });
      }
    });

    // Theme actions: reset/export/import
    const resetBtn = document.getElementById('resetThemeBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        const defaults = {
          primary: '#345995',
          accent: '#EAC435',
          bg: '#FCF7FF',
          muted: '#C4CAD0',
          success: '#53917E',
          black: '#101916'
        };
        this.setCssVars(defaults);
        try { localStorage.removeItem('brandTheme'); } catch (e) {}
        ['brandPrimary','brandAccent','brandBg','brandMuted','brandSuccess','brandBlack'].forEach((id) => {
          const el = document.getElementById(id);
          const key = id.replace('brand','').toLowerCase();
          if (el && defaults[key]) {
            el.value = defaults[key];
          }
        });
      });
    }

    const exportBtn = document.getElementById('exportThemeBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const theme = this.readCurrentVars();
        const blob = new Blob([JSON.stringify(theme, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'brand-theme.json';
        a.click();
        URL.revokeObjectURL(url);
      });
    }

    const importInput = document.getElementById('importThemeInput');
    if (importInput) {
      importInput.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const json = JSON.parse(text);
          this.updateBrandTheme(json);
          if (json.primary) document.getElementById('brandPrimary').value = json.primary;
          if (json.accent) document.getElementById('brandAccent').value = json.accent;
          if (json.bg) document.getElementById('brandBg').value = json.bg;
          if (json.muted) document.getElementById('brandMuted').value = json.muted;
          if (json.success) document.getElementById('brandSuccess').value = json.success;
          if (json.black) document.getElementById('brandBlack').value = json.black;
        } catch (err) {
          this.showToast('Invalid theme file', 'error');
        } finally {
          importInput.value = '';
        }
      });
    }

    // Menu text theme toggle (switches between brand background and brand black)
    const menuToggle = document.getElementById('menuThemeToggle');
    if (menuToggle) {
      menuToggle.addEventListener('click', () => {
        const cs = getComputedStyle(document.documentElement);
        const current = cs.getPropertyValue('--menu-text').trim();
        const bg = cs.getPropertyValue('--brand-bg').trim();
        const black = cs.getPropertyValue('--brand-black').trim();
        const next = current.toLowerCase() === bg.toLowerCase() ? black : bg;
        document.documentElement.style.setProperty('--menu-text', next);
        try {
          // persist alongside brandTheme
          const saved = localStorage.getItem('brandTheme');
          const theme = saved ? JSON.parse(saved) : {};
          theme.menuText = next;
          localStorage.setItem('brandTheme', JSON.stringify(theme));
        } catch (e) {}
      });
    }

    // Organization Links event listeners
    const addLinkBtn = document.getElementById('addLinkBtn');
    if (addLinkBtn) {
      addLinkBtn.addEventListener('click', () => {
        this.showLinkModal();
      });
    }

    const addFirstLinkBtn = document.getElementById('addFirstLinkBtn');
    if (addFirstLinkBtn) {
      addFirstLinkBtn.addEventListener('click', () => {
        this.showLinkModal();
      });
    }

    // Link modal events
    const cancelLinkModal = document.getElementById('cancelLinkModal');
    if (cancelLinkModal) {
      cancelLinkModal.addEventListener('click', () => {
        this.hideLinkModal();
      });
    }

    const linkModal = document.getElementById('linkModal');
    if (linkModal) {
      linkModal.addEventListener('click', (e) => {
        if (e.target === linkModal) {
          this.hideLinkModal();
        }
      });
    }

    // Link form
    const linkForm = document.getElementById('linkForm');
    if (linkForm) {
      linkForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveLinkForm();
      });
    }

    // Verse Import event listeners
    const checkTodayBtn = document.getElementById('checkTodayBtn');
    if (checkTodayBtn) {
      checkTodayBtn.addEventListener('click', () => {
        this.checkTodayVerse();
      });
    }

    const importTodayBtn = document.getElementById('importTodayBtn');
    if (importTodayBtn) {
      importTodayBtn.addEventListener('click', () => {
        this.importTodayVerse();
      });
    }

    const manualImportBtn = document.getElementById('manualImportBtn');
    if (manualImportBtn) {
      manualImportBtn.addEventListener('click', () => {
        this.manualImportVerse();
      });
    }

    const saveImportSettings = document.getElementById('saveImportSettings');
    if (saveImportSettings) {
      saveImportSettings.addEventListener('click', () => {
        this.saveImportSettings();
      });
    }
  }

  applySavedBrandTheme() {
    try {
      const saved = localStorage.getItem('brandTheme');
      if (saved) {
        const theme = JSON.parse(saved);
        this.setCssVars(theme);
        if (theme.menuText) {
          document.documentElement.style.setProperty('--menu-text', theme.menuText);
        }
      }
    } catch (e) {}
  }

  updateBrandTheme(theme) {
    const next = {
      primary: theme.primary || getComputedStyle(document.documentElement).getPropertyValue('--brand-primary'),
      accent: theme.accent || getComputedStyle(document.documentElement).getPropertyValue('--brand-accent'),
      bg: theme.bg || getComputedStyle(document.documentElement).getPropertyValue('--brand-bg'),
      muted: theme.muted || getComputedStyle(document.documentElement).getPropertyValue('--brand-muted'),
      success: theme.success || getComputedStyle(document.documentElement).getPropertyValue('--brand-success'),
      black: theme.black || getComputedStyle(document.documentElement).getPropertyValue('--brand-black'),
    };
    this.setCssVars(next);
    try { localStorage.setItem('brandTheme', JSON.stringify(next)); } catch (e) {}
  }

  setCssVars(theme) {
    const root = document.documentElement;
    if (theme.primary) root.style.setProperty('--brand-primary', theme.primary.trim());
    if (theme.accent) root.style.setProperty('--brand-accent', theme.accent.trim());
    if (theme.bg) root.style.setProperty('--brand-bg', theme.bg.trim());
    if (theme.muted) root.style.setProperty('--brand-muted', theme.muted.trim());
    if (theme.success) root.style.setProperty('--brand-success', theme.success.trim());
    if (theme.black) root.style.setProperty('--brand-black', theme.black.trim());
  }

  readCurrentVars() {
    const cs = getComputedStyle(document.documentElement);
    return {
      primary: cs.getPropertyValue('--brand-primary').trim(),
      accent: cs.getPropertyValue('--brand-accent').trim(),
      bg: cs.getPropertyValue('--brand-bg').trim(),
      muted: cs.getPropertyValue('--brand-muted').trim(),
      success: cs.getPropertyValue('--brand-success').trim(),
      black: cs.getPropertyValue('--brand-black').trim(),
    };
  }

  async checkAuthStatus() {
    try {
      const response = await fetch('/api/admin/check-session');
      const data = await response.json();
      
      if (data.success && data.authenticated) {
        this.currentAdmin = data.admin;
        this.showDashboard();
        this.updateOrganizationInfo();
        this.loadVerses();
      } else {
        this.showLogin();
      }
    } catch (error) {
      this.showLogin();
    }
  }

  updateOrganizationInfo() {
    if (this.currentAdmin && this.currentAdmin.organization_name) {
      // Update admin username display
      const adminUsernameEl = document.getElementById('adminUsername');
      if (adminUsernameEl) {
        adminUsernameEl.textContent = this.currentAdmin.username;
      }
      
      // Update mobile admin display
      const mobileAdminUsernameEl = document.getElementById('mobileAdminUsernameNav');
      if (mobileAdminUsernameEl) {
        mobileAdminUsernameEl.textContent = this.currentAdmin.username;
      }
      
      // Update avatar initials
      const initial = this.currentAdmin.username.charAt(0).toUpperCase();
      const adminAvatarEl = document.getElementById('adminAvatar');
      if (adminAvatarEl) {
        adminAvatarEl.textContent = initial;
      }
      const mobileAvatarEl = document.getElementById('mobileAdminAvatar');
      if (mobileAvatarEl) {
        mobileAvatarEl.textContent = initial;
      }
      
      // Update organization context in header if element exists
      const orgContextEl = document.getElementById('organizationContext');
      if (orgContextEl) {
        orgContextEl.textContent = this.currentAdmin.organization_name;
        orgContextEl.classList.add('text-brand-muted');
      }
      
      // Update page title to include organization
      document.title = `${this.currentAdmin.organization_name} - Daily Verse Admin`;
    }
  }

  async handleLogin() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('loginError');

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (data.success) {
        this.currentAdmin = data.admin;
        this.showDashboard();
        this.loadVerses();
      } else {
        errorEl.textContent = data.error || 'Login failed';
        errorEl.classList.remove('hidden');
      }
    } catch (error) {
      errorEl.textContent = 'Connection error';
      errorEl.classList.remove('hidden');
    }
  }

  async handleLogout() {
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } catch (error) {
      console.error('Logout error:', error);
    }
    
    this.currentAdmin = null;
    this.showLogin();
  }

  showLogin() {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('adminDashboard').classList.add('hidden');
    document.getElementById('loginError').classList.add('hidden');
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
  }

  showDashboard() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('adminDashboard').classList.remove('hidden');
    
    if (this.currentAdmin) {
      document.getElementById('adminUsername').textContent = this.currentAdmin.username;
      
      // Update mobile admin display
      const mobileAdminUsernameEl = document.getElementById('mobileAdminUsernameNav');
      if (mobileAdminUsernameEl) {
        mobileAdminUsernameEl.textContent = this.currentAdmin.username;
      }
      
      // Update avatar initials
      const initial = this.currentAdmin.username.charAt(0).toUpperCase();
      const adminAvatarEl = document.getElementById('adminAvatar');
      if (adminAvatarEl) {
        adminAvatarEl.textContent = initial;
      }
      const mobileAvatarEl = document.getElementById('mobileAdminAvatar');
      if (mobileAvatarEl) {
        mobileAvatarEl.textContent = initial;
      }
    }
    
    // Show default tab (verses)
    this.showTab('verses');
  }

  showTab(tabName) {
    // Update sidebar navigation
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.remove('active');
    });
    document.getElementById(`${tabName}Nav`).classList.add('active');

    // Update content
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.add('hidden');
    });
    
    document.getElementById(`${tabName}Content`).classList.remove('hidden');

    // Update page title
    const titleMap = {
      'dashboard': 'Dashboard',
      'verses': 'Manage Verses',
      'analytics': 'Analytics Dashboard', 
      'community': 'Community Management',
      'users': 'User Management',
      'links': 'Organization Links',
      'verseImport': 'Verse Import',
      'settings': 'Settings'
    };
    document.getElementById('pageTitle').textContent = titleMap[tabName] || 'Dashboard';

    // Load data for specific tabs
    if (tabName === 'analytics') {
      this.loadAnalytics();
    } else if (tabName === 'community') {
      this.loadCommunityData();
    } else if (tabName === 'links') {
      this.loadOrganizationLinks();
    } else if (tabName === 'verseImport') {
      this.loadVerseImportSettings();
    }
  }

  showMobileMenu() {
    document.getElementById('mobileMenuOverlay').classList.remove('hidden');
    // Update mobile nav active state
    this.updateMobileNavActiveState();
  }

  hideMobileMenu() {
    document.getElementById('mobileMenuOverlay').classList.add('hidden');
  }

  updateMobileNavActiveState() {
    // Remove active class from all mobile nav items
    document.querySelectorAll('.mobile-nav-item').forEach(item => {
      item.classList.remove('active');
    });
    
    // Add active class to current tab's mobile nav item
    const currentTab = document.querySelector('.tab-content:not(.hidden)');
    if (currentTab) {
      const tabName = currentTab.id.replace('Content', '');
      const mobileNavItem = document.querySelector(`.mobile-nav-item[data-target="${tabName}Content"]`);
      if (mobileNavItem) {
        mobileNavItem.classList.add('active');
      }
    }
  }

  async loadVerses() {
    try {
      const response = await fetch('/api/admin/verses');
      const data = await response.json();

      if (data.success) {
        this.verses = data.verses;
        this.renderVersesList();
      }
    } catch (error) {
      console.error('Error loading verses:', error);
    }
  }

  renderVersesList() {
    const mobileContainer = document.getElementById('versesList');
    const desktopContainer = document.getElementById('versesTable');
    const verses = this.getFilteredVerses();
    
    if (this.verses.length === 0) {
      const emptyState = `
        <div class="p-8 text-center text-gray-500">
          <div class="text-4xl mb-4">📖</div>
          <p>No verses yet. Create your first daily verse!</p>
        </div>
      `;
      mobileContainer.innerHTML = emptyState;
      desktopContainer.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-gray-500">No verses yet. Create your first daily verse!</td></tr>`;
      return;
    }

    if (verses.length === 0) {
      const emptyFiltered = `
        <div class="p-8 text-center text-gray-500">
          <div class="text-4xl mb-4">🔎</div>
          <p>No verses match your filters.</p>
        </div>
      `;
      mobileContainer.innerHTML = emptyFiltered;
      desktopContainer.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-gray-500">No verses match your filters.</td></tr>`;
      return;
    }

    // Render mobile card view
    mobileContainer.innerHTML = verses.map(verse => `
      <div class="px-4 py-4 flex items-center justify-between hover:bg-gray-50">
        <div class="flex-1">
          <div class="flex items-center space-x-3">
            <div class="flex-shrink-0">
              ${verse.content_type === 'image' 
                ? '<span class="w-8 h-8 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center text-sm">🖼️</span>'
                : '<span class="w-8 h-8 bg-green-100 text-green-600 rounded-lg flex items-center justify-center text-sm">📝</span>'
              }
            </div>
            <div class="flex-1">
              <div class="flex items-center space-x-2">
                <p class="text-sm font-medium text-gray-900">${verse.date}</p>
                ${verse.published ? 
                  '<span class="status-badge status-published">Published</span>' :
                  '<span class="status-badge status-draft">Draft</span>'
                }
              </div>
              <div class="mt-1">
                <p class="text-sm text-gray-600">
                  ${verse.bible_reference || 'No reference'}
                </p>
                ${verse.content_type === 'text' && verse.verse_text ? 
                  `<p class="text-sm text-gray-500 mt-1">${verse.verse_text.substring(0, 100)}${verse.verse_text.length > 100 ? '...' : ''}</p>` :
                  ''
                }
              </div>
              ${verse.tags ? 
                `<div class="mt-2 flex flex-wrap gap-1">
                  ${verse.tags.split(',').map(tag => 
                    `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">${tag.trim()}</span>`
                  ).join('')}
                </div>` :
                ''
              }
            </div>
          </div>
        </div>
        <div class="flex items-center space-x-2">
          <span class="text-sm text-gray-500">❤️ ${verse.hearts || 0}</span>
          <button onclick="adminDashboard.editVerse(${verse.id})" 
                  class="text-primary-600 hover:text-primary-900 text-sm font-medium">Edit</button>
          <button onclick="adminDashboard.deleteVerse(${verse.id})" 
                  class="text-red-600 hover:text-red-900 text-sm font-medium">Delete</button>
        </div>
      </div>
    `).join('');

    // Render desktop table view
    desktopContainer.innerHTML = verses.map(verse => `
      <tr class="hover:bg-gray-50">
        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
          ${verse.date}
        </td>
        <td class="px-6 py-4 whitespace-nowrap">
          <div class="flex items-center">
            ${verse.content_type === 'image' 
              ? '<span class="w-6 h-6 bg-blue-100 text-blue-600 rounded flex items-center justify-center text-xs mr-2">🖼️</span>'
              : '<span class="w-6 h-6 bg-green-100 text-green-600 rounded flex items-center justify-center text-xs mr-2">📝</span>'
            }
            <span class="text-sm text-gray-900 capitalize">${verse.content_type}</span>
          </div>
        </td>
        <td class="px-6 py-4 text-sm text-gray-900">
          <div class="max-w-xs">
            ${verse.content_type === 'text' && verse.verse_text ? 
              `<p class="truncate">${verse.verse_text.substring(0, 80)}${verse.verse_text.length > 80 ? '...' : ''}</p>` :
              '<span class="text-gray-500 italic">Image content</span>'
            }
            ${verse.tags ? 
              `<div class="mt-1 flex flex-wrap gap-1">
                ${verse.tags.split(',').slice(0, 3).map(tag => 
                  `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">${tag.trim()}</span>`
                ).join('')}
                ${verse.tags.split(',').length > 3 ? `<span class="text-xs text-gray-500">+${verse.tags.split(',').length - 3} more</span>` : ''}
              </div>` :
              ''
            }
          </div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
          ${verse.bible_reference || '<span class="text-gray-400 italic">No reference</span>'}
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
          <div class="flex items-center">
            <span class="text-red-500 mr-1">❤️</span>
            ${verse.hearts || 0}
          </div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap">
          ${verse.published ? 
            '<span class="status-badge status-published">Published</span>' :
            '<span class="status-badge status-draft">Draft</span>'
          }
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
          <div class="flex items-center space-x-2">
            <button onclick="adminDashboard.editVerse(${verse.id})" 
                    class="text-primary-600 hover:text-primary-900 font-medium">Edit</button>
            <button onclick="adminDashboard.deleteVerse(${verse.id})" 
                    class="text-red-600 hover:text-red-900 font-medium">Delete</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  getFilteredVerses() {
    let result = [...this.verses];
    const { search, type, status } = this.filters;
    if (type !== 'all') {
      result = result.filter(v => v.content_type === type);
    }
    if (status !== 'all') {
      const shouldBePublished = status === 'published';
      result = result.filter(v => !!v.published === shouldBePublished);
    }
    if (search && search.trim().length > 0) {
      result = result.filter(v => {
        const haystack = [
          v.verse_text || '',
          v.bible_reference || '',
          v.tags || ''
        ].join(' ').toLowerCase();
        return haystack.includes(search);
      });
    }
    return result;
  }

  showVerseModal(verse = null) {
    this.currentEditingVerse = verse;
    
    const modal = document.getElementById('verseModal');
    const title = document.getElementById('modalTitle');
    const form = document.getElementById('verseForm');
    
    // Reset form
    form.reset();
    
    if (verse) {
      title.textContent = 'Edit Verse';
      document.getElementById('verseId').value = verse.id;
      document.getElementById('verseDate').value = verse.date;
      document.getElementById('contentType').value = verse.content_type;
      document.getElementById('verseText').value = verse.verse_text || '';
      document.getElementById('bibleReference').value = verse.bible_reference || '';
      document.getElementById('verseContext').value = verse.context || '';
      document.getElementById('verseTags').value = verse.tags || '';
      document.getElementById('versePublished').checked = !!verse.published;
    } else {
      title.textContent = 'Add New Verse';
      // Set default date to today
      document.getElementById('verseDate').value = new Date().toISOString().split('T')[0];
    }
    
    this.toggleContentFields(document.getElementById('contentType').value);
    modal.classList.remove('hidden');
  }

  hideVerseModal() {
    document.getElementById('verseModal').classList.add('hidden');
    this.currentEditingVerse = null;
  }

  toggleContentFields(contentType) {
    const imageFields = document.getElementById('imageFields');
    const verseText = document.getElementById('verseText');
    const verseImage = document.getElementById('verseImage');
    
    // Verse text is always visible and required for searchability
    verseText.required = true;
    
    if (contentType === 'text') {
      imageFields.classList.add('hidden');
      verseImage.required = false;
    } else {
      // For image verses, show image upload field AND keep text field visible
      imageFields.classList.remove('hidden');
      verseImage.required = !this.currentEditingVerse; // Only required for new image verses
    }
  }

  async handleVerseSubmit() {
    const formData = new FormData();
    const verseId = document.getElementById('verseId').value;
    
    formData.append('date', document.getElementById('verseDate').value);
    formData.append('content_type', document.getElementById('contentType').value);
    formData.append('verse_text', document.getElementById('verseText').value);
    formData.append('bible_reference', document.getElementById('bibleReference').value);
    formData.append('context', document.getElementById('verseContext').value);
    formData.append('tags', document.getElementById('verseTags').value);
    formData.append('published', document.getElementById('versePublished').checked ? '1' : '0');
    
    const imageFile = document.getElementById('verseImage').files[0];
    if (imageFile) {
      formData.append('image', imageFile);
    }

    try {
      const url = verseId ? `/api/admin/verses/${verseId}` : '/api/admin/verses';
      const method = verseId ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method: method,
        body: formData
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.hideVerseModal();
        this.loadVerses();
        this.showToast(verseId ? 'Verse updated successfully!' : 'Verse created successfully!');
      } else {
        this.showToast(data.error || 'Failed to save verse', 'error');
      }
    } catch (error) {
      console.error('Error saving verse:', error);
      this.showToast('Connection error', 'error');
    }
  }

  editVerse(verseId) {
    const verse = this.verses.find(v => v.id === verseId);
    if (verse) {
      this.showVerseModal(verse);
    }
  }

  async deleteVerse(verseId) {
    if (!confirm('Are you sure you want to delete this verse?')) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/verses/${verseId}`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.loadVerses();
        this.showToast('Verse deleted successfully!');
      } else {
        this.showToast(data.error || 'Failed to delete verse', 'error');
      }
    } catch (error) {
      console.error('Error deleting verse:', error);
      this.showToast('Connection error', 'error');
    }
  }

  async loadAnalytics() {
    try {
      const response = await fetch('/api/admin/analytics?days=7');
      const data = await response.json();

      if (data.success) {
        this.renderAnalytics(data.analytics);
      }
    } catch (error) {
      console.error('Error loading analytics:', error);
    }
  }

  renderAnalytics(analytics) {
    // Calculate totals
    const totalViews = analytics.daily_stats.reduce((sum, day) => sum + day.views, 0);
    const totalVisitors = analytics.daily_stats.reduce((sum, day) => sum + day.unique_visitors, 0);
    
    // Calculate total hearts from verses
    const totalHearts = this.verses.reduce((sum, verse) => sum + (verse.hearts || 0), 0);

    // Update stats cards
    document.getElementById('totalViews').textContent = totalViews.toLocaleString();
    document.getElementById('uniqueVisitors').textContent = totalVisitors.toLocaleString();
    document.getElementById('totalHearts').textContent = totalHearts.toLocaleString();

    // Render top verses
    const topVersesList = document.getElementById('topVersesList');
    
    if (analytics.top_verses.length === 0) {
      topVersesList.innerHTML = `
        <li class="px-4 py-4 text-center text-gray-500">
          No verse views in the last 7 days
        </li>
      `;
      return;
    }

    topVersesList.innerHTML = analytics.top_verses.map((verse, index) => `
      <li class="px-4 py-4">
        <div class="flex items-center space-x-3">
          <div class="flex-shrink-0">
            <span class="w-8 h-8 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center text-sm font-medium">
              ${index + 1}
            </span>
          </div>
          <div class="flex-1">
            <div class="flex items-center space-x-2">
              <p class="text-sm font-medium text-gray-900">${verse.date}</p>
              <span class="text-sm text-gray-500">${verse.bible_reference || 'No reference'}</span>
            </div>
            ${verse.verse_text ? 
              `<p class="text-sm text-gray-600 mt-1">${verse.verse_text.substring(0, 80)}${verse.verse_text.length > 80 ? '...' : ''}</p>` :
              ''
            }
          </div>
          <div class="flex-shrink-0 text-right">
            <p class="text-sm font-medium text-gray-900">${verse.views} views</p>
          </div>
        </div>
      </li>
    `).join('');
  }

  showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `fixed top-4 right-4 z-50 max-w-sm w-full bg-white shadow-lg rounded-lg pointer-events-auto flex ring-1 ring-black ring-opacity-5 ${
      type === 'error' ? 'border-l-4 border-red-400' : 'border-l-4 border-green-400'
    }`;
    
    toast.innerHTML = `
      <div class="flex-1 w-0 p-4">
        <div class="flex items-start">
          <div class="flex-shrink-0">
            ${type === 'error' ? 
              '<svg class="h-6 w-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>' :
              '<svg class="h-6 w-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
            }
          </div>
          <div class="ml-3 w-0 flex-1">
            <p class="text-sm font-medium text-gray-900">${message}</p>
          </div>
        </div>
      </div>
      <div class="flex border-l border-gray-200">
        <button onclick="this.parentElement.parentElement.remove()" class="w-full border border-transparent rounded-none rounded-r-lg p-4 flex items-center justify-center text-sm font-medium text-gray-600 hover:text-gray-500 focus:outline-none">
          <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"></path></svg>
        </button>
      </div>
    `;
    
    document.body.appendChild(toast);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
      if (document.body.contains(toast)) {
        toast.remove();
      }
    }, 5000);
  }

  // Community Management Functions
  async loadCommunityData() {
    try {
      const days = document.getElementById('communityDaysFilter')?.value || 7;
      const response = await fetch(`/api/admin/community?days=${days}`);
      const data = await response.json();

      if (data.success) {
        this.renderCommunityData(data.community);
      }
    } catch (error) {
      console.error('Error loading community data:', error);
    }
  }

  renderCommunityData(community) {
    const { prayer_requests, praise_reports, verse_insights } = community;
    
    // Update stats
    document.getElementById('totalPrayerRequests').textContent = prayer_requests.length;
    document.getElementById('totalPraiseReports').textContent = praise_reports.length;
    document.getElementById('totalVerseInsights').textContent = (verse_insights || []).length;

    // Render prayer requests
    this.renderAdminPrayerRequests(prayer_requests);
    
    // Render praise reports
    this.renderAdminPraiseReports(praise_reports);
    
    // Render verse insights
    this.renderAdminVerseInsights(verse_insights || []);
  }

  renderAdminPrayerRequests(prayerRequests) {
    const container = document.getElementById('prayerRequestsAdminList');
    
    if (prayerRequests.length === 0) {
      container.innerHTML = `
        <div class="p-8 text-center text-gray-500">
          <span class="text-2xl">🙏</span>
          <p class="mt-2">No prayer requests found</p>
        </div>
      `;
      return;
    }

    container.innerHTML = prayerRequests.map(request => `
      <div class="px-4 py-4">
        <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
          <div class="flex-1">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2">
              <span class="text-sm font-medium text-gray-900">${request.date}</span>
              <span class="text-xs text-gray-500">${this.formatDateTime(request.created_at)}</span>
              ${request.is_approved ? 
                '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Approved</span>' :
                '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">Pending</span>'
              }
              ${request.is_hidden ? 
                '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">Hidden</span>' :
                ''
              }
            </div>
            <p class="text-sm text-gray-700 mb-2">${this.escapeHtml(request.content)}</p>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
              <span>🙏 ${request.prayer_count || 0} prayers</span>
              <span>IP: ${request.ip_address}</span>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2 lg:ml-4">
            ${!request.is_approved ? 
              `<button onclick="adminDashboard.moderatePrayerRequest(${request.id}, true, false)" class="text-green-600 hover:text-green-900 text-sm font-medium">Approve</button>` :
              `<button onclick="adminDashboard.moderatePrayerRequest(${request.id}, false, false)" class="text-yellow-600 hover:text-yellow-900 text-sm font-medium">Unapprove</button>`
            }
            ${!request.is_hidden ? 
              `<button onclick="adminDashboard.moderatePrayerRequest(${request.id}, ${request.is_approved}, true)" class="text-orange-600 hover:text-orange-900 text-sm font-medium">Hide</button>` :
              `<button onclick="adminDashboard.moderatePrayerRequest(${request.id}, ${request.is_approved}, false)" class="text-blue-600 hover:text-blue-900 text-sm font-medium">Show</button>`
            }
            <button onclick="adminDashboard.deletePrayerRequest(${request.id})" class="text-red-600 hover:text-red-900 text-sm font-medium">Delete</button>
          </div>
        </div>
      </div>
    `).join('');
  }

  renderAdminPraiseReports(praiseReports) {
    const container = document.getElementById('praiseReportsAdminList');
    
    if (praiseReports.length === 0) {
      container.innerHTML = `
        <div class="p-8 text-center text-gray-500">
          <span class="text-2xl">🎉</span>
          <p class="mt-2">No praise reports found</p>
        </div>
      `;
      return;
    }

    container.innerHTML = praiseReports.map(report => `
      <div class="px-4 py-4">
        <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
          <div class="flex-1">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2">
              <span class="text-sm font-medium text-gray-900">${report.date}</span>
              <span class="text-xs text-gray-500">${this.formatDateTime(report.created_at)}</span>
              ${report.is_approved ? 
                '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Approved</span>' :
                '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">Pending</span>'
              }
              ${report.is_hidden ? 
                '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">Hidden</span>' :
                ''
              }
            </div>
            <p class="text-sm text-gray-700 mb-2">${this.escapeHtml(report.content)}</p>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
              <span>🎉 ${report.celebration_count || 0} celebrations</span>
              <span>IP: ${report.ip_address}</span>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2 lg:ml-4">
            ${!report.is_approved ? 
              `<button onclick="adminDashboard.moderatePraiseReport(${report.id}, true, false)" class="text-green-600 hover:text-green-900 text-sm font-medium">Approve</button>` :
              `<button onclick="adminDashboard.moderatePraiseReport(${report.id}, false, false)" class="text-yellow-600 hover:text-yellow-900 text-sm font-medium">Unapprove</button>`
            }
            ${!report.is_hidden ? 
              `<button onclick="adminDashboard.moderatePraiseReport(${report.id}, ${report.is_approved}, true)" class="text-orange-600 hover:text-orange-900 text-sm font-medium">Hide</button>` :
              `<button onclick="adminDashboard.moderatePraiseReport(${report.id}, ${report.is_approved}, false)" class="text-blue-600 hover:text-blue-900 text-sm font-medium">Show</button>`
            }
            <button onclick="adminDashboard.deletePraiseReport(${report.id})" class="text-red-600 hover:text-red-900 text-sm font-medium">Delete</button>
          </div>
        </div>
      </div>
    `).join('');
  }

  async moderatePrayerRequest(id, isApproved, isHidden) {
    try {
      const response = await fetch(`/api/admin/prayer-request/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          is_approved: isApproved,
          is_hidden: isHidden
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.loadCommunityData();
        this.showToast('Prayer request updated successfully!');
      } else {
        this.showToast(data.error || 'Failed to update prayer request', 'error');
      }
    } catch (error) {
      console.error('Error moderating prayer request:', error);
      this.showToast('Connection error', 'error');
    }
  }

  async moderatePraiseReport(id, isApproved, isHidden) {
    try {
      const response = await fetch(`/api/admin/praise-report/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          is_approved: isApproved,
          is_hidden: isHidden
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.loadCommunityData();
        this.showToast('Praise report updated successfully!');
      } else {
        this.showToast(data.error || 'Failed to update praise report', 'error');
      }
    } catch (error) {
      console.error('Error moderating praise report:', error);
      this.showToast('Connection error', 'error');
    }
  }

  async deletePrayerRequest(id) {
    if (!confirm('Are you sure you want to delete this prayer request?')) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/prayer-request/${id}`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.loadCommunityData();
        this.showToast('Prayer request deleted successfully!');
      } else {
        this.showToast(data.error || 'Failed to delete prayer request', 'error');
      }
    } catch (error) {
      console.error('Error deleting prayer request:', error);
      this.showToast('Connection error', 'error');
    }
  }

  async deletePraiseReport(id) {
    if (!confirm('Are you sure you want to delete this praise report?')) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/praise-report/${id}`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.loadCommunityData();
        this.showToast('Praise report deleted successfully!');
      } else {
        this.showToast(data.error || 'Failed to delete praise report', 'error');
      }
    } catch (error) {
      console.error('Error deleting praise report:', error);
      this.showToast('Connection error', 'error');
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  formatDateTime(timestamp) {
    return new Date(timestamp).toLocaleString();
  }

  renderAdminVerseInsights(verseInsights) {
    const container = document.getElementById('verseInsightsAdminList');
    
    if (verseInsights.length === 0) {
      container.innerHTML = `
        <div class="p-8 text-center text-gray-500">
          <span class="text-2xl">💭</span>
          <p class="mt-2">No verse insights found</p>
        </div>
      `;
      return;
    }

    container.innerHTML = verseInsights.map(insight => `
      <div class="px-4 py-4">
        <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
          <div class="flex-1">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2">
              <span class="text-sm font-medium text-gray-900">${insight.date}</span>
              <span class="text-xs text-gray-500">${this.formatDateTime(insight.created_at)}</span>
              ${insight.is_approved ? 
                '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Approved</span>' :
                '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">Pending</span>'
              }
              ${insight.is_hidden ? 
                '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">Hidden</span>' :
                ''
              }
            </div>
            <p class="text-sm text-gray-700 mb-2">${this.escapeHtml(insight.content)}</p>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
              <span>💭 Verse Insight</span>
              <span>IP: ${insight.ip_address}</span>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2 lg:ml-4">
            ${!insight.is_approved ? 
              `<button onclick="adminDashboard.moderateVerseInsight(${insight.id}, true, false)" class="text-green-600 hover:text-green-900 text-sm font-medium">Approve</button>` :
              `<button onclick="adminDashboard.moderateVerseInsight(${insight.id}, false, false)" class="text-yellow-600 hover:text-yellow-900 text-sm font-medium">Unapprove</button>`
            }
            ${!insight.is_hidden ? 
              `<button onclick="adminDashboard.moderateVerseInsight(${insight.id}, ${insight.is_approved}, true)" class="text-orange-600 hover:text-orange-900 text-sm font-medium">Hide</button>` :
              `<button onclick="adminDashboard.moderateVerseInsight(${insight.id}, ${insight.is_approved}, false)" class="text-blue-600 hover:text-blue-900 text-sm font-medium">Show</button>`
            }
            <button onclick="adminDashboard.deleteVerseInsight(${insight.id})" class="text-red-600 hover:text-red-900 text-sm font-medium">Delete</button>
          </div>
        </div>
      </div>
    `).join('');
  }

  async moderateVerseInsight(id, isApproved, isHidden) {
    try {
      const response = await fetch(`/api/admin/verse-insight/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          is_approved: isApproved,
          is_hidden: isHidden
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.loadCommunityData();
        this.showToast('Verse insight updated successfully!');
      } else {
        this.showToast(data.error || 'Failed to update verse insight', 'error');
      }
    } catch (error) {
      console.error('Error moderating verse insight:', error);
      this.showToast('Connection error', 'error');
    }
  }

  async deleteVerseInsight(id) {
    if (!confirm('Are you sure you want to delete this verse insight?')) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/verse-insight/${id}`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.loadCommunityData();
        this.showToast('Verse insight deleted successfully!');
      } else {
        this.showToast(data.error || 'Failed to delete verse insight', 'error');
      }
    } catch (error) {
      console.error('Error deleting verse insight:', error);
      this.showToast('Connection error', 'error');
    }
  }

  // Organization Links Methods
  async loadOrganizationLinks() {
    const loadingEl = document.getElementById('loadingLinksAdmin');
    const tableContainer = document.getElementById('linksTableContainer');
    const noLinksMessage = document.getElementById('noLinksMessage');

    try {
      loadingEl.classList.remove('hidden');
      tableContainer.classList.add('hidden');
      noLinksMessage.classList.add('hidden');

      const response = await fetch('/api/admin/organization/links');
      const links = await response.json();

      if (response.ok && links.length > 0) {
        this.renderLinksTable(links);
        tableContainer.classList.remove('hidden');
      } else {
        noLinksMessage.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Error loading organization links:', error);
      this.showToast('Failed to load links', 'error');
      noLinksMessage.classList.remove('hidden');
    } finally {
      loadingEl.classList.add('hidden');
    }
  }

  renderLinksTable(links) {
    const tbody = document.getElementById('linksTableBody');
    
    tbody.innerHTML = links.map(link => {
      const icon = this.getLinkIcon(link.icon);
      const statusBadge = link.is_active ? 
        '<span class="status-badge status-published">Active</span>' : 
        '<span class="status-badge status-draft">Inactive</span>';

      return `
        <tr class="hover:bg-gray-50">
          <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
            ${link.title}
          </td>
          <td class="px-6 py-4 text-sm text-gray-900">
            <div class="max-w-xs truncate">
              <a href="${link.url}" target="_blank" class="text-primary-600 hover:text-primary-900">
                ${link.url}
              </a>
            </div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
            <span class="text-lg mr-2">${icon}</span>
            ${link.icon}
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            ${statusBadge}
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
            ${link.sort_order}
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
            <div class="flex items-center space-x-2">
              <button onclick="adminDashboard.editLink(${link.id})" 
                      class="text-primary-600 hover:text-primary-900 font-medium">Edit</button>
              <button onclick="adminDashboard.deleteLink(${link.id})" 
                      class="text-red-600 hover:text-red-900 font-medium">Delete</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  getLinkIcon(iconName) {
    const icons = {
      'website': '🌐',
      'facebook': '📘',
      'instagram': '📷',
      'youtube': '📺',
      'twitter': '🐦',
      'email': '📧',
      'phone': '📞',
      'location': '📍',
      'calendar': '📅',
      'donate': '💝',
      'prayer': '🙏',
      'music': '🎵',
      'sermon': '🎙️',
      'bible': '📖',
      'heart': '❤️',
      'star': '⭐',
      'home': '🏠',
      'info': 'ℹ️',
      'contact': '📞',
      'about': '👥'
    };
    return icons[iconName] || '🔗';
  }

  showLinkModal(linkData = null) {
    const modal = document.getElementById('linkModal');
    const modalTitle = document.getElementById('linkModalTitle');
    const form = document.getElementById('linkForm');

    if (linkData) {
      modalTitle.textContent = 'Edit Organization Link';
      document.getElementById('linkTitle').value = linkData.title;
      document.getElementById('linkUrl').value = linkData.url;
      document.getElementById('linkIcon').value = linkData.icon;
      document.getElementById('linkSortOrder').value = linkData.sort_order;
      document.getElementById('linkIsActive').checked = linkData.is_active;
      form.dataset.linkId = linkData.id;
    } else {
      modalTitle.textContent = 'Add Organization Link';
      form.reset();
      document.getElementById('linkIsActive').checked = true;
      delete form.dataset.linkId;
    }

    modal.classList.remove('hidden');
  }

  hideLinkModal() {
    document.getElementById('linkModal').classList.add('hidden');
    document.getElementById('linkForm').reset();
  }

  async saveLinkForm() {
    const form = document.getElementById('linkForm');
    const linkId = form.dataset.linkId;
    
    const linkData = {
      title: document.getElementById('linkTitle').value,
      url: document.getElementById('linkUrl').value,
      icon: document.getElementById('linkIcon').value,
      sort_order: parseInt(document.getElementById('linkSortOrder').value),
      is_active: document.getElementById('linkIsActive').checked
    };

    try {
      const url = linkId ? 
        `/api/admin/organization/links/${linkId}` : 
        '/api/admin/organization/links';
      
      const method = linkId ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(linkData)
      });

      const data = await response.json();

      if (data.success) {
        this.hideLinkModal();
        this.loadOrganizationLinks();
        this.showToast(linkId ? 'Link updated successfully!' : 'Link created successfully!');
      } else {
        this.showToast(data.error || 'Failed to save link', 'error');
      }
    } catch (error) {
      console.error('Error saving link:', error);
      this.showToast('Connection error', 'error');
    }
  }

  async editLink(linkId) {
    try {
      const response = await fetch(`/api/admin/organization/links`);
      const links = await response.json();
      
      const link = links.find(l => l.id === linkId);
      if (link) {
        this.showLinkModal(link);
      } else {
        this.showToast('Link not found', 'error');
      }
    } catch (error) {
      console.error('Error loading link:', error);
      this.showToast('Failed to load link', 'error');
    }
  }

  async deleteLink(linkId) {
    if (!confirm('Are you sure you want to delete this link?')) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/organization/links/${linkId}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (data.success) {
        this.loadOrganizationLinks();
        this.showToast('Link deleted successfully!');
      } else {
        this.showToast(data.error || 'Failed to delete link', 'error');
      }
    } catch (error) {
      console.error('Error deleting link:', error);
      this.showToast('Connection error', 'error');
    }
  }

  // Verse Import Methods
  async loadVerseImportSettings() {
    try {
      const response = await fetch('/api/admin/verse-import/settings');
      const data = await response.json();
      
      if (data.success) {
        const settings = data.settings;
        document.getElementById('importEnabled').checked = settings.enabled;
        document.getElementById('bibleVersion').value = settings.bibleVersion;
        document.getElementById('importTime').value = settings.importTime;
      }
    } catch (error) {
      console.error('Error loading verse import settings:', error);
      this.showToast('Failed to load import settings', 'error');
    }
  }

  async saveImportSettings() {
    const settings = {
      enabled: document.getElementById('importEnabled').checked,
      bibleVersion: document.getElementById('bibleVersion').value,
      importTime: document.getElementById('importTime').value,
      fallbackVersions: ['NIV', 'NLT', 'KJV'] // Default fallback order
    };

    try {
      const response = await fetch('/api/admin/verse-import/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(settings)
      });

      const data = await response.json();

      if (data.success) {
        this.showToast('Import settings saved successfully!');
      } else {
        this.showToast(data.error || 'Failed to save settings', 'error');
      }
    } catch (error) {
      console.error('Error saving import settings:', error);
      this.showToast('Connection error', 'error');
    }
  }

  async checkTodayVerse() {
    const statusContent = document.getElementById('importStatusContent');
    statusContent.innerHTML = '<div class="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>Checking today\'s verse...';

    try {
      const bibleVersion = document.getElementById('bibleVersion').value;
      const response = await fetch('/api/admin/verse-import/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ bibleVersion })
      });

      const data = await response.json();

      if (data.success) {
        if (data.imported) {
          statusContent.innerHTML = `<div class="text-green-600">✅ Successfully imported today's verse: ${data.verse.reference}</div>`;
          this.addImportLog(`Imported verse for today: ${data.verse.reference} (${bibleVersion})`);
        } else {
          statusContent.innerHTML = '<div class="text-blue-600">📋 Verse already exists for today</div>';
        }
      } else {
        statusContent.innerHTML = `<div class="text-red-600">❌ Error: ${data.error}</div>`;
      }
    } catch (error) {
      console.error('Error checking today verse:', error);
      statusContent.innerHTML = '<div class="text-red-600">❌ Connection error</div>';
    }
  }

  async importTodayVerse() {
    const statusContent = document.getElementById('importStatusContent');
    statusContent.innerHTML = '<div class="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-green-600 mr-2"></div>Importing today\'s verse...';

    try {
      const bibleVersion = document.getElementById('bibleVersion').value;
      const today = new Date().toISOString().split('T')[0];
      
      const response = await fetch('/api/admin/verse-import/manual', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ date: today, bibleVersion })
      });

      const data = await response.json();

      if (data.success) {
        statusContent.innerHTML = `<div class="text-green-600">✅ Successfully imported: ${data.verse.reference}</div>`;
        this.addImportLog(`Manually imported verse for today: ${data.verse.reference} (${bibleVersion})`);
        this.showToast('Today\'s verse imported successfully!');
        this.loadVerses(); // Refresh the verses table
      } else {
        statusContent.innerHTML = `<div class="text-red-600">❌ Error: ${data.error}</div>`;
        this.showToast(data.error || 'Failed to import verse', 'error');
      }
    } catch (error) {
      console.error('Error importing today verse:', error);
      statusContent.innerHTML = '<div class="text-red-600">❌ Connection error</div>';
      this.showToast('Connection error', 'error');
    }
  }

  async manualImportVerse() {
    const date = document.getElementById('manualImportDate').value;
    if (!date) {
      this.showToast('Please select a date', 'error');
      return;
    }

    try {
      const bibleVersion = document.getElementById('bibleVersion').value;
      
      const response = await fetch('/api/admin/verse-import/manual', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ date, bibleVersion })
      });

      const data = await response.json();

      if (data.success) {
        this.showToast(`Successfully imported verse for ${date}: ${data.verse.reference}`);
        this.addImportLog(`Manually imported verse for ${date}: ${data.verse.reference} (${bibleVersion})`);
        document.getElementById('manualImportDate').value = '';
        this.loadVerses(); // Refresh the verses table
      } else {
        this.showToast(data.error || 'Failed to import verse', 'error');
      }
    } catch (error) {
      console.error('Error with manual import:', error);
      this.showToast('Connection error', 'error');
    }
  }

  addImportLog(message) {
    const logContainer = document.getElementById('importLog');
    const timestamp = new Date().toLocaleString();
    
    // Remove "no activity" message if present
    const noActivity = logContainer.querySelector('.italic');
    if (noActivity) {
      noActivity.remove();
    }
    
    // Add new log entry
    const logEntry = document.createElement('div');
    logEntry.className = 'flex justify-between items-center py-2 border-b border-gray-100';
    logEntry.innerHTML = `
      <span class="text-gray-700">${message}</span>
      <span class="text-xs text-gray-500">${timestamp}</span>
    `;
    
    logContainer.insertBefore(logEntry, logContainer.firstChild);
    
    // Keep only last 10 entries
    while (logContainer.children.length > 10) {
      logContainer.removeChild(logContainer.lastChild);
    }
  }
}

// Initialize admin dashboard
const adminDashboard = new AdminDashboard();