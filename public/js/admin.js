class AdminDashboard {
  constructor() {
    this.currentAdmin = null;
    this.verses = [];
    this.currentEditingVerse = null;
    this.filters = { search: '', type: 'all', status: 'all' };
    this.brand = null;
    
    // PWA install prompt
    this.deferredPrompt = null;
    this.setupPWAInstall();
    
    this.init();
  }

  init() {
    this.setupEventListeners();
    this.checkAuthStatus();
    this.applySavedBrandTheme();
  }

  // ===== Utilities: local datetime handling for datetime-local inputs =====
  formatDateTimeLocalValue(dateInput) {
    if (!dateInput) return '';
    const d = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day}T${hh}:${mm}`; // local time, no timezone suffix
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

    // PWA Install buttons
    document.getElementById('installPWABtn').addEventListener('click', () => {
      this.installApp();
    });
    
    document.getElementById('installPWABtnMobile').addEventListener('click', () => {
      this.installApp();
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
    document.getElementById('braceletRequestsNav').addEventListener('click', (e) => {
      e.preventDefault();
      this.showTab('braceletRequests');
    });
    document.getElementById('linksNav').addEventListener('click', (e) => {
      e.preventDefault();
      this.showTab('links');
    });
    const eventsNav = document.getElementById('eventsNav');
    if (eventsNav) {
      eventsNav.addEventListener('click', (e) => {
        e.preventDefault();
        this.showTab('events');
      });
    }
    const ctaNav = document.getElementById('ctaNav');
    if (ctaNav) {
      ctaNav.addEventListener('click', (e) => {
        e.preventDefault();
        this.showTab('cta');
      });
    }
    const verseImportNav = document.getElementById('verseImportNav');
    if (verseImportNav) {
      verseImportNav.addEventListener('click', (e) => {
        e.preventDefault();
        this.showTab('verseImport');
      });
    }
    document.getElementById('settingsNav').addEventListener('click', (e) => {
      e.preventDefault();
      this.showTab('settings');
    });

    // Add verse
    document.getElementById('addVerseBtn').addEventListener('click', () => {
      this.showVerseModal();
    });

    // Admin: Events & CTA buttons
    const addEventBtn = document.getElementById('addEventBtn');
    if (addEventBtn) addEventBtn.addEventListener('click', () => this.showEventModal());
    const addFirstEventBtn = document.getElementById('addFirstEventBtn');
    if (addFirstEventBtn) addFirstEventBtn.addEventListener('click', () => this.showEventModal());
    const addCtaBtn = document.getElementById('addCtaBtn');
    if (addCtaBtn) addCtaBtn.addEventListener('click', () => this.showCtaModal());
    const addFirstCtaBtn = document.getElementById('addFirstCtaBtn');
    if (addFirstCtaBtn) addFirstCtaBtn.addEventListener('click', () => this.showCtaModal());

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

    // Bracelet requests refresh button
    const refreshBraceletRequestsBtn = document.getElementById('refreshBraceletRequestsBtn');
    if (refreshBraceletRequestsBtn) {
      refreshBraceletRequestsBtn.addEventListener('click', () => {
        this.loadBraceletRequests();
      });
    }

    // Bracelet requests status filter
    const braceletStatusFilter = document.getElementById('braceletStatusFilter');
    if (braceletStatusFilter) {
      braceletStatusFilter.addEventListener('change', () => {
        this.loadBraceletRequests();
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

    // Users page event listeners
    const refreshUsersBtn = document.getElementById('refreshUsers');
    if (refreshUsersBtn) {
      refreshUsersBtn.addEventListener('click', () => {
        this.loadUsers();
      });
    }

    const userTagSearch = document.getElementById('userTagSearch');
    if (userTagSearch) {
      userTagSearch.addEventListener('input', () => {
        this.filterUsers();
      });
    }

    const userTagFilter = document.getElementById('userTagFilter');
    if (userTagFilter) {
      userTagFilter.addEventListener('change', () => {
        this.filterUsers();
      });
    }

    // User posts modal
    const closeUserPostsModal = document.getElementById('closeUserPostsModal');
    if (closeUserPostsModal) {
      closeUserPostsModal.addEventListener('click', () => {
        this.hideElement('userPostsModal');
      });
    }

    const userPostsModal = document.getElementById('userPostsModal');
    if (userPostsModal) {
      userPostsModal.addEventListener('click', (e) => {
        if (e.target === userPostsModal) {
          this.hideElement('userPostsModal');
        }
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
    
    // Show default tab (dashboard)
    this.showTab('dashboard');
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
      'braceletRequests': 'Bracelet Requests',
      'links': 'Organization Links',
      'verseImport': 'Verse Import',
      'settings': 'Settings'
    };
    document.getElementById('pageTitle').textContent = titleMap[tabName] || 'Dashboard';

    // Load data for specific tabs
    if (tabName === 'dashboard') {
      this.loadDashboard();
    } else if (tabName === 'analytics') {
      this.loadAnalytics();
    } else if (tabName === 'community') {
      this.loadCommunityData();
    } else if (tabName === 'users') {
      this.loadUsers();
    } else if (tabName === 'braceletRequests') {
      this.loadBraceletRequests();
    } else if (tabName === 'links') {
      this.loadOrganizationLinks();
    } else if (tabName === 'verseImport') {
      this.loadVerseImportSettings();
    } else if (tabName === 'events') {
      this.loadEvents();
    } else if (tabName === 'cta') {
      this.loadCtas();
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

  // ===== Events Admin =====
  async loadEvents() {
    const noMsg = document.getElementById('noEventsMessage');
    const table = document.getElementById('eventsTableContainer');
    try {
      const res = await fetch('/api/admin/organization/events');
      const data = await res.json();
      const events = data?.events || [];
      if (events.length === 0) {
        noMsg.classList.remove('hidden');
        table.classList.add('hidden');
        return;
      }
      this.renderEventsTable(events);
      noMsg.classList.add('hidden');
      table.classList.remove('hidden');
    } catch (e) {
      console.error('Error loading events', e);
      noMsg.classList.remove('hidden');
      table.classList.add('hidden');
    }
  }

  renderEventsTable(events) {
    const tbody = document.getElementById('eventsTableBody');
    tbody.innerHTML = events.map(ev => `
      <tr class="hover:bg-gray-50">
        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
          ${ev.title}
          ${ev.is_recurring ? '<span class="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">🔄 Recurring</span>' : ''}
          ${ev.is_instance ? '<span class="ml-2 text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">📅 Instance</span>' : ''}
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${new Date(ev.start_at).toLocaleString()}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${ev.location || ''}</td>
        <td class="px-6 py-4 whitespace-nowrap">${ev.is_active ? '<span class="status-badge status-published">Active</span>' : '<span class="status-badge status-draft">Inactive</span>'}</td>
        <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
          <div class="flex items-center space-x-2">
            <button class="text-primary-600 hover:text-primary-900 font-medium" onclick="adminDashboard.showEventModal(${ev.id})">Edit</button>
            <button class="text-red-600 hover:text-red-900 font-medium" onclick="adminDashboard.deleteEvent(${ev.id})">Delete</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  async showEventModal(id) {
    const creating = !id;
    const ev = creating ? null : (await (await fetch('/api/admin/organization/events')).json()).events.find(e => e.id === id);
    const wrapper = document.createElement('div');
    wrapper.className = 'fixed inset-0 z-50 bg-black/40 flex items-center justify-center';
    wrapper.innerHTML = `
      <div class="bg-white rounded-xl shadow-2xl w-full max-w-xl mx-4 p-5">
        <h3 class="text-lg font-semibold mb-3">${creating ? 'Add Event' : 'Edit Event'}</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label class="text-sm">Title</label>
            <input id="ev_title" class="w-full px-3 py-2 border rounded-md" value="${ev?.title || ''}">
          </div>
          <div>
            <label class="text-sm">All Day</label>
            <input id="ev_all_day" type="checkbox" ${ev?.all_day ? 'checked' : ''}>
          </div>
          <div class="md:col-span-2">
            <label class="text-sm">Description</label>
            <textarea id="ev_description" class="w-full px-3 py-2 border rounded-md">${ev?.description || ''}</textarea>
          </div>
          <div>
            <label class="text-sm">Location (name)</label>
            <input id="ev_location" class="w-full px-3 py-2 border rounded-md" value="${ev?.location || ''}">
          </div>
          <div>
            <label class="text-sm">Address</label>
            <input id="ev_address" class="w-full px-3 py-2 border rounded-md" value="${ev?.address || ''}">
          </div>
          <div>
            <label class="text-sm">Start</label>
            <input id="ev_start" type="datetime-local" class="w-full px-3 py-2 border rounded-md" value="${ev ? this.formatDateTimeLocalValue(ev.start_at) : ''}">
          </div>
          <div>
            <label class="text-sm">End</label>
            <input id="ev_end" type="datetime-local" class="w-full px-3 py-2 border rounded-md" value="${ev?.end_at ? this.formatDateTimeLocalValue(ev.end_at) : ''}">
          </div>
          <div>
            <label class="text-sm">Notify lead (min)</label>
            <input id="ev_notify" type="number" class="w-full px-3 py-2 border rounded-md" value="${ev?.notify_lead_minutes ?? 120}">
          </div>
          <div>
            <label class="text-sm">Details URL</label>
            <input id="ev_link" class="w-full px-3 py-2 border rounded-md" value="${ev?.link || ''}">
          </div>
          <div>
            <label class="text-sm">Active</label>
            <input id="ev_active" type="checkbox" ${ev?.is_active !== false ? 'checked' : ''}>
          </div>
        </div>

        <!-- Recurring Events Section -->
        <div class="mt-4 border-t pt-4">
          <div class="flex items-center mb-3">
            <input id="ev_is_recurring" type="checkbox" ${ev?.is_recurring ? 'checked' : ''} class="mr-2">
            <label class="text-sm font-medium">Recurring Event</label>
          </div>

          <div id="recurring_options" class="${ev?.is_recurring ? '' : 'hidden'} grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label class="text-sm">Repeat</label>
              <select id="ev_recurrence_type" class="w-full px-3 py-2 border rounded-md">
                <option value="weekly" ${ev?.recurrence_type === 'weekly' ? 'selected' : ''}>Weekly</option>
                <option value="daily" ${ev?.recurrence_type === 'daily' ? 'selected' : ''}>Daily</option>
                <option value="monthly" ${ev?.recurrence_type === 'monthly' ? 'selected' : ''}>Monthly</option>
              </select>
            </div>
            <div>
              <label class="text-sm">Every</label>
              <input id="ev_recurrence_interval" type="number" min="1" class="w-full px-3 py-2 border rounded-md" value="${ev?.recurrence_interval || 1}">
            </div>
            <div class="md:col-span-2">
              <label class="text-sm">End Repeat (optional)</label>
              <input id="ev_recurrence_end" type="date" class="w-full px-3 py-2 border rounded-md" value="${ev?.recurrence_end_date ? ev.recurrence_end_date.split('T')[0] : ''}">
            </div>
          </div>
        </div>

        <div class="mt-4 flex justify-end space-x-2">
          <button id="ev_cancel" class="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200">Cancel</button>
          <button id="ev_save" class="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white">Save</button>
        </div>
      </div>`;
    wrapper.addEventListener('click', (e) => { if (e.target === wrapper) wrapper.remove(); });
    document.body.appendChild(wrapper);

    // Toggle recurring options visibility
    const recurringCheckbox = document.getElementById('ev_is_recurring');
    const recurringOptions = document.getElementById('recurring_options');
    recurringCheckbox.addEventListener('change', () => {
      if (recurringCheckbox.checked) {
        recurringOptions.classList.remove('hidden');
      } else {
        recurringOptions.classList.add('hidden');
      }
    });

    document.getElementById('ev_cancel').onclick = () => wrapper.remove();
    document.getElementById('ev_save').onclick = async () => {
      const payload = {
        title: document.getElementById('ev_title').value,
        description: document.getElementById('ev_description').value,
        location: document.getElementById('ev_location').value,
        address: document.getElementById('ev_address').value,
        start_at: document.getElementById('ev_start').value,
        end_at: document.getElementById('ev_end').value || null,
        all_day: document.getElementById('ev_all_day').checked,
        link: document.getElementById('ev_link').value,
        is_active: document.getElementById('ev_active').checked,
        notify_lead_minutes: parseInt(document.getElementById('ev_notify').value || '120', 10),
        is_recurring: document.getElementById('ev_is_recurring').checked,
        recurrence_type: document.getElementById('ev_recurrence_type').value,
        recurrence_interval: parseInt(document.getElementById('ev_recurrence_interval').value || '1', 10),
        recurrence_end_date: document.getElementById('ev_recurrence_end').value || null
      };
      const method = id ? 'PUT' : 'POST';
      const url = id ? `/api/admin/organization/events/${id}` : '/api/admin/organization/events';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.success) {
        wrapper.remove();
        this.loadEvents();
        this.showToast('Event saved!');
      } else {
        this.showToast(data.error || 'Failed to save event', 'error');
      }
    };
  }

  async deleteEvent(id) {
    if (!confirm('Delete this event?')) return;
    const res = await fetch(`/api/admin/organization/events/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      this.loadEvents();
      this.showToast('Event deleted');
    } else {
      this.showToast(data.error || 'Failed to delete event', 'error');
    }
  }

  // ===== CTA Admin =====
  async loadCtas() {
    const noMsg = document.getElementById('noCtasMessage');
    const table = document.getElementById('ctasTableContainer');
    try {
      const res = await fetch('/api/admin/organization/ctas');
      const data = await res.json();
      const ctas = data?.ctas || [];
      if (ctas.length === 0) {
        noMsg.classList.remove('hidden');
        table.classList.add('hidden');
        return;
      }
      this.renderCtasTable(ctas);
      noMsg.classList.add('hidden');
      table.classList.remove('hidden');
    } catch (e) {
      console.error('Error loading CTAs', e);
      noMsg.classList.remove('hidden');
      table.classList.add('hidden');
    }
  }

  renderCtasTable(ctas) {
    const tbody = document.getElementById('ctasTableBody');
    tbody.innerHTML = ctas.map(cta => `
      <tr class="hover:bg-gray-50">
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 truncate max-w-xs">${cta.text}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900"><a href="${cta.url}" target="_blank" class="text-primary-600 underline">${cta.url}</a></td>
        <td class="px-6 py-4 whitespace-nowrap">${cta.is_active ? '<span class="status-badge status-published">Active</span>' : '<span class="status-badge status-draft">Inactive</span>'}</td>
        <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
          <div class="flex items-center space-x-2">
            <button class="text-primary-600 hover:text-primary-900 font-medium" onclick="adminDashboard.showCtaModal(${cta.id})">Edit</button>
            <button class="text-red-600 hover:text-red-900 font-medium" onclick="adminDashboard.deleteCta(${cta.id})">Delete</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  async showCtaModal(id) {
    const creating = !id;
    const cta = creating ? null : (await (await fetch('/api/admin/organization/ctas')).json()).ctas.find(c => c.id === id);
    const wrapper = document.createElement('div');
    wrapper.className = 'fixed inset-0 z-50 bg-black/40 flex items-center justify-center';
    wrapper.innerHTML = `
      <div class="bg-white rounded-xl shadow-2xl w-full max-w-xl mx-4 p-5">
        <h3 class="text-lg font-semibold mb-3">${creating ? 'Add CTA' : 'Edit CTA'}</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div class="md:col-span-2">
            <label class="text-sm">Text</label>
            <textarea id="cta_text" class="w-full px-3 py-2 border rounded-md">${cta?.text || ''}</textarea>
          </div>
          <div class="md:col-span-2">
            <label class="text-sm">URL</label>
            <input id="cta_url" class="w-full px-3 py-2 border rounded-md" value="${cta?.url || ''}">
          </div>
          <div>
            <label class="text-sm">Icon</label>
            <input id="cta_icon" class="w-full px-3 py-2 border rounded-md" value="${cta?.icon || '📣'}">
          </div>
          <div>
            <label class="text-sm">BG Color</label>
            <input id="cta_bg" class="w-full px-3 py-2 border rounded-md" value="${cta?.bg_color || '#0ea5e9'}">
          </div>
          <div>
            <label class="text-sm">Text Color</label>
            <input id="cta_text_color" class="w-full px-3 py-2 border rounded-md" value="${cta?.text_color || '#ffffff'}">
          </div>
          <div>
            <label class="text-sm">Start</label>
            <input id="cta_start" type="datetime-local" class="w-full px-3 py-2 border rounded-md" value="${cta?.start_at ? this.formatDateTimeLocalValue(cta.start_at) : ''}">
          </div>
          <div>
            <label class="text-sm">End</label>
            <input id="cta_end" type="datetime-local" class="w-full px-3 py-2 border rounded-md" value="${cta?.end_at ? this.formatDateTimeLocalValue(cta.end_at) : ''}">
          </div>
          <div>
            <label class="text-sm">Active</label>
            <input id="cta_active" type="checkbox" ${cta?.is_active !== false ? 'checked' : ''}>
          </div>
        </div>
        <div class="mt-4 flex justify-end space-x-2">
          <button id="cta_cancel" class="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200">Cancel</button>
          <button id="cta_save" class="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white">Save</button>
        </div>
      </div>`;
    wrapper.addEventListener('click', (e) => { if (e.target === wrapper) wrapper.remove(); });
    document.body.appendChild(wrapper);
    document.getElementById('cta_cancel').onclick = () => wrapper.remove();
    document.getElementById('cta_save').onclick = async () => {
      const text = document.getElementById('cta_text').value.trim();
      if (!text) {
        this.showToast('Text is required', 'error');
        return;
      }
      
      const payload = {
        text: text,
        url: document.getElementById('cta_url').value.trim() || null,
        icon: document.getElementById('cta_icon').value,
        bg_color: document.getElementById('cta_bg').value,
        text_color: document.getElementById('cta_text_color').value,
        start_at: document.getElementById('cta_start').value || null,
        end_at: document.getElementById('cta_end').value || null,
        is_active: document.getElementById('cta_active').checked
      };
      const method = id ? 'PUT' : 'POST';
      const url = id ? `/api/admin/organization/ctas/${id}` : '/api/admin/organization/ctas';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.success) {
        wrapper.remove();
        this.loadCtas();
        this.showToast('CTA saved!');
      } else {
        this.showToast(data.error || 'Failed to save CTA', 'error');
      }
    };
  }

  async deleteCta(id) {
    if (!confirm('Delete this CTA?')) return;
    const res = await fetch(`/api/admin/organization/ctas/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      this.loadCtas();
      this.showToast('CTA deleted');
    } else {
      this.showToast(data.error || 'Failed to delete CTA', 'error');
    }
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

  async loadDashboard() {
    try {
      console.log('Loading dashboard data...');
      const response = await fetch('/api/admin/dashboard');
      const data = await response.json();
      console.log('Dashboard response:', data);

      if (data.success) {
        this.renderDashboard(data.stats);
      } else {
        console.error('Dashboard API error:', data.error);
      }
    } catch (error) {
      console.error('Error loading dashboard:', error);
    }
  }

  renderDashboard(stats) {
    console.log('Rendering dashboard with stats:', stats);
    // Update dashboard statistics cards
    const dashboardContent = document.getElementById('dashboardContent');
    if (dashboardContent) {
      const statsCards = dashboardContent.querySelectorAll('dd');
      console.log('Found', statsCards.length, 'stat cards');
      
      if (statsCards.length >= 3) {
        statsCards[0].textContent = (stats.total_verses || 0).toLocaleString();
        statsCards[1].textContent = (stats.active_users || 0).toLocaleString();
        statsCards[2].textContent = (stats.total_hearts || 0).toLocaleString();
        console.log('Updated dashboard cards with:', {
          verses: stats.total_verses,
          users: stats.active_users,
          hearts: stats.total_hearts
        });
      }
    } else {
      console.error('Dashboard content element not found');
    }
  }

  async loadBraceletRequests() {
    const loadingEl = document.getElementById('loadingBraceletRequests');
    const tableContainer = document.getElementById('braceletRequestsTableContainer');
    const noRequestsMessage = document.getElementById('noBraceletRequestsMessage');
    const statusFilter = document.getElementById('braceletStatusFilter');

    try {
      if (loadingEl) loadingEl.classList.remove('hidden');
      if (tableContainer) tableContainer.classList.add('hidden');
      if (noRequestsMessage) noRequestsMessage.classList.add('hidden');

      const status = statusFilter?.value || '';
      const url = status ? `/api/admin/organization/bracelet-requests?status=${status}` : '/api/admin/organization/bracelet-requests';
      
      const response = await fetch(url);
      const data = await response.json();

      if (response.ok && data.success && data.requests.length > 0) {
        this.renderBraceletRequestsTable(data.requests);
        if (tableContainer) tableContainer.classList.remove('hidden');
        
        // Update badge count for pending requests
        const pendingCount = data.requests.filter(r => r.status === 'pending').length;
        const badge = document.getElementById('pendingBraceletBadge');
        if (badge) {
          if (pendingCount > 0) {
            badge.textContent = pendingCount;
            badge.classList.remove('hidden');
          } else {
            badge.classList.add('hidden');
          }
        }
      } else {
        if (noRequestsMessage) noRequestsMessage.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Error loading bracelet requests:', error);
      this.showToast('Failed to load bracelet requests', 'error');
      if (noRequestsMessage) noRequestsMessage.classList.remove('hidden');
    } finally {
      if (loadingEl) loadingEl.classList.add('hidden');
    }
  }

  renderBraceletRequestsTable(requests) {
    const tbody = document.getElementById('braceletRequestsTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = requests.map(request => {
      const requestedDate = new Date(request.requested_at).toLocaleDateString();
      const lastActivity = request.last_scanned_at ? new Date(request.last_scanned_at).toLocaleDateString() : 'Never';
      const statusBadge = this.getStatusBadge(request.status);
      
      return `
        <tr class="hover:bg-gray-50">
          <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
            ${request.bracelet_uid}
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            ${statusBadge}
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
            ${requestedDate}
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
            ${lastActivity}
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
            <div class="flex items-center space-x-2">
              ${request.status === 'pending' ? `
                <button onclick="adminDashboard.approveBraceletRequest(${request.id})" 
                        class="text-green-600 hover:text-green-900 font-medium">Approve</button>
                <button onclick="adminDashboard.denyBraceletRequest(${request.id})" 
                        class="text-red-600 hover:text-red-900 font-medium">Deny</button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  getStatusBadge(status) {
    const badges = {
      'pending': '<span class="status-badge status-draft">Pending</span>',
      'approved': '<span class="status-badge status-published">Approved</span>',
      'denied': '<span class="status-badge" style="background-color: #fee2e2; color: #dc2626;">Denied</span>'
    };
    return badges[status] || status;
  }

  async approveBraceletRequest(requestId) {
    if (!confirm('Are you sure you want to approve this bracelet request?')) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/organization/bracelet-requests/${requestId}/approve`, {
        method: 'POST'
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.loadBraceletRequests();
        this.showToast('Bracelet request approved successfully!');
      } else {
        this.showToast(data.error || 'Failed to approve request', 'error');
      }
    } catch (error) {
      console.error('Error approving bracelet request:', error);
      this.showToast('Connection error', 'error');
    }
  }

  async denyBraceletRequest(requestId) {
    const reason = prompt('Please provide a reason for denying this request (optional):');
    if (reason === null) return; // User cancelled
    
    try {
      const response = await fetch(`/api/admin/organization/bracelet-requests/${requestId}/deny`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reason })
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.loadBraceletRequests();
        this.showToast('Bracelet request denied successfully!');
      } else {
        this.showToast(data.error || 'Failed to deny request', 'error');
      }
    } catch (error) {
      console.error('Error denying bracelet request:', error);
      this.showToast('Connection error', 'error');
    }
  }

  async loadUsers() {
    this.showLoading('loadingUsers');
    this.hideElement('usersTableContainer');
    this.hideElement('noUsersMessage');

    try {
      const response = await fetch('/api/admin/users');
      if (!response.ok) throw new Error('Failed to load users');

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to load users');
      }

      this.hideLoading('loadingUsers');

      // Update stats
      const totalTagsEl = document.getElementById('totalTags');
      const activeTagsEl = document.getElementById('activeTags');
      const communityContributorsEl = document.getElementById('communityContributors');

      if (totalTagsEl) totalTagsEl.textContent = data.stats.total_tags.toLocaleString();
      if (activeTagsEl) activeTagsEl.textContent = data.stats.active_tags.toLocaleString();
      if (communityContributorsEl) communityContributorsEl.textContent = data.stats.community_contributors.toLocaleString();

      // Store users data for filtering
      this.usersData = data.users;

      if (data.users.length === 0) {
        this.showElement('noUsersMessage');
      } else {
        this.showElement('usersTableContainer');
        this.renderUsersTable(data.users);
      }

    } catch (error) {
      console.error('Error loading users:', error);
      this.hideLoading('loadingUsers');
      this.showNotification('Error loading user data', 'error');
    }
  }

  renderUsersTable(users) {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    users.forEach(user => {
      const row = document.createElement('tr');
      const lastActivity = user.last_activity ? new Date(user.last_activity).toLocaleDateString() : 'Never';
      const firstActivity = user.first_activity ? new Date(user.first_activity).toLocaleDateString() : 'Never';
      const totalPosts = user.community_posts.total_posts || 0;

      row.innerHTML = `
        <td class="px-6 py-4 whitespace-nowrap">
          <div class="flex items-center">
            <div class="flex-shrink-0 h-8 w-8">
              <div class="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
                <span class="text-xs font-medium text-blue-600">${user.tag_id.slice(-4)}</span>
              </div>
            </div>
            <div class="ml-4">
              <div class="text-sm font-medium text-gray-900">${user.tag_id}</div>
              <div class="text-sm text-gray-500">First: ${firstActivity}</div>
            </div>
          </div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
          ${lastActivity}
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
          <div class="text-sm font-medium">${user.total_interactions}</div>
          <div class="text-xs text-gray-500">${user.active_days} days</div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
          ${user.active_days}
        </td>
        <td class="px-6 py-4 whitespace-nowrap">
          ${totalPosts > 0 ? `
            <div class="flex space-x-2">
              <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                🙏 ${user.community_posts.prayer_count || 0}
              </span>
              <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                🎉 ${user.community_posts.praise_count || 0}
              </span>
              <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                💭 ${user.community_posts.insight_count || 0}
              </span>
            </div>
          ` : `
            <span class="text-sm text-gray-400">No posts</span>
          `}
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
          ${totalPosts > 0 ? `
            <button onclick="adminDashboard.viewUserPosts('${user.tag_id}')"
                    class="text-primary-600 hover:text-primary-900">
              View Posts (${totalPosts})
            </button>
          ` : `
            <span class="text-gray-400">No posts</span>
          `}
        </td>
      `;

      tbody.appendChild(row);
    });
  }

  async viewUserPosts(tagId) {
    document.getElementById('userPostsModalTitle').textContent = `Posts from Tag ${tagId}`;
    document.getElementById('userPostsModalSubtitle').textContent = `Community posts and interactions from ${tagId}`;

    this.showElement('userPostsModal');
    this.showElement('loadingUserPosts');
    this.hideElement('userPostsList');
    this.hideElement('noUserPosts');

    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(tagId)}/posts`);
      if (!response.ok) throw new Error('Failed to load user posts');

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to load user posts');
      }

      this.hideElement('loadingUserPosts');

      // Update modal stats
      document.getElementById('modalPrayerCount').textContent = data.stats.prayer_requests;
      document.getElementById('modalPraiseCount').textContent = data.stats.praise_reports;
      document.getElementById('modalInsightCount').textContent = data.stats.verse_insights;
      document.getElementById('modalTotalCount').textContent = data.stats.total;

      if (data.posts.length === 0) {
        this.showElement('noUserPosts');
      } else {
        this.showElement('userPostsList');
        this.renderUserPosts(data.posts);
      }

    } catch (error) {
      console.error('Error loading user posts:', error);
      this.hideElement('loadingUserPosts');
      this.showNotification('Error loading user posts', 'error');
    }
  }

  renderUserPosts(posts) {
    const container = document.getElementById('userPostsList');
    if (!container) return;

    container.innerHTML = '';

    posts.forEach(post => {
      const postEl = document.createElement('div');
      postEl.className = 'border rounded-lg p-4 bg-white';

      const typeColors = {
        'prayer_request': 'bg-blue-100 text-blue-800',
        'praise_report': 'bg-green-100 text-green-800',
        'verse_insight': 'bg-purple-100 text-purple-800'
      };

      const typeLabels = {
        'prayer_request': '🙏 Prayer Request',
        'praise_report': '🎉 Praise Report',
        'verse_insight': '💭 Verse Insight'
      };

      const createdAt = new Date(post.created_at).toLocaleString();

      postEl.innerHTML = `
        <div class="flex justify-between items-start mb-2">
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${typeColors[post.type]}">
            ${typeLabels[post.type]}
          </span>
          <div class="text-xs text-gray-500">
            ${createdAt}
            ${post.is_hidden ? ' • <span class="text-red-600">Hidden</span>' : ''}
          </div>
        </div>
        <div class="text-sm text-gray-900 mb-2">
          ${this.escapeHtml(post.content)}
        </div>
        <div class="flex justify-between items-center text-xs text-gray-500">
          <span>${post.prayer_count || 0} interactions</span>
          <div class="space-x-2">
            ${post.is_hidden ? `
              <button onclick="adminDashboard.togglePostVisibility('${post.type}', ${post.id}, false)"
                      class="text-green-600 hover:text-green-800">Unhide</button>
            ` : `
              <button onclick="adminDashboard.togglePostVisibility('${post.type}', ${post.id}, true)"
                      class="text-red-600 hover:text-red-800">Hide</button>
            `}
          </div>
        </div>
      `;

      container.appendChild(postEl);
    });
  }

  async togglePostVisibility(type, postId, hide) {
    try {
      const endpoints = {
        'prayer_request': 'prayer-request',
        'praise_report': 'praise-report',
        'verse_insight': 'verse-insight'
      };

      const response = await fetch(`/api/admin/${endpoints[type]}/${postId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: hide ? 'hide' : 'unhide' })
      });

      if (!response.ok) throw new Error('Failed to update post visibility');

      const data = await response.json();
      if (!data.success) throw new Error(data.error);

      this.showNotification(data.message, 'success');

      // Refresh the posts modal
      const tagId = document.getElementById('userPostsModalTitle').textContent.replace('Posts from Tag ', '');
      await this.viewUserPosts(tagId);

    } catch (error) {
      console.error('Error toggling post visibility:', error);
      this.showNotification('Error updating post visibility', 'error');
    }
  }

  filterUsers() {
    if (!this.usersData) return;

    const search = document.getElementById('userTagSearch').value.toLowerCase();
    const filter = document.getElementById('userTagFilter').value;

    let filteredUsers = this.usersData;

    // Apply search filter
    if (search) {
      filteredUsers = filteredUsers.filter(user =>
        user.tag_id.toLowerCase().includes(search)
      );
    }

    // Apply category filter
    if (filter === 'active') {
      filteredUsers = filteredUsers.filter(user => user.total_interactions > 0);
    } else if (filter === 'community') {
      filteredUsers = filteredUsers.filter(user => user.community_posts.total_posts > 0);
    }

    this.renderUsersTable(filteredUsers);
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
    // Update tag/NFC stats cards
    document.getElementById('totalScans').textContent = (analytics.tag_stats.total_scans || 0).toLocaleString();
    document.getElementById('uniqueSessions').textContent = (analytics.tag_stats.unique_sessions || 0).toLocaleString();
    document.getElementById('activeTags').textContent = (analytics.tag_stats.active_tags || 0).toLocaleString();
    document.getElementById('avgEngagement').textContent = `${analytics.tag_stats.avg_interactions_per_session || 0}x`;

    // Render all analytics components
    this.renderTopTags(analytics.top_tags || []);
    this.renderDailyScanChart(analytics.daily_scans || []);
    this.renderGeoMap(analytics.geo_locations || []);
    this.renderHourlyChart(analytics.hourly_patterns || []);
    this.renderEngagementFunnel(analytics.engagement_funnel || []);
    this.renderVisitorRetention(analytics.visitor_retention || {});

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
            <p class="text-sm font-medium text-gray-900">${verse.total_views} views</p>
            <div class="text-xs text-gray-500">
              ❤️ ${verse.hearts} 🌟 ${verse.favorites} 📤 ${verse.shares}
            </div>
          </div>
        </div>
      </li>
    `).join('');
  }

  renderTopTags(topTags) {
    const topTagsList = document.getElementById('topTagsList');
    
    if (topTags.length === 0) {
      topTagsList.innerHTML = `
        <li class="px-4 py-4 text-center text-gray-500">
          No tag activity in the last 7 days
        </li>
      `;
      return;
    }

    topTagsList.innerHTML = topTags.map((tag, index) => {
      const lastScan = new Date(tag.last_scan);
      const timeAgo = this.getTimeAgo(lastScan);
      
      return `
        <li class="px-4 py-4">
          <div class="flex items-center space-x-3">
            <div class="flex-shrink-0">
              <span class="w-8 h-8 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-sm font-medium">
                ${index + 1}
              </span>
            </div>
            <div class="flex-1">
              <div class="flex items-center space-x-2">
                <p class="text-sm font-medium text-gray-900 font-mono">${tag.tag_id}</p>
                ${tag.scans_24h > 0 ? `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Active</span>` : ''}
              </div>
              <p class="text-xs text-gray-500 mt-1">Last scan: ${timeAgo}</p>
            </div>
            <div class="flex-shrink-0 text-right">
              <p class="text-sm font-medium text-gray-900">${tag.total_scans} scans</p>
              <p class="text-xs text-gray-500">${tag.unique_sessions} sessions</p>
            </div>
          </div>
        </li>
      `;
    }).join('');
  }

  renderDailyScanChart(dailyScans) {
    const chartContainer = document.getElementById('dailyScanChart');
    
    if (dailyScans.length === 0) {
      chartContainer.innerHTML = `
        <p class="text-center text-gray-500">No scan data available for the last 7 days</p>
      `;
      return;
    }

    // Create a simple bar chart
    const maxScans = Math.max(...dailyScans.map(day => parseInt(day.scans)));
    console.log('Daily chart data:', dailyScans.map(d => `${d.date.split('T')[0]}:${d.scans}`).join(','));
    console.log('Max scans for daily chart:', maxScans);
    
    chartContainer.innerHTML = `
      <div class="space-y-3">
        ${dailyScans.map(day => {
          const date = new Date(day.date);
          const scans = parseInt(day.scans);
          const sessions = parseInt(day.sessions);
          const percentage = maxScans > 0 ? Math.max(5, (scans / maxScans) * 100) : 5; // Minimum 5% width for visibility
          
          return `
            <div class="flex items-center space-x-3">
              <div class="w-16 text-xs text-gray-500">
                ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
              <div class="flex-1">
                <div class="bg-gray-200 rounded-full h-4 relative">
                  <div class="bg-gradient-to-r from-blue-500 to-blue-600 h-4 rounded-full transition-all duration-500 shadow-sm" 
                       style="width: ${percentage}%"></div>
                  <span class="absolute inset-0 flex items-center justify-center text-xs font-medium text-white mix-blend-difference">
                    ${scans} scans
                  </span>
                </div>
              </div>
              <div class="w-16 text-xs text-gray-500 text-right">
                ${sessions} sessions
              </div>
            </div>
          `;
        }).join('')}
      </div>
      <div class="text-xs text-gray-400 text-center mt-3">
        Total: ${dailyScans.reduce((sum, d) => sum + parseInt(d.scans), 0)} scans over ${dailyScans.length} days
      </div>
    `;
  }

  getTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) {
      return `${diffMins}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else {
      return `${diffDays}d ago`;
    }
  }

  renderGeoMap(geoLocations) {
    const mapContainer = document.getElementById('geoMap');
    
    if (geoLocations.length === 0) {
      mapContainer.innerHTML = `<p class="text-center text-gray-500">No geographic data available</p>`;
      return;
    }

    // Simple list view of locations with scan counts
    mapContainer.innerHTML = `
      <div class="space-y-2 max-h-64 overflow-y-auto">
        ${geoLocations.map(location => `
          <div class="flex items-center justify-between p-2 bg-gray-50 rounded">
            <div>
              <p class="text-sm font-medium text-gray-900">${location.city || 'Unknown'}, ${location.country || 'Unknown'}</p>
              <p class="text-xs text-gray-500">${location.unique_sessions} sessions, ${location.unique_visitors} visitors</p>
            </div>
            <div class="text-right">
              <p class="text-sm font-medium text-blue-600">${location.total_scans} scans</p>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  renderHourlyChart(hourlyPatterns) {
    const chartContainer = document.getElementById('hourlyChart');
    
    if (hourlyPatterns.length === 0) {
      chartContainer.innerHTML = `<p class="text-center text-gray-500">No hourly data available</p>`;
      return;
    }

    // Create 24-hour array and fill with data
    const hourlyData = Array(24).fill().map((_, i) => {
      const hourData = hourlyPatterns.find(h => parseInt(h.hour) === i);
      return {
        hour: i,
        scans: hourData ? parseInt(hourData.total_scans) : 0,
        sessions: hourData ? parseInt(hourData.unique_sessions) : 0
      };
    });

    const maxScans = Math.max(...hourlyData.map(h => h.scans));
    console.log('Hourly chart data:', hourlyData.map(h => `${h.hour}:${h.scans}`).join(','));
    console.log('Max scans for hourly chart:', maxScans);
    
    chartContainer.innerHTML = `
      <div class="relative h-32 mb-8">
        <div class="flex items-end justify-between h-full space-x-1">
          ${hourlyData.map(data => {
            const heightPx = maxScans > 0 ? Math.max(4, (data.scans / maxScans) * 120) : 4; // Use pixels instead of percentage
            const hour12 = data.hour === 0 ? '12a' : data.hour === 12 ? '12p' : data.hour > 12 ? `${data.hour - 12}p` : `${data.hour}a`;
            
            return `
              <div class="flex flex-col items-center flex-1">
                <div class="w-full bg-gradient-to-t from-blue-600 to-blue-400 rounded-t-sm transition-all duration-300 relative group shadow-sm hover:from-blue-700 hover:to-blue-500" 
                     style="height: ${heightPx}px; min-height: 4px; max-width: 20px;" 
                     title="${hour12}: ${data.scans} scans, ${data.sessions} sessions">
                  <div class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-20 shadow-lg">
                    ${hour12}: ${data.scans} scans
                  </div>
                </div>
                <span class="text-xs text-gray-500 mt-1 text-center" style="font-size: 10px;">${hour12}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
      <div class="text-xs text-gray-400 text-center mt-2">
        Peak: ${maxScans} scans at ${hourlyData.find(h => h.scans === maxScans)?.hour || 'N/A'}:00 • Total: ${hourlyData.reduce((sum, h) => sum + h.scans, 0)} scans
      </div>
    `;
  }

  renderEngagementFunnel(engagementFunnel) {
    const funnelContainer = document.getElementById('engagementFunnel');
    
    if (engagementFunnel.length === 0) {
      funnelContainer.innerHTML = `<p class="text-center text-gray-500">No engagement data available</p>`;
      return;
    }

    // Sort funnel stages in logical order
    const stageOrder = ['scan', 'verse_view', 'heart', 'community_action'];
    const sortedFunnel = stageOrder.map(stage => 
      engagementFunnel.find(f => f.stage === stage) || { stage, sessions: 0, total_actions: 0 }
    );

    const maxSessions = Math.max(...sortedFunnel.map(f => parseInt(f.sessions) || 0));
    
    funnelContainer.innerHTML = `
      <div class="space-y-3">
        ${sortedFunnel.map((stage, index) => {
          const sessions = parseInt(stage.sessions) || 0;
          const actions = parseInt(stage.total_actions) || 0;
          const width = maxSessions > 0 ? (sessions / maxSessions) * 100 : 0;
          const stageName = stage.stage.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
          
          // Calculate conversion rate from previous stage
          let conversionRate = '';
          if (index > 0) {
            const prevSessions = parseInt(sortedFunnel[index - 1].sessions) || 0;
            if (prevSessions > 0) {
              const rate = ((sessions / prevSessions) * 100).toFixed(1);
              conversionRate = ` (${rate}%)`;
            }
          }
          
          return `
            <div class="flex items-center space-x-3">
              <div class="w-20 text-sm text-gray-600">${stageName}</div>
              <div class="flex-1">
                <div class="bg-gray-200 rounded-full h-6 relative">
                  <div class="bg-gradient-to-r from-blue-500 to-purple-600 h-6 rounded-full transition-all duration-500" 
                       style="width: ${width}%"></div>
                  <span class="absolute inset-0 flex items-center justify-center text-xs font-medium text-white">
                    ${sessions} sessions${conversionRate}
                  </span>
                </div>
              </div>
              <div class="w-16 text-xs text-gray-500 text-right">${actions} actions</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  renderVisitorRetention(retention) {
    const retentionContainer = document.getElementById('visitorRetention');
    
    const uniqueVisitors = parseInt(retention.unique_visitors) || 0;
    const totalSessions = parseInt(retention.total_sessions) || 0;
    const avgSessions = parseFloat(retention.avg_sessions_per_visitor) || 0;
    const multiTagVisitors = parseInt(retention.multi_tag_visitors) || 0;
    const returnVisitors = parseInt(retention.return_visitors_7d) || 0;
    
    const returnRate = uniqueVisitors > 0 ? ((returnVisitors / uniqueVisitors) * 100).toFixed(1) : 0;
    const multiTagRate = uniqueVisitors > 0 ? ((multiTagVisitors / uniqueVisitors) * 100).toFixed(1) : 0;
    
    retentionContainer.innerHTML = `
      <div class="grid grid-cols-2 gap-4">
        <div class="text-center p-3 bg-blue-50 rounded-lg">
          <div class="text-2xl font-bold text-blue-600">${avgSessions}</div>
          <div class="text-sm text-gray-600">Avg Sessions/Visitor</div>
        </div>
        <div class="text-center p-3 bg-green-50 rounded-lg">
          <div class="text-2xl font-bold text-green-600">${returnRate}%</div>
          <div class="text-sm text-gray-600">Return Rate</div>
        </div>
        <div class="text-center p-3 bg-purple-50 rounded-lg">
          <div class="text-2xl font-bold text-purple-600">${multiTagVisitors}</div>
          <div class="text-sm text-gray-600">Multi-Tag Users</div>
        </div>
        <div class="text-center p-3 bg-yellow-50 rounded-lg">
          <div class="text-2xl font-bold text-yellow-600">${multiTagRate}%</div>
          <div class="text-sm text-gray-600">Cross-Tag Rate</div>
        </div>
      </div>
      <div class="mt-4 text-center">
        <p class="text-sm text-gray-600">
          ${returnVisitors} of ${uniqueVisitors} visitors returned within 7 days
        </p>
      </div>
    `;
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
    const { prayer_requests, praise_reports, verse_insights, recent_prayers, recent_praise, recent_insights } = community;
    
    // Update stats
    document.getElementById('totalPrayerRequests').textContent = prayer_requests.length;
    document.getElementById('totalPraiseReports').textContent = praise_reports.length;
    document.getElementById('totalVerseInsights').textContent = (verse_insights || []).length;

    // Render recent posts (these have IDs for moderation)
    this.renderAdminPrayerRequests(recent_prayers || []);
    this.renderAdminPraiseReports(recent_praise || []);
    this.renderAdminVerseInsights(recent_insights || []);
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
            ${!request.is_hidden ? 
              `<button onclick="adminDashboard.hidePrayerRequest(${request.id})" class="text-orange-600 hover:text-orange-900 text-sm font-medium">Hide</button>` :
              `<button onclick="adminDashboard.unhidePrayerRequest(${request.id})" class="text-blue-600 hover:text-blue-900 text-sm font-medium">Unhide</button>`
            }
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
            ${!report.is_hidden ? 
              `<button onclick="adminDashboard.hidePraiseReport(${report.id})" class="text-orange-600 hover:text-orange-900 text-sm font-medium">Hide</button>` :
              `<button onclick="adminDashboard.unhidePraiseReport(${report.id})" class="text-blue-600 hover:text-blue-900 text-sm font-medium">Unhide</button>`
            }
          </div>
        </div>
      </div>
    `).join('');
  }

  async hidePrayerRequest(id) {
    try {
      const response = await fetch(`/api/admin/prayer-request/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'hide'
        })
      });

      const data = await response.json();
      if (data.success) {
        this.showToast(data.message || 'Prayer request hidden');
        this.loadCommunityData();
      } else {
        this.showToast(data.error || 'Failed to hide prayer request', 'error');
      }
    } catch (error) {
      console.error('Error hiding prayer request:', error);
      this.showToast('Error hiding prayer request', 'error');
    }
  }

  async unhidePrayerRequest(id) {
    try {
      const response = await fetch(`/api/admin/prayer-request/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'unhide'
        })
      });

      const data = await response.json();
      if (data.success) {
        this.showToast(data.message || 'Prayer request unhidden');
        this.loadCommunityData();
      } else {
        this.showToast(data.error || 'Failed to unhide prayer request', 'error');
      }
    } catch (error) {
      console.error('Error unhiding prayer request:', error);
      this.showToast('Error unhiding prayer request', 'error');
    }
  }

  async hidePraiseReport(id) {
    try {
      const response = await fetch(`/api/admin/praise-report/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'hide'
        })
      });

      const data = await response.json();
      if (data.success) {
        this.showToast(data.message || 'Praise report hidden');
        this.loadCommunityData();
      } else {
        this.showToast(data.error || 'Failed to hide praise report', 'error');
      }
    } catch (error) {
      console.error('Error hiding praise report:', error);
      this.showToast('Error hiding praise report', 'error');
    }
  }

  async unhidePraiseReport(id) {
    try {
      const response = await fetch(`/api/admin/praise-report/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'unhide'
        })
      });

      const data = await response.json();
      if (data.success) {
        this.showToast(data.message || 'Praise report unhidden');
        this.loadCommunityData();
      } else {
        this.showToast(data.error || 'Failed to unhide praise report', 'error');
      }
    } catch (error) {
      console.error('Error unhiding praise report:', error);
      this.showToast('Error unhiding praise report', 'error');
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
            ${!insight.is_hidden ? 
              `<button onclick="adminDashboard.hideVerseInsight(${insight.id})" class="text-orange-600 hover:text-orange-900 text-sm font-medium">Hide</button>` :
              `<button onclick="adminDashboard.unhideVerseInsight(${insight.id})" class="text-blue-600 hover:text-blue-900 text-sm font-medium">Unhide</button>`
            }
          </div>
        </div>
      </div>
    `).join('');
  }

  async hideVerseInsight(id) {
    try {
      const response = await fetch(`/api/admin/verse-insight/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'hide'
        })
      });

      const data = await response.json();
      if (data.success) {
        this.showToast(data.message || 'Verse insight hidden');
        this.loadCommunityData();
      } else {
        this.showToast(data.error || 'Failed to hide verse insight', 'error');
      }
    } catch (error) {
      console.error('Error hiding verse insight:', error);
      this.showToast('Error hiding verse insight', 'error');
    }
  }

  async unhideVerseInsight(id) {
    try {
      const response = await fetch(`/api/admin/verse-insight/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'unhide'
        })
      });

      const data = await response.json();
      if (data.success) {
        this.showToast(data.message || 'Verse insight unhidden');
        this.loadCommunityData();
      } else {
        this.showToast(data.error || 'Failed to unhide verse insight', 'error');
      }
    } catch (error) {
      console.error('Error unhiding verse insight:', error);
      this.showToast('Error unhiding verse insight', 'error');
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

  // ===========================
  // BRACELET REQUESTS METHODS
  // ===========================
  
  async loadBraceletRequests() {
    const loadingEl = document.getElementById('loadingBraceletRequests');
    const tableContainer = document.getElementById('braceletRequestsTableContainer');
    const noRequestsMessage = document.getElementById('noBraceletRequestsMessage');
    
    try {
      loadingEl.classList.remove('hidden');
      tableContainer.classList.add('hidden');
      noRequestsMessage.classList.add('hidden');
      
      const status = document.getElementById('braceletStatusFilter')?.value || '';
      const url = status ? `/api/admin/bracelet-requests?status=${status}` : '/api/admin/bracelet-requests';
      
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.success) {
        this.displayBraceletRequests(data.requests);
        this.updatePendingBraceletBadge(data.requests);
      } else {
        this.showToast(data.error || 'Failed to load bracelet requests', 'error');
      }
    } catch (error) {
      console.error('Error loading bracelet requests:', error);
      this.showToast('Connection error', 'error');
    } finally {
      loadingEl.classList.add('hidden');
    }
  }
  
  displayBraceletRequests(requests) {
    const tableContainer = document.getElementById('braceletRequestsTableContainer');
    const noRequestsMessage = document.getElementById('noBraceletRequestsMessage');
    const tableBody = document.getElementById('braceletRequestsTableBody');
    
    if (requests.length === 0) {
      tableContainer.classList.add('hidden');
      noRequestsMessage.classList.remove('hidden');
      return;
    }
    
    tableContainer.classList.remove('hidden');
    noRequestsMessage.classList.add('hidden');
    
    tableBody.innerHTML = requests.map(request => `
      <tr class="hover:bg-gray-50">
        <td class="px-6 py-4 whitespace-nowrap">
          <div class="text-sm font-medium text-gray-900">${request.bracelet_uid}</div>
          ${request.scan_count ? `<div class="text-xs text-gray-500">Scans: ${request.scan_count}</div>` : ''}
        </td>
        <td class="px-6 py-4 whitespace-nowrap">
          ${this.getBraceletStatusBadge(request.status)}
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
          ${new Date(request.requested_at).toLocaleDateString()}
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
          ${request.last_scanned_at ? new Date(request.last_scanned_at).toLocaleDateString() : 'Never'}
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
          ${request.status === 'pending' ? `
            <div class="flex justify-end space-x-2">
              <button onclick="adminDashboard.approveBraceletRequest(${request.id})" 
                      class="inline-flex items-center px-3 py-1 border border-transparent text-xs font-medium rounded-md text-white bg-green-600 hover:bg-green-700">
                ✅ Approve
              </button>
              <button onclick="adminDashboard.denyBraceletRequest(${request.id})" 
                      class="inline-flex items-center px-3 py-1 border border-transparent text-xs font-medium rounded-md text-white bg-red-600 hover:bg-red-700">
                ❌ Deny
              </button>
            </div>
          ` : `
            <span class="text-gray-500">
              ${request.status === 'approved' ? '✅ Approved' : '❌ Denied'}
              ${request.approved_by_username ? ` by ${request.approved_by_username}` : ''}
            </span>
          `}
        </td>
      </tr>
    `).join('');
  }
  
  getBraceletStatusBadge(status) {
    const statusConfig = {
      'pending': { color: 'yellow', text: 'Pending' },
      'approved': { color: 'green', text: 'Approved' },
      'denied': { color: 'red', text: 'Denied' }
    };
    
    const config = statusConfig[status] || { color: 'gray', text: status };
    
    return `
      <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-${config.color}-100 text-${config.color}-800">
        ${config.text}
      </span>
    `;
  }
  
  updatePendingBraceletBadge(requests) {
    const badge = document.getElementById('pendingBraceletBadge');
    const pendingCount = requests.filter(r => r.status === 'pending').length;
    
    if (badge) {
      if (pendingCount > 0) {
        badge.textContent = pendingCount;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
  }
  
  async approveBraceletRequest(requestId) {
    if (!confirm('Are you sure you want to approve this bracelet request?')) {
      return;
    }
    
    try {
      const response = await fetch(`/api/admin/bracelet-requests/${requestId}/approve`, {
        method: 'POST'
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.loadBraceletRequests();
        this.showToast('Bracelet request approved successfully!');
      } else {
        this.showToast(data.error || 'Failed to approve request', 'error');
      }
    } catch (error) {
      console.error('Error approving bracelet request:', error);
      this.showToast('Connection error', 'error');
    }
  }
  
  async denyBraceletRequest(requestId) {
    const reason = prompt('Optional: Enter a reason for denial:');
    
    if (!confirm('Are you sure you want to deny this bracelet request?')) {
      return;
    }
    
    try {
      const response = await fetch(`/api/admin/bracelet-requests/${requestId}/deny`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reason })
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.loadBraceletRequests();
        this.showToast('Bracelet request denied successfully!');
      } else {
        this.showToast(data.error || 'Failed to deny request', 'error');
      }
    } catch (error) {
      console.error('Error denying bracelet request:', error);
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

  // PWA Install Functions
  setupPWAInstall() {
    window.addEventListener('beforeinstallprompt', (e) => {
      console.log('CT Admin PWA install prompt available');
      e.preventDefault();
      this.deferredPrompt = e;
    });

    window.addEventListener('appinstalled', () => {
      console.log('CT Admin PWA was installed');
      this.deferredPrompt = null;
      
      // Update button text to show it was installed
      this.updateInstallButtonText('✓ CT Admin Installed');
    });
  }

  updateInstallButtonText(text) {
    const btns = [
      document.getElementById('installPWABtn'),
      document.getElementById('installPWABtnMobile')
    ];
    
    btns.forEach(btn => {
      if (btn) {
        btn.innerHTML = btn.innerHTML.replace('Install CT Admin', text);
        btn.disabled = true;
        btn.classList.remove('bg-green-600', 'hover:bg-green-700');
        btn.classList.add('bg-gray-500');
      }
    });
  }

  async installApp() {
    if (!this.deferredPrompt) {
      alert('CT Admin PWA install is not available. This may be because:\n\n• The app is already installed\n• Your browser doesn\'t support PWA installation\n• The page needs to be served over HTTPS\n\nTry refreshing the page or check browser compatibility.');
      return;
    }

    try {
      this.deferredPrompt.prompt();
      const { outcome } = await this.deferredPrompt.userChoice;
      
      if (outcome === 'accepted') {
        console.log('Admin accepted the install prompt');
        this.updateInstallButtonText('Installing...');
      } else {
        console.log('Admin dismissed the install prompt');
      }
      
      this.deferredPrompt = null;
    } catch (error) {
      console.error('Admin install prompt error:', error);
      alert('Failed to install CT Admin PWA. Please try again.');
    }
  }
}

// Initialize admin dashboard
const adminDashboard = new AdminDashboard();