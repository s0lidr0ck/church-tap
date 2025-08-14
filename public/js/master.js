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
    document.getElementById('supportMasterNav').addEventListener('click', (e) => {
      e.preventDefault();
      this.showMasterTab('support');
    });
    document.getElementById('systemMasterNav').addEventListener('click', (e) => {
      e.preventDefault();
      this.showMasterTab('system');
    });

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
    activeBtn.classList.add('active');

    // Update content
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.add('hidden');
    });
    
    document.getElementById(`${tabName}MasterContent`).classList.remove('hidden');

    // Update page title with icons
    const titleMap = {
      'dashboard': '🚀 Master Dashboard',
      'organizations': '🏢 Organizations',
      'billing': '💳 Billing & Plans', 
      'analytics': '📈 Global Analytics',
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
    } else if (tabName === 'analytics') {
      this.loadGlobalAnalytics();
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
}

// Initialize master portal
const masterPortal = new MasterPortal();