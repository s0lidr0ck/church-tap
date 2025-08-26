class MasterPortal {
  constructor() {
    this.currentMasterAdmin = null;
    this.organizations = [];
    this.currentEditingOrganization = null;
    
    this.init();
  }

  async openViewAdminsModal(orgId) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
      <div class="bg-white rounded-xl max-w-lg w-full p-6">
        <h3 class="text-lg font-semibold mb-4">Organization Admins</h3>
        <div id="orgAdminsList" class="space-y-3">
          <div class="text-sm text-gray-500">Loading...</div>
        </div>
        <div class="flex justify-end pt-4">
          <button id="closeOrgAdmins" class="btn-secondary">Close</button>
        </div>
      </div>
    `;
    modal.addEventListener('click', (e) => {
      if (e.target === modal) document.body.removeChild(modal);
    });
    document.body.appendChild(modal);

    document.getElementById('closeOrgAdmins').addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    try {
      const resp = await fetch(`/api/master/organizations/${orgId}/admins`);
      const data = await resp.json();
      const list = document.getElementById('orgAdminsList');
      if (data.success && Array.isArray(data.admins)) {
        if (data.admins.length === 0) {
          list.innerHTML = '<div class="text-sm text-gray-500">No admins found.</div>';
        } else {
          list.innerHTML = data.admins.map(a => `
            <div class="flex items-center justify-between p-3 border rounded-lg">
              <div>
                <div class="text-sm font-medium text-gray-900">${a.username}</div>
                <div class="text-xs text-gray-500">${a.email || ''}</div>
              </div>
              <div class="flex items-center space-x-3 text-xs text-gray-600">
                <span class="mr-1">${a.role || 'admin'}</span>
                <span class="${a.is_active ? 'text-green-600' : 'text-red-600'}">${a.is_active ? 'Active' : 'Inactive'}</span>
                <button data-action="toggle-admin-active" data-org-id="${orgId}" data-admin-id="${a.id}" class="text-blue-600 hover:text-blue-800">
                  ${a.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          `).join('');
        }
      } else {
        list.innerHTML = '<div class="text-sm text-red-600">Failed to load admins.</div>';
      }
    } catch (err) {
      const list = document.getElementById('orgAdminsList');
      list.innerHTML = '<div class="text-sm text-red-600">Connection error.</div>';
    }

    // Event delegation for toggle buttons inside the modal
    document.getElementById('orgAdminsList').addEventListener('click', async (e) => {
      const target = e.target;
      if (target && target.matches('[data-action="toggle-admin-active"]')) {
        const orgIdAttr = target.getAttribute('data-org-id');
        const adminId = target.getAttribute('data-admin-id');
        const isDeactivate = target.textContent.trim().toLowerCase() === 'deactivate';
        try {
          const resp = await fetch(`/api/master/organizations/${orgIdAttr}/admins/${adminId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: !isDeactivate })
          });
          const data = await resp.json();
          if (data.success) {
            this.openViewAdminsModal(orgIdAttr); // reload modal content
            this.showToast('Admin status updated');
          } else {
            this.showToast(data.error || 'Failed to update admin', 'error');
          }
        } catch (err) {
          this.showToast('Connection error', 'error');
        }
      }
    }, { once: true });
  }

  init() {
    this.setupEventListeners();
    this.checkMasterAuthStatus();
    this.applySavedBrandTheme();
  }

  setupEventListeners() {
    // Login form
    document.getElementById('masterLoginForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleMasterLogin();
    });

    // Logout
    document.getElementById('masterLogoutBtn').addEventListener('click', () => {
      this.handleMasterLogout();
    });

    // Mobile menu
    document.getElementById('masterMobileMenuBtn').addEventListener('click', () => {
      this.showMasterMobileMenu();
    });
    
    document.getElementById('closeMasterMobileMenu').addEventListener('click', () => {
      this.hideMasterMobileMenu();
    });
    
    document.getElementById('masterMobileMenuBackdrop').addEventListener('click', () => {
      this.hideMasterMobileMenu();
    });

    // Mobile navigation items
    document.querySelectorAll('.master-mobile-nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const target = item.getAttribute('data-target');
        const tabName = target.replace('MasterContent', '').replace('Master', '');
        this.showMasterTab(tabName);
        this.hideMasterMobileMenu();
      });
    });

    // Mobile logout
    document.getElementById('masterMobileLogoutBtn').addEventListener('click', () => {
      this.handleMasterLogout();
    });

    // Navigation
    document.getElementById('dashboardMasterNav').addEventListener('click', (e) => {
      e.preventDefault();
      this.showMasterTab('dashboard');
    });
    document.getElementById('organizationsMasterNav').addEventListener('click', (e) => {
      e.preventDefault();
      this.showMasterTab('organizations');
    });
    // Handle creating and viewing admins for an organization (event delegation)
    document.addEventListener('click', (e) => {
      const target = e.target;
      if (target && target.matches('[data-action="create-org-admin"]')) {
        const orgId = target.getAttribute('data-org-id');
        this.openCreateAdminModal(orgId);
      }
      if (target && target.matches('[data-action="view-org-admins"]')) {
        const orgId = target.getAttribute('data-org-id');
        this.openViewAdminsModal(orgId);
      }
    });
    document.getElementById('billingMasterNav').addEventListener('click', (e) => {
      e.preventDefault();
      this.showMasterTab('billing');
    });
    document.getElementById('analyticsMasterNav').addEventListener('click', (e) => {
      e.preventDefault();
      this.showMasterTab('analytics');
    });
    document.getElementById('tagActivitiesMasterNav').addEventListener('click', (e) => {
      e.preventDefault();
      this.showMasterTab('tagActivities');
    });
    document.getElementById('supportMasterNav').addEventListener('click', (e) => {
      e.preventDefault();
      this.showMasterTab('support');
    });
    const systemNav = document.getElementById('systemMasterNav');
    if (systemNav) {
      systemNav.addEventListener('click', (e) => {
        e.preventDefault();
        this.showMasterTab('system');
      });
    }
    const nfcTagsNav = document.getElementById('nfcTagsMasterNav');
    if (nfcTagsNav) {
      nfcTagsNav.addEventListener('click', (e) => {
        e.preventDefault();
        this.showMasterTab('nfcTags');
      });
    }

    // Menu text theme toggle
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
          const saved = localStorage.getItem('brandTheme');
          const theme = saved ? JSON.parse(saved) : {};
          theme.menuText = next;
          localStorage.setItem('brandTheme', JSON.stringify(theme));
        } catch (e) {}
      });
    }

    // Organization management
    document.getElementById('addOrganizationBtn').addEventListener('click', () => {
      this.showOrganizationModal();
    });

    // Organization modal
    document.getElementById('cancelOrganizationModal').addEventListener('click', () => {
      this.hideOrganizationModal();
    });

    document.getElementById('organizationModal').addEventListener('click', (e) => {
      if (e.target === document.getElementById('organizationModal')) {
        this.hideOrganizationModal();
      }
    });

    // Organization form
    document.getElementById('organizationForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleOrganizationSubmit();
    });

    // Search and filters
    document.getElementById('organizationSearch').addEventListener('input', (e) => {
      this.filterOrganizations();
    });

    document.getElementById('organizationFilter').addEventListener('change', (e) => {
      this.filterOrganizations();
    });

    // Auto-generate subdomain from name
    document.getElementById('organizationName').addEventListener('input', (e) => {
      const name = e.target.value;
      const subdomain = name.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 20);
      document.getElementById('organizationSubdomain').value = subdomain;
    });

    // NFC Tag Management
    const addNFCTagBtn = document.getElementById('addNFCTagBtn');
    if (addNFCTagBtn) {
      addNFCTagBtn.addEventListener('click', () => {
        this.showNFCTagModal();
      });
    }

    const bulkCreateTagsBtn = document.getElementById('bulkCreateTagsBtn');
    if (bulkCreateTagsBtn) {
      bulkCreateTagsBtn.addEventListener('click', () => {
        this.showBulkNFCTagModal();
      });
    }


    // NFC Tag modals
    const cancelNFCTagModal = document.getElementById('cancelNFCTagModal');
    if (cancelNFCTagModal) {
      cancelNFCTagModal.addEventListener('click', () => {
        this.hideNFCTagModal();
      });
    }

    const cancelBulkNFCTagModal = document.getElementById('cancelBulkNFCTagModal');
    if (cancelBulkNFCTagModal) {
      cancelBulkNFCTagModal.addEventListener('click', () => {
        this.hideBulkNFCTagModal();
      });
    }

    const cancelAssignNFCTagModal = document.getElementById('cancelAssignNFCTagModal');
    if (cancelAssignNFCTagModal) {
      cancelAssignNFCTagModal.addEventListener('click', () => {
        this.hideAssignNFCTagModal();
      });
    }

    const cancelNFCWriteModal = document.getElementById('cancelNFCWriteModal');
    if (cancelNFCWriteModal) {
      cancelNFCWriteModal.addEventListener('click', () => {
        this.hideNFCWriteModal();
      });
    }


    // NFC Tag forms
    const nfcTagForm = document.getElementById('nfcTagForm');
    if (nfcTagForm) {
      nfcTagForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleNFCTagSubmit();
      });
    }

    const bulkNFCTagForm = document.getElementById('bulkNFCTagForm');
    if (bulkNFCTagForm) {
      bulkNFCTagForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleBulkNFCTagSubmit();
      });
    }

    const assignNFCTagForm = document.getElementById('assignNFCTagForm');
    if (assignNFCTagForm) {
      assignNFCTagForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleAssignNFCTagSubmit();
      });
    }


    // NFC Tag search and filters
    const nfcTagSearch = document.getElementById('nfcTagSearch');
    if (nfcTagSearch) {
      nfcTagSearch.addEventListener('input', () => {
        this.filterNFCTags();
      });
    }

    const nfcTagStatusFilter = document.getElementById('nfcTagStatusFilter');
    if (nfcTagStatusFilter) {
      nfcTagStatusFilter.addEventListener('change', () => {
        this.filterNFCTags();
      });
    }

    const nfcTagBatchFilter = document.getElementById('nfcTagBatchFilter');
    if (nfcTagBatchFilter) {
      nfcTagBatchFilter.addEventListener('change', () => {
        this.filterNFCTags();
      });
    }

    // Bulk preview update
    const bulkBatchName = document.getElementById('bulkBatchName');
    if (bulkBatchName) {
      bulkBatchName.addEventListener('input', this.updateBulkPreview.bind(this));
    }
    
    const bulkTagPrefix = document.getElementById('bulkTagPrefix');
    if (bulkTagPrefix) {
      bulkTagPrefix.addEventListener('input', this.updateBulkPreview.bind(this));
    }
    
    const bulkTagCount = document.getElementById('bulkTagCount');
    if (bulkTagCount) {
      bulkTagCount.addEventListener('input', this.updateBulkPreview.bind(this));
    }

    // NFC Write functionality
    const startNFCWrite = document.getElementById('startNFCWrite');
    if (startNFCWrite) {
      startNFCWrite.addEventListener('click', () => {
        this.startNFCWrite();
      });
    }
  }

  applySavedBrandTheme() {
    try {
      const saved = localStorage.getItem('brandTheme');
      if (saved) {
        const theme = JSON.parse(saved);
        if (theme.menuText) document.documentElement.style.setProperty('--menu-text', theme.menuText);
        if (theme.primary) document.documentElement.style.setProperty('--brand-primary', theme.primary);
        if (theme.accent) document.documentElement.style.setProperty('--brand-accent', theme.accent);
        if (theme.bg) document.documentElement.style.setProperty('--brand-bg', theme.bg);
        if (theme.muted) document.documentElement.style.setProperty('--brand-muted', theme.muted);
        if (theme.success) document.documentElement.style.setProperty('--brand-success', theme.success);
        if (theme.black) document.documentElement.style.setProperty('--brand-black', theme.black);
      }
    } catch (e) {}
  }

  async checkMasterAuthStatus() {
    try {
      const response = await fetch('/api/master/check-session');
      const data = await response.json();
      
      if (data.success && data.authenticated) {
        this.currentMasterAdmin = data.admin;
        this.showMasterDashboard();
        this.loadDashboardData();
      } else {
        this.showMasterLogin();
      }
    } catch (error) {
      this.showMasterLogin();
    }
  }

  async handleMasterLogin() {
    const username = document.getElementById('masterUsername').value;
    const password = document.getElementById('masterPassword').value;
    const errorEl = document.getElementById('masterLoginError');

    try {
      const response = await fetch('/api/master/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (data.success) {
        this.currentMasterAdmin = data.admin;
        this.showMasterDashboard();
        this.loadDashboardData();
      } else {
        errorEl.textContent = data.error || 'Login failed';
        errorEl.classList.remove('hidden');
      }
    } catch (error) {
      errorEl.textContent = 'Connection error';
      errorEl.classList.remove('hidden');
    }
  }

  async handleMasterLogout() {
    try {
      await fetch('/api/master/logout', { method: 'POST' });
    } catch (error) {
      console.error('Master logout error:', error);
    }
    
    this.currentMasterAdmin = null;
    this.showMasterLogin();
  }

  showMasterLogin() {
    document.getElementById('masterLoginScreen').classList.remove('hidden');
    document.getElementById('masterDashboard').classList.add('hidden');
    document.getElementById('masterLoginError').classList.add('hidden');
    document.getElementById('masterUsername').value = '';
    document.getElementById('masterPassword').value = '';
  }

  showMasterDashboard() {
    document.getElementById('masterLoginScreen').classList.add('hidden');
    document.getElementById('masterDashboard').classList.remove('hidden');
    
    if (this.currentMasterAdmin) {
      document.getElementById('masterAdminUsername').textContent = this.currentMasterAdmin.username;
      
      // Update mobile master admin display
      const mobileMasterAdminUsernameEl = document.getElementById('masterMobileAdminUsername');
      if (mobileMasterAdminUsernameEl) {
        mobileMasterAdminUsernameEl.textContent = this.currentMasterAdmin.username;
      }
      
      // Update avatar initials
      const initial = this.currentMasterAdmin.username.charAt(0).toUpperCase();
      const masterMobileAvatarEl = document.getElementById('masterMobileAdminAvatar');
      if (masterMobileAvatarEl) {
        masterMobileAvatarEl.textContent = initial;
      }
    }
    
    // Show default tab
    this.showMasterTab('dashboard');
  }

  showMasterTab(tabName) {
    // Update navigation relying on CSS only
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`${tabName}MasterNav`);
    if (activeBtn) {
      activeBtn.classList.add('active');
    }

    // Update content
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.add('hidden');
    });
    
    const contentElement = document.getElementById(`${tabName}MasterContent`);
    if (contentElement) {
      contentElement.classList.remove('hidden');
    }

    // Update page title with icons
    const titleMap = {
      'dashboard': '🚀 Master Dashboard',
      'organizations': '🏢 Organizations',
      'nfcTags': '🏷️ NFC Tags',
      'billing': '💳 Billing & Plans', 
      'analytics': '📈 Global Analytics',
      'tagActivities': '🏃 Tag Activities',
      'support': '🎧 Support',
      'system': '⚙️ System Settings'
    };
    const titleEl = document.getElementById('masterPageTitle');
    if (titleEl) {
      titleEl.innerHTML = titleMap[tabName] || '🚀 Master Dashboard';
    }

    // Load data for specific tabs
    if (tabName === 'organizations') {
      this.loadOrganizations();
    } else if (tabName === 'nfcTags') {
      this.loadNFCTags();
      this.loadNFCTagBatches();
    } else if (tabName === 'analytics') {
      this.loadGlobalAnalytics();
    } else if (tabName === 'tagActivities') {
      this.loadTagActivities();
    }
  }

  showMasterMobileMenu() {
    document.getElementById('masterMobileMenuOverlay').classList.remove('hidden');
    // Update mobile nav active state
    this.updateMasterMobileNavActiveState();
  }

  hideMasterMobileMenu() {
    document.getElementById('masterMobileMenuOverlay').classList.add('hidden');
  }

  updateMasterMobileNavActiveState() {
    // Remove active class from all mobile nav items
    document.querySelectorAll('.master-mobile-nav-item').forEach(item => {
      item.classList.remove('active');
    });
    
    // Add active class to current tab's mobile nav item
    const currentTab = document.querySelector('.tab-content:not(.hidden)');
    if (currentTab) {
      const mobileNavItem = document.querySelector(`.master-mobile-nav-item[data-target="${currentTab.id}"]`);
      if (mobileNavItem) {
        mobileNavItem.classList.add('active');
      }
    }
  }

  async loadDashboardData() {
    try {
      const overviewResp = await fetch('/api/master/overview');
      const overview = await overviewResp.json();

      if (overview.success) {
        const t = overview.totals || {};
        document.getElementById('totalOrganizations').textContent = (t.totalOrganizations || 0).toLocaleString();
        document.getElementById('activeOrganizations').textContent = (t.activeOrganizations || 0).toLocaleString();
        // Placeholder revenue remains tied to plan_type in legacy endpoint for now
        document.getElementById('totalUsers').textContent = (t.totalUsers || 0).toLocaleString();

        // Populate recent orgs with top active orgs for now
        this.renderRecentOrganizations(overview.topActiveOrgs || []);
        // System alerts placeholder
        this.renderSystemAlerts([]);

        // Render global 7-day activity chart
        if (Array.isArray(overview.globalDaily) && overview.globalDaily.length > 0) {
          this.renderGlobalActivityChart(overview.globalDaily);
        }
      }
      document.getElementById('monthlyRevenue').textContent = '$0';
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    }
  }

  renderGlobalActivityChart(daily) {
    const ctx = document.getElementById('globalActivityChart');
    if (!ctx) return;

    const labels = daily.map(d => d.date);
    const views = daily.map(d => d.views);
    const uniques = daily.map(d => d.uniqueVisitors);

    // Destroy existing chart if any to avoid overlap
    if (this._globalChart && this._globalChart.destroy) {
      this._globalChart.destroy();
    }

    this._globalChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Views',
            data: views,
            borderColor: 'rgba(59, 130, 246, 1)',
            backgroundColor: 'rgba(59, 130, 246, 0.15)',
            fill: true,
            tension: 0.35,
            borderWidth: 2
          },
          {
            label: 'Unique Visitors',
            data: uniques,
            borderColor: 'rgba(16, 185, 129, 1)',
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            fill: true,
            tension: 0.35,
            borderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
          },
          tooltip: {
            mode: 'index',
            intersect: false
          }
        },
        interaction: {
          mode: 'index',
          intersect: false
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#6B7280' }
          },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(107,114,128,0.15)' },
            ticks: { color: '#6B7280' }
          }
        }
      }
    });
  }

  renderRecentOrganizations(organizations) {
    const container = document.getElementById('recentOrganizations');
    
    if (!organizations || organizations.length === 0) {
      container.innerHTML = '<p class="text-gray-500 text-sm">No recent organizations</p>';
      return;
    }

    container.innerHTML = organizations.map(org => `
      <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
        <div class="flex items-center">
          <div class="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
            <span class="text-blue-600 text-sm">🏢</span>
          </div>
          <div>
            <div class="text-sm font-medium text-gray-900">${org.name}</div>
            <div class="text-xs text-gray-500">${org.subdomain}.churchtap.app</div>
          </div>
        </div>
        <span class="text-xs text-gray-400">${org.last_activity ? this.formatDate(org.last_activity) : this.formatDate(org.created_at || new Date().toISOString())}</span>
      </div>
    `).join('');
  }

  renderSystemAlerts(alerts) {
    const container = document.getElementById('systemAlerts');
    
    if (alerts.length === 0) {
      container.innerHTML = '<p class="text-gray-500 text-sm">✅ All systems operational</p>';
      return;
    }

    container.innerHTML = alerts.map(alert => `
      <div class="flex items-start p-3 bg-yellow-50 rounded-lg">
        <span class="text-yellow-500 mr-2">${alert.type === 'warning' ? '⚠️' : '🔴'}</span>
        <div>
          <div class="text-sm font-medium text-gray-900">${alert.title}</div>
          <div class="text-xs text-gray-600">${alert.message}</div>
        </div>
      </div>
    `).join('');
  }

  async loadOrganizations() {
    try {
      const response = await fetch('/api/master/organizations');
      const data = await response.json();

      if (data.success) {
        this.organizations = data.organizations;
        this.renderOrganizations();
      }
    } catch (error) {
      console.error('Error loading organizations:', error);
    }
  }

  renderOrganizations() {
    const container = document.getElementById('organizationsTable');
    
    if (this.organizations.length === 0) {
      container.innerHTML = `
        <tr>
          <td colspan="6" class="text-center py-8 text-gray-500">
            No organizations yet. Create your first organization!
          </td>
        </tr>
      `;
      return;
    }

    container.innerHTML = this.organizations.map(org => `
      <tr class="hover:bg-gray-50">
        <td class="px-6 py-4 whitespace-nowrap">
          <div class="flex items-center">
            <div class="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
              <span class="text-blue-600">🏢</span>
            </div>
            <div>
              <div class="text-sm font-medium text-gray-900">${org.name}</div>
              <div class="text-sm text-gray-500">${org.contact_email || 'No email'}</div>
            </div>
          </div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap">
          <span class="text-sm text-gray-900">${org.subdomain}.churchtap.app</span>
          ${org.custom_domain ? `<br><span class="text-xs text-gray-500">${org.custom_domain}</span>` : ''}
        </td>
        <td class="px-6 py-4 whitespace-nowrap">
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${this.getPlanBadgeClass(org.plan_type)}">
            ${org.plan_type.charAt(0).toUpperCase() + org.plan_type.slice(1)}
          </span>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${org.verse_count ?? '-'}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${org.admin_count ?? '-'}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${org.user_count ?? '-'}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${org.last_activity ? this.formatDate(org.last_activity) : '—'}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${org.views_7d ?? 0}</td>
        <td class="px-6 py-4 whitespace-nowrap">
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${org.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
            ${org.is_active ? 'Active' : 'Inactive'}
          </span>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
          ${this.formatDate(org.created_at)}
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
          <div class="flex items-center justify-end space-x-2">
            <button onclick="masterPortal.editOrganization(${org.id})" class="text-blue-600 hover:text-blue-900">Edit</button>
            <button onclick="masterPortal.viewOrganization(${org.id})" class="text-indigo-600 hover:text-indigo-900">View</button>
            <button onclick="masterPortal.deleteOrganization(${org.id})" class="text-red-600 hover:text-red-900">Delete</button>
            <button data-action="create-org-admin" data-org-id="${org.id}" class="text-green-600 hover:text-green-900">Add Admin</button>
            <button data-action="view-org-admins" data-org-id="${org.id}" class="text-gray-700 hover:text-gray-900">View Admins</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  openCreateAdminModal(orgId) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
      <div class="bg-white rounded-xl max-w-md w-full p-6">
        <h3 class="text-lg font-semibold mb-4">Create Organization Admin</h3>
        <form id="createOrgAdminForm" class="space-y-4">
          <input type="hidden" id="createOrgId" value="${orgId}">
          <div>
            <label class="block text-sm font-medium mb-1">Username</label>
            <input id="createAdminUsername" type="text" required class="w-full p-2 border rounded">
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Email (optional)</label>
            <input id="createAdminEmail" type="email" class="w-full p-2 border rounded">
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Password</label>
            <input id="createAdminPassword" type="password" minlength="6" required class="w-full p-2 border rounded">
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Role</label>
            <select id="createAdminRole" class="w-full p-2 border rounded">
              <option value="admin">Admin</option>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
          <div class="flex justify-end space-x-2 pt-2">
            <button type="button" id="cancelCreateOrgAdmin" class="btn-secondary">Cancel</button>
            <button type="submit" class="btn-primary">Create Admin</button>
          </div>
          <div id="createOrgAdminError" class="hidden text-sm text-red-600 mt-2"></div>
        </form>
      </div>
    `;

    modal.addEventListener('click', (e) => {
      if (e.target === modal) document.body.removeChild(modal);
    });

    document.body.appendChild(modal);

    document.getElementById('cancelCreateOrgAdmin').addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    document.getElementById('createOrgAdminForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = document.getElementById('createOrgAdminError');
      errorEl.classList.add('hidden');

      const id = document.getElementById('createOrgId').value;
      const username = document.getElementById('createAdminUsername').value.trim();
      const email = document.getElementById('createAdminEmail').value.trim();
      const password = document.getElementById('createAdminPassword').value;
      const role = document.getElementById('createAdminRole').value;

      try {
        const resp = await fetch(`/api/master/organizations/${id}/admins`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, email, password, role })
        });
        const data = await resp.json();
        if (data.success) {
          document.body.removeChild(modal);
          this.showToast('Admin user created successfully!');
        } else {
          errorEl.textContent = data.error || 'Failed to create admin';
          errorEl.classList.remove('hidden');
        }
      } catch (err) {
        errorEl.textContent = 'Connection error';
        errorEl.classList.remove('hidden');
      }
    });
  }

  getPlanBadgeClass(plan) {
    const classes = {
      'basic': 'bg-gray-100 text-gray-800',
      'premium': 'bg-blue-100 text-blue-800', 
      'enterprise': 'bg-purple-100 text-purple-800'
    };
    return classes[plan] || 'bg-gray-100 text-gray-800';
  }

  filterOrganizations() {
    const search = document.getElementById('organizationSearch').value.toLowerCase();
    const planFilter = document.getElementById('organizationFilter').value;
    
    const filtered = this.organizations.filter(org => {
      const matchesSearch = org.name.toLowerCase().includes(search) || 
                           org.subdomain.toLowerCase().includes(search) ||
                           (org.contact_email || '').toLowerCase().includes(search);
      const matchesPlan = !planFilter || org.plan_type === planFilter;
      
      return matchesSearch && matchesPlan;
    });

    // Temporarily update organizations for rendering
    const originalOrganizations = this.organizations;
    this.organizations = filtered;
    this.renderOrganizations();
    this.organizations = originalOrganizations;
  }

  showOrganizationModal(organization = null) {
    this.currentEditingOrganization = organization;
    
    const modal = document.getElementById('organizationModal');
    const title = document.getElementById('organizationModalTitle');
    const form = document.getElementById('organizationForm');
    
    // Reset form
    form.reset();
    
    if (organization) {
      title.textContent = '✏️ Edit Organization';
      document.getElementById('organizationId').value = organization.id;
      document.getElementById('organizationName').value = organization.name;
      document.getElementById('organizationSubdomain').value = organization.subdomain;
      document.getElementById('organizationEmail').value = organization.contact_email || '';
      document.getElementById('organizationPlan').value = organization.plan_type;
      document.getElementById('organizationCustomDomain').value = organization.custom_domain || '';
    } else {
      title.textContent = '✨ Add New Organization';
    }
    
    modal.classList.remove('hidden');
  }

  hideOrganizationModal() {
    document.getElementById('organizationModal').classList.add('hidden');
    this.currentEditingOrganization = null;
  }

  async handleOrganizationSubmit() {
    const formData = {
      name: document.getElementById('organizationName').value,
      subdomain: document.getElementById('organizationSubdomain').value,
      contact_email: document.getElementById('organizationEmail').value,
      plan_type: document.getElementById('organizationPlan').value,
      custom_domain: document.getElementById('organizationCustomDomain').value
    };

    try {
      const orgId = document.getElementById('organizationId').value;
      const url = orgId ? `/api/master/organizations/${orgId}` : '/api/master/organizations';
      const method = orgId ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData)
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.hideOrganizationModal();
        this.loadOrganizations();
        this.showToast(orgId ? 'Organization updated successfully!' : 'Organization created successfully!');
      } else {
        this.showToast(data.error || 'Failed to save organization', 'error');
      }
    } catch (error) {
      console.error('Error saving organization:', error);
      this.showToast('Connection error', 'error');
    }
  }

  editOrganization(orgId) {
    const organization = this.organizations.find(o => o.id === orgId);
    if (organization) {
      this.showOrganizationModal(organization);
    }
  }

  viewOrganization(orgId) {
    const organization = this.organizations.find(o => o.id === orgId);
    if (organization) {
      // Open organization's admin panel in new tab
      window.open(`https://${organization.subdomain}.churchtap.app/admin`, '_blank');
    }
  }

  async deleteOrganization(orgId) {
    const organization = this.organizations.find(o => o.id === orgId);
    if (!organization) return;

    if (!confirm(`Are you sure you want to delete "${organization.name}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/master/organizations/${orgId}`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.loadOrganizations();
        this.showToast('Organization deleted successfully!');
      } else {
        this.showToast(data.error || 'Failed to delete organization', 'error');
      }
    } catch (error) {
      console.error('Error deleting organization:', error);
      this.showToast('Connection error', 'error');
    }
  }

  formatDate(dateString) {
    return new Date(dateString).toLocaleDateString();
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

  // ============================
  // NFC TAG MANAGEMENT METHODS
  // ============================

  async loadNFCTags() {
    try {
      const response = await fetch('/api/master/nfc-tags');
      const data = await response.json();

      if (data.success) {
        this.nfcTags = data.tags;
        this.renderNFCTags();
        this.updateNFCTagStatistics();
      }
    } catch (error) {
      console.error('Error loading NFC tags:', error);
    }
  }

  async loadNFCTagBatches() {
    try {
      const response = await fetch('/api/master/nfc-tags/batches');
      const data = await response.json();

      if (data.success) {
        const batchFilter = document.getElementById('nfcTagBatchFilter');
        // Clear existing options except first
        batchFilter.innerHTML = '<option value="">All Batches</option>';
        
        data.batches.forEach(batch => {
          const option = document.createElement('option');
          option.value = batch.batch_name;
          option.textContent = `${batch.batch_name} (${batch.available_count}/${batch.tag_count})`;
          batchFilter.appendChild(option);
        });
      }
    } catch (error) {
      console.error('Error loading NFC tag batches:', error);
    }
  }

  updateNFCTagStatistics() {
    const total = this.nfcTags.length;
    const available = this.nfcTags.filter(tag => tag.status === 'available').length;
    const assigned = this.nfcTags.filter(tag => tag.status === 'assigned').length;
    const active = this.nfcTags.filter(tag => tag.status === 'active').length;

    document.getElementById('totalNFCTags').textContent = total.toLocaleString();
    document.getElementById('availableNFCTags').textContent = available.toLocaleString();
    document.getElementById('assignedNFCTags').textContent = assigned.toLocaleString();
    document.getElementById('activeNFCTags').textContent = active.toLocaleString();
  }

  renderNFCTags() {
    const container = document.getElementById('nfcTagsTable');
    
    if (!this.nfcTags || this.nfcTags.length === 0) {
      container.innerHTML = `
        <tr>
          <td colspan="8" class="text-center py-8 text-gray-500">
            No NFC tags yet. Create your first batch!
          </td>
        </tr>
      `;
      return;
    }

    container.innerHTML = this.nfcTags.map(tag => `
      <tr class="hover:bg-gray-50">
        <td class="px-6 py-4 whitespace-nowrap">
          <div class="flex items-center">
            <div class="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
              <span class="text-blue-600 text-sm">🏷️</span>
            </div>
            <div>
              <div class="text-sm font-medium text-gray-900">${tag.custom_id}</div>
              ${tag.nfc_id ? `<div class="text-xs text-gray-500">${tag.nfc_id}</div>` : ''}
            </div>
          </div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${tag.batch_name || '—'}</td>
        <td class="px-6 py-4 whitespace-nowrap">
          ${tag.organization_name ? 
            `<div class="text-sm text-gray-900">${tag.organization_name}</div>
             <div class="text-xs text-gray-500">${tag.subdomain}</div>` 
            : '<span class="text-sm text-gray-500">—</span>'}
        </td>
        <td class="px-6 py-4 whitespace-nowrap">
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${this.getNFCTagStatusBadgeClass(tag.status)}">
            ${tag.status.charAt(0).toUpperCase() + tag.status.slice(1)}
          </span>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${tag.scan_count || 0}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${tag.last_scanned_at ? this.formatDate(tag.last_scanned_at) : '—'}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${tag.assigned_at ? this.formatDate(tag.assigned_at) : '—'}</td>
        <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
          <div class="flex items-center justify-end space-x-2">
            ${tag.status === 'available' ? `
              <button onclick="masterPortal.assignNFCTag(${tag.id})" class="text-blue-600 hover:text-blue-900">Assign</button>
            ` : ''}
            ${tag.status === 'assigned' && tag.organization_name ? `
              <button onclick="masterPortal.writeNFCTag(${tag.id})" class="text-green-600 hover:text-green-900">Write</button>
            ` : ''}
            <button onclick="masterPortal.editNFCTagStatus(${tag.id})" class="text-indigo-600 hover:text-indigo-900">Status</button>
            <button onclick="masterPortal.deleteNFCTag(${tag.id})" class="text-red-600 hover:text-red-900">Delete</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  getNFCTagStatusBadgeClass(status) {
    const classes = {
      'available': 'bg-green-100 text-green-800',
      'assigned': 'bg-blue-100 text-blue-800',
      'active': 'bg-purple-100 text-purple-800',
      'inactive': 'bg-gray-100 text-gray-800',
      'lost': 'bg-red-100 text-red-800'
    };
    return classes[status] || 'bg-gray-100 text-gray-800';
  }

  filterNFCTags() {
    const search = document.getElementById('nfcTagSearch').value.toLowerCase();
    const statusFilter = document.getElementById('nfcTagStatusFilter').value;
    const batchFilter = document.getElementById('nfcTagBatchFilter').value;
    
    const filtered = this.nfcTags.filter(tag => {
      const matchesSearch = tag.custom_id.toLowerCase().includes(search) || 
                           (tag.organization_name || '').toLowerCase().includes(search) ||
                           (tag.batch_name || '').toLowerCase().includes(search);
      const matchesStatus = !statusFilter || tag.status === statusFilter;
      const matchesBatch = !batchFilter || tag.batch_name === batchFilter;
      
      return matchesSearch && matchesStatus && matchesBatch;
    });

    // Temporarily update tags for rendering
    const originalTags = this.nfcTags;
    this.nfcTags = filtered;
    this.renderNFCTags();
    this.nfcTags = originalTags;
  }

  showNFCTagModal() {
    document.getElementById('nfcTagModal').classList.remove('hidden');
    document.getElementById('nfcTagForm').reset();
  }

  hideNFCTagModal() {
    document.getElementById('nfcTagModal').classList.add('hidden');
  }

  showBulkNFCTagModal() {
    document.getElementById('bulkNFCTagModal').classList.remove('hidden');
    document.getElementById('bulkNFCTagForm').reset();
    this.updateBulkPreview();
  }

  hideBulkNFCTagModal() {
    document.getElementById('bulkNFCTagModal').classList.add('hidden');
  }

  updateBulkPreview() {
    const batchName = document.getElementById('bulkBatchName').value || 'BATCH2024-01';
    const prefix = document.getElementById('bulkTagPrefix').value;
    const count = document.getElementById('bulkTagCount').value || 50;
    
    const baseId = prefix || batchName;
    const previewText = count > 1 ? 
      `${baseId}-001, ${baseId}-002, ... ${baseId}-${count.toString().padStart(3, '0')}` :
      `${baseId}-001`;
    
    document.getElementById('bulkPreview').textContent = previewText;
  }

  async handleNFCTagSubmit() {
    const formData = {
      custom_id: document.getElementById('nfcTagCustomId').value,
      batch_name: document.getElementById('nfcTagBatchName').value,
      notes: document.getElementById('nfcTagNotes').value
    };

    try {
      const response = await fetch('/api/master/nfc-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.hideNFCTagModal();
        this.loadNFCTags();
        this.loadNFCTagBatches();
        this.showToast('NFC tag created successfully!');
      } else {
        this.showToast(data.error || 'Failed to create NFC tag', 'error');
      }
    } catch (error) {
      console.error('Error creating NFC tag:', error);
      this.showToast('Connection error', 'error');
    }
  }

  async handleBulkNFCTagSubmit() {
    const formData = {
      batch_name: document.getElementById('bulkBatchName').value,
      count: parseInt(document.getElementById('bulkTagCount').value),
      prefix: document.getElementById('bulkTagPrefix').value,
      notes: document.getElementById('bulkTagNotes').value
    };

    try {
      const response = await fetch('/api/master/nfc-tags/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.hideBulkNFCTagModal();
        this.loadNFCTags();
        this.loadNFCTagBatches();
        this.showToast(`${data.created_count} NFC tags created successfully!`);
      } else {
        this.showToast(data.error || 'Failed to create NFC tags', 'error');
      }
    } catch (error) {
      console.error('Error creating bulk NFC tags:', error);
      this.showToast('Connection error', 'error');
    }
  }

  assignNFCTag(tagId) {
    const tag = this.nfcTags.find(t => t.id === tagId);
    if (!tag) return;

    // Load organizations for the select dropdown
    this.loadOrganizationsForAssignment();

    document.getElementById('assignTagId').value = tagId;
    document.getElementById('assignTagCustomId').textContent = tag.custom_id;
    document.getElementById('assignNFCId').value = '';
    
    document.getElementById('assignNFCTagModal').classList.remove('hidden');
  }

  async loadOrganizationsForAssignment() {
    try {
      const response = await fetch('/api/master/organizations');
      const data = await response.json();

      if (data.success) {
        const select = document.getElementById('assignOrganization');
        select.innerHTML = '<option value="">Select Organization...</option>';
        
        data.organizations.forEach(org => {
          const option = document.createElement('option');
          option.value = org.id;
          option.textContent = `${org.name} (${org.subdomain})`;
          select.appendChild(option);
        });
      }
    } catch (error) {
      console.error('Error loading organizations:', error);
    }
  }

  hideAssignNFCTagModal() {
    document.getElementById('assignNFCTagModal').classList.add('hidden');
  }

  async handleAssignNFCTagSubmit() {
    const tagId = document.getElementById('assignTagId').value;
    const organizationId = document.getElementById('assignOrganization').value;
    const nfcId = document.getElementById('assignNFCId').value;

    try {
      const response = await fetch(`/api/master/nfc-tags/${tagId}/assign`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id: organizationId, nfc_id: nfcId })
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.hideAssignNFCTagModal();
        this.loadNFCTags();
        this.showToast('NFC tag assigned successfully!');
      } else {
        this.showToast(data.error || 'Failed to assign NFC tag', 'error');
      }
    } catch (error) {
      console.error('Error assigning NFC tag:', error);
      this.showToast('Connection error', 'error');
    }
  }

  writeNFCTag(tagId) {
    const tag = this.nfcTags.find(t => t.id === tagId);
    if (!tag) return;

    document.getElementById('writeTagCustomId').textContent = tag.custom_id;
    document.getElementById('writeTagOrganization').textContent = tag.organization_name;
    
    // Reset modal state
    document.getElementById('nfcWriteReady').classList.remove('hidden');
    document.getElementById('nfcWriteProgress').classList.add('hidden');
    document.getElementById('nfcWriteSuccess').classList.add('hidden');
    document.getElementById('nfcWriteError').classList.add('hidden');
    
    this.currentWriteTag = tag;
    document.getElementById('nfcWriteModal').classList.remove('hidden');
  }

  hideNFCWriteModal() {
    document.getElementById('nfcWriteModal').classList.add('hidden');
    this.currentWriteTag = null;
  }

  async startNFCWrite() {
    if (!this.currentWriteTag) return;
    
    // Check for NFC support
    if (!('NDEFWriter' in window)) {
      this.showNFCWriteError('NFC writing not supported on this device');
      return;
    }

    try {
      // Show progress
      document.getElementById('nfcWriteReady').classList.add('hidden');
      document.getElementById('nfcWriteProgress').classList.remove('hidden');

      const ndef = new NDEFWriter();
      
      // Create the URL to write
      const orgUrl = this.currentWriteTag.custom_domain || 
                     `${this.currentWriteTag.subdomain}.churchtap.app`;
      const fullUrl = `https://${orgUrl}`;
      
      await ndef.write({
        records: [{
          recordType: "url",
          data: fullUrl
        }]
      });

      // Update tag status to active
      await this.updateNFCTagStatus(this.currentWriteTag.id, 'active');
      
      // Show success
      document.getElementById('nfcWriteProgress').classList.add('hidden');
      document.getElementById('nfcWriteSuccess').classList.remove('hidden');
      
      this.loadNFCTags(); // Refresh the list
      
    } catch (error) {
      console.error('NFC write error:', error);
      this.showNFCWriteError(error.message || 'Failed to write to NFC tag');
    }
  }

  showNFCWriteError(message) {
    document.getElementById('nfcWriteReady').classList.add('hidden');
    document.getElementById('nfcWriteProgress').classList.add('hidden');
    document.getElementById('nfcWriteError').classList.remove('hidden');
    document.getElementById('nfcWriteErrorMessage').textContent = message;
  }

  async updateNFCTagStatus(tagId, status) {
    try {
      const response = await fetch(`/api/master/nfc-tags/${tagId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      
      return await response.json();
    } catch (error) {
      console.error('Error updating NFC tag status:', error);
      return { success: false, error: 'Connection error' };
    }
  }

  editNFCTagStatus(tagId) {
    const tag = this.nfcTags.find(t => t.id === tagId);
    if (!tag) return;

    const statuses = ['available', 'assigned', 'active', 'inactive', 'lost'];
    const currentIndex = statuses.indexOf(tag.status);
    const nextIndex = (currentIndex + 1) % statuses.length;
    const newStatus = statuses[nextIndex];
    
    const confirmation = confirm(`Change status from "${tag.status}" to "${newStatus}"?`);
    if (confirmation) {
      this.updateNFCTagStatus(tagId, newStatus).then(data => {
        if (data.success) {
          this.loadNFCTags();
          this.showToast(`Status updated to ${newStatus}`);
        } else {
          this.showToast(data.error || 'Failed to update status', 'error');
        }
      });
    }
  }

  async deleteNFCTag(tagId) {
    const tag = this.nfcTags.find(t => t.id === tagId);
    if (!tag) return;

    if (!confirm(`Are you sure you want to delete NFC tag "${tag.custom_id}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/master/nfc-tags/${tagId}`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.loadNFCTags();
        this.loadNFCTagBatches();
        this.showToast('NFC tag deleted successfully!');
      } else {
        this.showToast(data.error || 'Failed to delete NFC tag', 'error');
      }
    } catch (error) {
      console.error('Error deleting NFC tag:', error);
      this.showToast('Connection error', 'error');
    }
  }

  loadGlobalAnalytics() {
    // Initialize analytics when the tab is first opened
    if (!this.analyticsInitialized) {
      this.initAnalytics();
      this.analyticsInitialized = true;
    }
    
    // Initialize the map when analytics tab is opened
    setTimeout(() => {
      this.initMap();
    }, 100); // Small delay to ensure DOM is ready
    
    // Load analytics stats
    this.loadAnalyticsStats();
  }

  // Analytics functionality
  initAnalytics() {
    this.map = null;
    this.mapMarkers = [];
    this.currentTimeframe = '7d';
    this.currentOrganization = '';
    
    // Load organizations for filter dropdown
    this.loadAnalyticsOrganizations();
    
    // Set up event listeners
    document.getElementById('analyticsTimeframe').addEventListener('change', (e) => {
      this.currentTimeframe = e.target.value;
      this.loadMapData();
      this.loadAnalyticsStats();
    });
    
    document.getElementById('analyticsOrganization').addEventListener('change', (e) => {
      this.currentOrganization = e.target.value;
      this.loadMapData();
      this.loadAnalyticsStats();
    });
  }

  async loadAnalyticsOrganizations() {
    try {
      const response = await fetch('/api/master/organizations');
      const data = await response.json();
      
      if (data.success) {
        const select = document.getElementById('analyticsOrganization');
        
        // Clear existing options except the first one
        while (select.children.length > 1) {
          select.removeChild(select.lastChild);
        }
        
        data.organizations.forEach(org => {
          const option = document.createElement('option');
          option.value = org.id;
          option.textContent = `${org.name} (${org.subdomain})`;
          select.appendChild(option);
        });
      }
    } catch (error) {
      console.error('Error loading organizations for analytics:', error);
    }
  }

  initMap() {
    if (this.map) {
      return; // Already initialized
    }

    // Check if map element exists
    const mapElement = document.getElementById('worldMap');
    if (!mapElement) {
      console.error('Map element not found');
      return;
    }

    // Initialize Leaflet map centered on US
    this.map = L.map('worldMap').setView([39.8283, -98.5795], 4);
    
    // Add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    this.loadMapData();
  }

  async loadMapData() {
    if (!this.map) return;

    try {
      const params = new URLSearchParams({
        timeframe: this.currentTimeframe
      });
      
      if (this.currentOrganization) {
        params.append('organization_id', this.currentOrganization);
      }

      const response = await fetch(`/api/master/analytics/map-data?${params}`);
      const data = await response.json();
      
      if (data.success) {
        this.updateMapMarkers(data.locations);
      }
    } catch (error) {
      console.error('Error loading map data:', error);
      this.showToast('Error loading map data', 'error');
    }
  }

  async loadAnalyticsStats() {
    try {
      const params = new URLSearchParams({
        timeframe: this.currentTimeframe
      });
      
      if (this.currentOrganization) {
        params.append('organization_id', this.currentOrganization);
      }

      const response = await fetch(`/api/master/analytics/stats?${params}`);
      const data = await response.json();
      
      if (data.success) {
        const totalScansEl = document.getElementById('totalScans');
        if (totalScansEl) totalScansEl.textContent = data.stats.totalScans;
        
        const uniqueTagsEl = document.getElementById('uniqueTags');
        if (uniqueTagsEl) uniqueTagsEl.textContent = data.stats.uniqueTags;
        
        const activeSessionsEl = document.getElementById('activeSessions');
        if (activeSessionsEl) activeSessionsEl.textContent = data.stats.activeSessions;
        
        const uniqueCountriesEl = document.getElementById('uniqueCountries');
        if (uniqueCountriesEl) uniqueCountriesEl.textContent = data.stats.uniqueCountries;
      }
    } catch (error) {
      console.error('Error loading analytics stats:', error);
    }
  }

  updateMapMarkers(locations) {
    // Clear existing markers
    this.mapMarkers.forEach(marker => {
      this.map.removeLayer(marker);
    });
    this.mapMarkers = [];

    // Add new markers
    locations.forEach(location => {
      const { latitude, longitude, session_count, total_interactions, unique_ips, country, city } = location;
      
      // Determine marker color based on activity level
      let markerColor = 'green'; // Low activity (1-9 interactions)
      if (total_interactions >= 50) {
        markerColor = 'red'; // High activity (50+ interactions)
      } else if (total_interactions >= 10) {
        markerColor = 'orange'; // Medium activity (10-49 interactions)
      }

      // Create custom icon
      const customIcon = L.divIcon({
        className: 'custom-map-marker',
        html: `<div style="background-color: ${markerColor}; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      });

      const marker = L.marker([latitude, longitude], { icon: customIcon })
        .addTo(this.map)
        .bindPopup(`
          <div class="p-2">
            <h4 class="font-semibold">${city}, ${country}</h4>
            <p class="text-sm text-gray-600">
              Sessions: ${session_count}<br>
              Interactions: ${total_interactions}<br>
              Unique IPs: ${unique_ips}
            </p>
            <button onclick="masterPortal.loadLocationDetails('${latitude}', '${longitude}')" 
                    class="mt-2 px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600">
              View Details
            </button>
          </div>
        `);

      this.mapMarkers.push(marker);
    });
  }

  async loadLocationDetails(latitude, longitude) {
    try {
      const params = new URLSearchParams({
        timeframe: this.currentTimeframe
      });

      // Find sessions at this location
      const response = await fetch(`/api/master/analytics/map-data?${params}`);
      const data = await response.json();
      
      if (data.success) {
        const location = data.locations.find(loc => 
          parseFloat(loc.latitude) === parseFloat(latitude) && 
          parseFloat(loc.longitude) === parseFloat(longitude)
        );
        
        if (location) {
          this.showLocationDetailsModal(location);
        }
      }
    } catch (error) {
      console.error('Error loading location details:', error);
    }
  }

  showLocationDetailsModal(location) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
      <div class="bg-white rounded-xl max-w-2xl w-full p-6 max-h-96 overflow-y-auto">
        <h3 class="text-lg font-semibold mb-4">📍 ${location.city}, ${location.country}</h3>
        <div class="grid grid-cols-2 gap-4 mb-4">
          <div class="bg-blue-50 p-3 rounded-lg">
            <div class="text-2xl font-bold text-blue-600">${location.session_count}</div>
            <div class="text-sm text-gray-600">Sessions</div>
          </div>
          <div class="bg-green-50 p-3 rounded-lg">
            <div class="text-2xl font-bold text-green-600">${location.total_interactions}</div>
            <div class="text-sm text-gray-600">Total Interactions</div>
          </div>
        </div>
        <div class="flex justify-end pt-4">
          <button id="closeLocationDetails" class="btn-secondary">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    
    modal.querySelector('#closeLocationDetails').addEventListener('click', () => {
      modal.remove();
    });
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  }

  async loadIPDetails(ip) {
    try {
      const params = new URLSearchParams({
        timeframe: this.currentTimeframe
      });

      const response = await fetch(`/api/master/analytics/ip-details/${ip}?${params}`);
      const data = await response.json();
      
      if (data.success) {
        this.displayIPDetails(data.sessions, ip);
      }
    } catch (error) {
      console.error('Error loading IP details:', error);
      this.showToast('Error loading IP details', 'error');
    }
  }

  displayIPDetails(sessions, ip) {
    const content = document.getElementById('ipDetailsContent');
    
    if (sessions.length === 0) {
      content.innerHTML = '<p class="text-gray-600">No sessions found for this IP address.</p>';
      return;
    }

    content.innerHTML = `
      <h4 class="font-semibold text-gray-900 mb-2">IP: ${ip}</h4>
      <div class="space-y-3">
        ${sessions.map(session => `
          <div class="border-l-4 border-blue-500 pl-3 py-2">
            <div class="text-sm font-medium">${session.city}, ${session.country}</div>
            <div class="text-xs text-gray-600">
              ${new Date(session.first_seen_at).toLocaleDateString()} - ${new Date(session.last_seen_at).toLocaleDateString()}
            </div>
            <div class="text-xs text-gray-600">${session.total_interactions} interactions</div>
            ${session.interactions && session.interactions.length > 0 ? `
              <div class="mt-2">
                ${session.interactions.slice(0, 3).map(interaction => `
                  <div class="text-xs bg-gray-100 px-2 py-1 rounded mb-1">
                    <span class="font-medium">${interaction.tag_id}</span> • ${interaction.interaction_type}
                  </div>
                `).join('')}
                ${session.interactions.length > 3 ? `<div class="text-xs text-gray-500">+${session.interactions.length - 3} more...</div>` : ''}
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  async loadTagDetails(tagId) {
    try {
      const params = new URLSearchParams({
        timeframe: this.currentTimeframe
      });

      const response = await fetch(`/api/master/analytics/tag-details/${tagId}?${params}`);
      const data = await response.json();
      
      if (data.success) {
        this.displayTagDetails(data.interactions, tagId);
      }
    } catch (error) {
      console.error('Error loading tag details:', error);
      this.showToast('Error loading tag details', 'error');
    }
  }

  displayTagDetails(interactions, tagId) {
    const content = document.getElementById('tagDetailsContent');
    
    if (interactions.length === 0) {
      content.innerHTML = '<p class="text-gray-600">No interactions found for this tag.</p>';
      return;
    }

    content.innerHTML = `
      <h4 class="font-semibold text-gray-900 mb-2">Tag: ${tagId}</h4>
      <div class="space-y-3 max-h-64 overflow-y-auto">
        ${interactions.map(interaction => `
          <div class="border-l-4 border-green-500 pl-3 py-2">
            <div class="text-sm font-medium">${interaction.city ? `${interaction.city}, ${interaction.country}` : 'Unknown Location'}</div>
            <div class="text-xs text-gray-600">
              ${new Date(interaction.created_at).toLocaleString()}
            </div>
            <div class="text-xs text-gray-600">
              IP: <button onclick="masterPortal.loadIPDetails('${interaction.ip_address}')" class="text-blue-600 hover:underline">${interaction.ip_address}</button>
            </div>
            <div class="text-xs text-gray-600">${interaction.interaction_type} • ${interaction.page_url}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // ===== TAG ACTIVITIES FUNCTIONALITY =====
  
  async loadTagActivities() {
    console.log('Loading tag activities...');
    this.currentTagActivitiesTimeframe = '7d';
    this.currentTagActivitiesOrganization = '';
    this.currentTagActivitiesOffset = 0;
    this.currentTagActivitiesLimit = 50;
    
    // Set up event listeners for tag activities
    this.setupTagActivitiesEventListeners();
    
    // Load organizations for filter
    await this.loadTagActivitiesOrganizations();
    
    // Load stats and activities
    await this.loadTagActivitiesStats();
    await this.loadTagActivitiesData();
  }

  setupTagActivitiesEventListeners() {
    // Prevent multiple event listeners
    const timeframeEl = document.getElementById('tagActivitiesTimeframe');
    const orgEl = document.getElementById('tagActivitiesOrganization');
    const tagFilterEl = document.getElementById('tagActivitiesTagFilter');
    const refreshBtn = document.getElementById('refreshTagActivities');
    const limitEl = document.getElementById('tagActivitiesLimit');

    if (timeframeEl && !timeframeEl.hasAttribute('data-listener')) {
      timeframeEl.setAttribute('data-listener', 'true');
      timeframeEl.addEventListener('change', (e) => {
        this.currentTagActivitiesTimeframe = e.target.value;
        this.currentTagActivitiesOffset = 0;
        this.loadTagActivitiesStats();
        this.loadTagActivitiesData();
      });
    }

    if (orgEl && !orgEl.hasAttribute('data-listener')) {
      orgEl.setAttribute('data-listener', 'true');
      orgEl.addEventListener('change', (e) => {
        this.currentTagActivitiesOrganization = e.target.value;
        this.currentTagActivitiesOffset = 0;
        this.loadTagActivitiesStats();
        this.loadTagActivitiesData();
      });
    }

    if (tagFilterEl && !tagFilterEl.hasAttribute('data-listener')) {
      tagFilterEl.setAttribute('data-listener', 'true');
      let debounceTimer;
      tagFilterEl.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          this.currentTagActivitiesTagFilter = e.target.value;
          this.currentTagActivitiesOffset = 0;
          this.loadTagActivitiesData();
        }, 500);
      });
    }

    if (refreshBtn && !refreshBtn.hasAttribute('data-listener')) {
      refreshBtn.setAttribute('data-listener', 'true');
      refreshBtn.addEventListener('click', () => {
        this.loadTagActivitiesStats();
        this.loadTagActivitiesData();
      });
    }

    if (limitEl && !limitEl.hasAttribute('data-listener')) {
      limitEl.setAttribute('data-listener', 'true');
      limitEl.addEventListener('change', (e) => {
        this.currentTagActivitiesLimit = parseInt(e.target.value);
        this.currentTagActivitiesOffset = 0;
        this.loadTagActivitiesData();
      });
    }
  }

  async loadTagActivitiesOrganizations() {
    try {
      const response = await fetch('/api/master/organizations');
      const data = await response.json();
      
      if (data.success) {
        const select = document.getElementById('tagActivitiesOrganization');
        if (select) {
          select.innerHTML = '<option value="">All Organizations</option>' +
            data.organizations.map(org => `<option value="${org.id}">${org.name}</option>`).join('');
        }
      }
    } catch (error) {
      console.error('Error loading organizations for tag activities:', error);
    }
  }

  async loadTagActivitiesStats() {
    try {
      const params = new URLSearchParams({
        timeframe: this.currentTagActivitiesTimeframe
      });
      
      if (this.currentTagActivitiesOrganization) {
        params.append('organization_id', this.currentTagActivitiesOrganization);
      }

      const response = await fetch(`/api/master/analytics/tag-activities/stats?${params}`);
      const data = await response.json();
      
      if (data.success) {
        const totalScansEl = document.getElementById('totalScansCount');
        if (totalScansEl) totalScansEl.textContent = data.stats.totalScans;
        
        const uniqueTagsEl = document.getElementById('uniqueTagsCount');
        if (uniqueTagsEl) uniqueTagsEl.textContent = data.stats.uniqueTags;
        
        const activeSessionsEl = document.getElementById('activeSessionsCount');
        if (activeSessionsEl) activeSessionsEl.textContent = data.stats.activeSessions;
        
        const followupActivitiesEl = document.getElementById('followupActivitiesCount');
        if (followupActivitiesEl) followupActivitiesEl.textContent = data.stats.followupActivities;
      }
    } catch (error) {
      console.error('Error loading tag activities stats:', error);
    }
  }

  async loadTagActivitiesData() {
    // Show loading state
    const loadingEl = document.getElementById('tagActivitiesLoading');
    const containerEl = document.getElementById('tagActivitiesTableContainer');
    const emptyEl = document.getElementById('tagActivitiesEmpty');
    
    if (loadingEl) loadingEl.classList.remove('hidden');
    if (containerEl) containerEl.classList.add('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');

    try {
      const params = new URLSearchParams({
        timeframe: this.currentTagActivitiesTimeframe,
        limit: this.currentTagActivitiesLimit,
        offset: this.currentTagActivitiesOffset
      });
      
      if (this.currentTagActivitiesOrganization) {
        params.append('organization_id', this.currentTagActivitiesOrganization);
      }
      
      if (this.currentTagActivitiesTagFilter) {
        params.append('tag_id', this.currentTagActivitiesTagFilter);
      }

      const response = await fetch(`/api/master/analytics/tag-activities?${params}`);
      const data = await response.json();
      
      // Hide loading state
      if (loadingEl) loadingEl.classList.add('hidden');
      
      if (data.success) {
        if (data.activities && data.activities.length === 0) {
          if (emptyEl) emptyEl.classList.remove('hidden');
        } else if (data.activities && data.activities.length > 0) {
          if (containerEl) containerEl.classList.remove('hidden');
          this.renderTagActivitiesTable(data.activities);
          this.updateTagActivitiesPagination(data.pagination, data.total);
        }
      } else {
        console.error('Tag activities API error:', data.error);
        if (emptyEl) emptyEl.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Error loading tag activities data:', error);
      if (loadingEl) loadingEl.classList.add('hidden');
      if (emptyEl) emptyEl.classList.remove('hidden');
    }
  }

  renderTagActivitiesTable(activities) {
    const tbody = document.getElementById('tagActivitiesTable');
    if (!tbody) return;

    tbody.innerHTML = activities.map(activity => {
      const followupCount = (activity.prayer_count || 0) + (activity.praise_count || 0) + (activity.insight_count || 0);
      const followupBadge = followupCount > 0 ? 
        `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
          ${followupCount} activities
        </span>` : 
        `<span class="text-gray-400 text-xs">None</span>`;

      const location = activity.city && activity.country ? 
        `${activity.city}, ${activity.country}` : 
        (activity.country || 'Unknown');

      return `
        <tr class="hover:bg-gray-50">
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
            ${new Date(activity.created_at).toLocaleString()}
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            <code class="text-sm bg-gray-100 px-2 py-1 rounded">${activity.tag_id}</code>
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
            ${activity.organization_name || 'Unknown'}
            ${activity.subdomain ? `<div class="text-xs text-gray-500">${activity.subdomain}</div>` : ''}
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
            ${location}
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            <button onclick="masterPortal.loadIPDetails('${activity.ip_address}')" class="text-sm text-blue-600 hover:text-blue-800 hover:underline">
              ${activity.ip_address}
            </button>
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm">
            ${followupBadge}
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
            <button onclick="masterPortal.viewTagActivityDetails('${activity.session_id}')" class="text-indigo-600 hover:text-indigo-900">
              View Details
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  updateTagActivitiesPagination(pagination, total) {
    const infoEl = document.getElementById('tagActivitiesPaginationInfo');
    if (infoEl) {
      const start = pagination.offset + 1;
      const end = Math.min(pagination.offset + pagination.limit, total);
      infoEl.innerHTML = `
        Showing <span class="font-medium">${start}</span> to <span class="font-medium">${end}</span> of <span class="font-medium">${total}</span> results
      `;
    }

    // Simple pagination for now
    const paginationEl = document.getElementById('tagActivitiesPagination');
    if (paginationEl) {
      const prevDisabled = pagination.offset === 0;
      const nextDisabled = !pagination.hasMore;
      
      paginationEl.innerHTML = `
        <button ${prevDisabled ? 'disabled' : ''} onclick="masterPortal.prevTagActivitiesPage()" 
                class="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 ${prevDisabled ? 'cursor-not-allowed opacity-50' : ''}">
          <span class="sr-only">Previous</span>
          ❮
        </button>
        <button ${nextDisabled ? 'disabled' : ''} onclick="masterPortal.nextTagActivitiesPage()" 
                class="relative -ml-px inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 ${nextDisabled ? 'cursor-not-allowed opacity-50' : ''}">
          <span class="sr-only">Next</span>
          ❯
        </button>
      `;
    }
  }

  prevTagActivitiesPage() {
    if (this.currentTagActivitiesOffset > 0) {
      this.currentTagActivitiesOffset = Math.max(0, this.currentTagActivitiesOffset - this.currentTagActivitiesLimit);
      this.loadTagActivitiesData();
    }
  }

  nextTagActivitiesPage() {
    this.currentTagActivitiesOffset += this.currentTagActivitiesLimit;
    this.loadTagActivitiesData();
  }

  async viewTagActivityDetails(sessionId) {
    // Show a modal with detailed session information
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
      <div class="bg-white rounded-xl max-w-4xl w-full p-6 max-h-[80vh] overflow-y-auto">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-lg font-semibold">Session Activity Details</h3>
          <button id="closeSessionDetails" class="text-gray-400 hover:text-gray-600">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        <div id="sessionDetailsContent">
          <div class="text-center py-8">
            <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p class="mt-4 text-gray-600">Loading session details...</p>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) document.body.removeChild(modal);
    });
    
    document.getElementById('closeSessionDetails').addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    // Load comprehensive session details from API
    try {
      const response = await fetch(`/api/master/analytics/session-details/${encodeURIComponent(sessionId)}`);
      const data = await response.json();
      
      if (data.success) {
        this.renderSessionDetails(data.sessionDetails);
      } else {
        document.getElementById('sessionDetailsContent').innerHTML = `
          <div class="text-center py-8">
            <div class="text-red-600 mb-2">❌ Error</div>
            <p class="text-gray-600">Failed to load session details</p>
          </div>
        `;
      }
    } catch (error) {
      console.error('Error loading session details:', error);
      document.getElementById('sessionDetailsContent').innerHTML = `
        <div class="text-center py-8">
          <div class="text-red-600 mb-2">❌ Error</div>
          <p class="text-gray-600">Failed to load session details</p>
        </div>
      `;
    }
  }

  renderSessionDetails(sessionDetails) {
    const { sessionId, sessionInfo, location, deviceInfo, userJourney, sectionTimeSpent, activities } = sessionDetails;
    
    // Helper function to format time
    const formatTime = (timeMs) => {
      if (timeMs < 1000) return `${timeMs}ms`;
      if (timeMs < 60000) return `${Math.floor(timeMs / 1000)}s`;
      return `${Math.floor(timeMs / 60000)}m ${Math.floor((timeMs % 60000) / 1000)}s`;
    };
    
    // Helper function to format date
    const formatDate = (dateString) => {
      return new Date(dateString).toLocaleString();
    };
    
    document.getElementById('sessionDetailsContent').innerHTML = `
      <div class="space-y-6">
        <!-- Session Overview -->
        <div class="bg-gray-50 p-4 rounded-lg">
          <h4 class="font-medium mb-3 flex items-center">
            <span class="text-blue-600 mr-2">🔍</span>
            Session Overview
          </h4>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="text-sm font-medium text-gray-700">Session ID:</label>
              <code class="text-sm bg-white px-2 py-1 rounded border block mt-1 break-all">${sessionId}</code>
            </div>
            ${sessionInfo ? `
              <div>
                <label class="text-sm font-medium text-gray-700">IP Address:</label>
                <code class="text-sm bg-white px-2 py-1 rounded border block mt-1">${sessionInfo.ipAddress || 'Unknown'}</code>
              </div>
              <div>
                <label class="text-sm font-medium text-gray-700">Session Started:</label>
                <div class="text-sm mt-1">${formatDate(sessionInfo.sessionStart)}</div>
              </div>
              <div>
                <label class="text-sm font-medium text-gray-700">Last Activity:</label>
                <div class="text-sm mt-1">${formatDate(sessionInfo.lastActivity)}</div>
              </div>
              <div>
                <label class="text-sm font-medium text-gray-700">Total Page Views:</label>
                <div class="text-sm mt-1">${sessionInfo.totalPageViews}</div>
              </div>
              <div>
                <label class="text-sm font-medium text-gray-700">Total Time Spent:</label>
                <div class="text-sm mt-1">${formatTime(sessionInfo.totalTimeSpent)}</div>
              </div>
            ` : `
              <div class="col-span-2 text-sm text-gray-500">No session information available</div>
            `}
          </div>
        </div>

        <!-- Tag Scans -->
        ${sessionInfo && sessionInfo.tagScans && sessionInfo.tagScans.length > 0 ? `
          <div class="bg-green-50 p-4 rounded-lg">
            <h4 class="font-medium mb-3 flex items-center">
              <span class="text-green-600 mr-2">📱</span>
              NFC Tag Scans (${sessionInfo.tagScans.length})
            </h4>
            <div class="space-y-2">
              ${sessionInfo.tagScans.map(scan => `
                <div class="bg-white p-3 rounded border">
                  <div class="flex justify-between items-center">
                    <code class="text-sm font-mono">${scan.tagId}</code>
                    <span class="text-xs text-gray-500">${formatDate(scan.scanTime)}</span>
                  </div>
                  <div class="text-xs text-gray-600 mt-1">Org: ${scan.organizationId}</div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Device & Location Information -->
        <div class="bg-purple-50 p-4 rounded-lg">
          <h4 class="font-medium mb-3 flex items-center">
            <span class="text-purple-600 mr-2">💻</span>
            Device & Location Information
          </h4>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="text-sm font-medium text-gray-700">Browser:</label>
              <div class="text-sm mt-1">${deviceInfo.browser}</div>
            </div>
            <div>
              <label class="text-sm font-medium text-gray-700">Operating System:</label>
              <div class="text-sm mt-1">${deviceInfo.os}</div>
            </div>
            <div>
              <label class="text-sm font-medium text-gray-700">Device Type:</label>
              <div class="text-sm mt-1">${deviceInfo.device}</div>
            </div>
            ${location ? `
              <div>
                <label class="text-sm font-medium text-gray-700">Location:</label>
                <div class="text-sm mt-1">${location.city || 'Unknown'}, ${location.region || ''} ${location.country || ''}</div>
              </div>
            ` : `
              <div>
                <label class="text-sm font-medium text-gray-700">Location:</label>
                <div class="text-sm mt-1 text-gray-500">Not available</div>
              </div>
            `}
          </div>
        </div>

        <!-- Time Spent by Section -->
        ${sectionTimeSpent && sectionTimeSpent.length > 0 ? `
          <div class="bg-yellow-50 p-4 rounded-lg">
            <h4 class="font-medium mb-3 flex items-center">
              <span class="text-yellow-600 mr-2">⏱️</span>
              Time Spent by Section
            </h4>
            <div class="space-y-2">
              ${sectionTimeSpent.map(section => `
                <div class="flex justify-between items-center bg-white p-3 rounded border">
                  <div class="text-sm font-medium">${section.page || 'Unknown page'}</div>
                  <div class="text-sm text-gray-600">${section.timeFormatted}</div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- User Journey -->
        ${userJourney && userJourney.length > 0 ? `
          <div class="bg-blue-50 p-4 rounded-lg">
            <h4 class="font-medium mb-3 flex items-center">
              <span class="text-blue-600 mr-2">🛤️</span>
              Complete User Journey (${userJourney.length} actions)
            </h4>
            <div class="space-y-2 max-h-64 overflow-y-auto">
              ${userJourney.map((step, index) => `
                <div class="bg-white p-3 rounded border flex items-center justify-between">
                  <div class="flex items-center">
                    <span class="w-6 h-6 bg-blue-100 text-blue-800 rounded-full text-xs flex items-center justify-center mr-3">${index + 1}</span>
                    <div>
                      <div class="text-sm font-medium">${step.action.toUpperCase()}: ${step.page || 'Unknown'}</div>
                      ${step.metadata ? `<div class="text-xs text-gray-600 mt-1">${JSON.stringify(step.metadata)}</div>` : ''}
                    </div>
                  </div>
                  <div class="text-xs text-gray-500">${formatDate(step.timestamp)}</div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Prayer Requests -->
        ${activities.prayerRequests && activities.prayerRequests.length > 0 ? `
          <div class="bg-indigo-50 p-4 rounded-lg">
            <h4 class="font-medium mb-3 flex items-center">
              <span class="text-indigo-600 mr-2">🙏</span>
              Prayer Requests (${activities.prayerRequests.length})
            </h4>
            <div class="space-y-3">
              ${activities.prayerRequests.map(pr => `
                <div class="bg-white p-4 rounded border">
                  <div class="flex justify-between items-start mb-2">
                    <span class="text-xs px-2 py-1 rounded ${pr.isAnonymous ? 'bg-gray-100 text-gray-600' : 'bg-blue-100 text-blue-600'}">${pr.isAnonymous ? 'Anonymous' : 'Named'}</span>
                    <span class="text-xs text-gray-500">${formatDate(pr.createdAt)}</span>
                  </div>
                  <div class="text-sm text-gray-800">${pr.content}</div>
                  <div class="text-xs text-gray-500 mt-2">Org: ${pr.organizationId}</div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Praise Reports -->
        ${activities.praiseReports && activities.praiseReports.length > 0 ? `
          <div class="bg-green-50 p-4 rounded-lg">
            <h4 class="font-medium mb-3 flex items-center">
              <span class="text-green-600 mr-2">🎉</span>
              Praise Reports (${activities.praiseReports.length})
            </h4>
            <div class="space-y-3">
              ${activities.praiseReports.map(pr => `
                <div class="bg-white p-4 rounded border">
                  <div class="flex justify-between items-start mb-2">
                    <span class="text-xs px-2 py-1 rounded ${pr.isAnonymous ? 'bg-gray-100 text-gray-600' : 'bg-blue-100 text-blue-600'}">${pr.isAnonymous ? 'Anonymous' : 'Named'}</span>
                    <span class="text-xs text-gray-500">${formatDate(pr.createdAt)}</span>
                  </div>
                  <div class="text-sm text-gray-800">${pr.content}</div>
                  <div class="text-xs text-gray-500 mt-2">Org: ${pr.organizationId}</div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Verse Insights -->
        ${activities.insights && activities.insights.length > 0 ? `
          <div class="bg-orange-50 p-4 rounded-lg">
            <h4 class="font-medium mb-3 flex items-center">
              <span class="text-orange-600 mr-2">📖</span>
              Verse Insights (${activities.insights.length})
            </h4>
            <div class="space-y-3">
              ${activities.insights.map(insight => `
                <div class="bg-white p-4 rounded border">
                  <div class="flex justify-between items-start mb-2">
                    <span class="text-xs px-2 py-1 rounded bg-orange-100 text-orange-600">${insight.verseReference}</span>
                    <span class="text-xs text-gray-500">${formatDate(insight.createdAt)}</span>
                  </div>
                  <div class="text-sm text-gray-800 mb-2">${insight.insightText}</div>
                  <div class="flex justify-between items-center text-xs">
                    <span class="px-2 py-1 rounded ${insight.isAnonymous ? 'bg-gray-100 text-gray-600' : 'bg-blue-100 text-blue-600'}">${insight.isAnonymous ? 'Anonymous' : 'Named'}</span>
                    <span class="text-gray-500">Org: ${insight.organizationId}</span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- No Activity Message -->
        ${(!activities.prayerRequests || activities.prayerRequests.length === 0) && 
          (!activities.praiseReports || activities.praiseReports.length === 0) && 
          (!activities.insights || activities.insights.length === 0) ? `
          <div class="bg-gray-50 p-4 rounded-lg text-center">
            <div class="text-gray-600 text-sm">
              🔍 No prayer requests, praise reports, or insights were submitted during this session.
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }
}

// Initialize master portal
const masterPortal = new MasterPortal();