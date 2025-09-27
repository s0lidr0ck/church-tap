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
    this.userToken = this.getUserToken();
    this.favorites = JSON.parse(localStorage.getItem('favorites') || '[]');
    this.recentlyViewed = JSON.parse(localStorage.getItem('recentlyViewed') || '[]');
    
    // Get organization and tag parameters from URL or injected context
    const urlParams = new URLSearchParams(window.location.search);

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
    
    // Handle tag_id persistence with cookies
    this.setupTagIdTracking();
    
    this.currentCommunity = null;
    this.userInteractions = JSON.parse(localStorage.getItem('userInteractions') || '{}');
    this.currentUser = null;
    this.authToken = null;
    
    // PWA install prompt
    this.deferredPrompt = null;
    this.setupPWAInstall();
    
    this.init();
  }

  init() {
    try {
      this.setupEventListeners();
      this.applyTheme();
      this.applyTextSize();
      this.checkAuthStatus();
      this.updateTranslationButtons();
      this.hideSplashScreen();
      
      // Load content with proper error handling
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
      
      this.setupSwipeGestures();
      this.checkNotificationPermission();
      this.detectNFCSupport();
      this.loadOrganizationLinks();
      this.updateCalendarIndicatorForToday();
      this.initCTA();
      this.updateMenuIndicators();
      this.updateTagSessionUI();
    } catch (error) {
      console.error('Init error:', error);
      this.showCriticalError('Application failed to initialize. Please refresh the page.');
      this.hideSplashScreen();
    }
  }

  // Build URL with org subdomain hint and extra query params
  withOrg(path, extraParams = {}) {
    // For API calls, use relative URLs so they go to the same server serving the page
    if (path.startsWith('/api/')) {
      // Use URLSearchParams for relative URLs to avoid origin issues
      const params = new URLSearchParams();
      if (this.orgParam) params.set('org', this.orgParam);
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
    // Theme toggle (now in menu)
    document.getElementById('themeMenuBtn').addEventListener('click', () => {
      this.toggleTheme();
      this.updateMenuIndicators();
    });

    // Text size toggle (now in menu)
    document.getElementById('textSizeMenuBtn').addEventListener('click', () => {
      this.cycleTextSize();
      this.updateMenuIndicators();
    });

    // Account/Login button (now in menu)
    document.getElementById('loginMenuBtnNew').addEventListener('click', () => {
      document.getElementById('loginMenuBtn').click(); // Reuse existing login functionality
    });

    // Navigation
    document.getElementById('prevDay').addEventListener('click', () => {
      this.navigateDay(-1);
    });

    document.getElementById('nextDay').addEventListener('click', () => {
      this.navigateDay(1);
    });

    document.getElementById('todayBtn').addEventListener('click', () => {
      this.goToToday();
    });

    document.getElementById('backToToday').addEventListener('click', () => {
      this.goToToday();
    });

    // Menu toggle
    document.getElementById('menuToggle').addEventListener('click', () => {
      this.toggleQuickMenu();
    });

    // Organization Links toggle
    const linksBtn = document.getElementById('linksBtn');
    if (linksBtn) {
      linksBtn.addEventListener('click', () => {
        this.toggleLinksMenu();
      });
    }

    // Calendar controls
    const calendarBtn = document.getElementById('calendarBtn');
    if (calendarBtn) {
      calendarBtn.addEventListener('click', () => this.openCalendarModal());
    }
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
    document.getElementById('clearTagSessionBtn').addEventListener('click', () => {
      this.clearTagSession();
    });

    // Change Group button
    document.getElementById('changeGroupBtn').addEventListener('click', () => {
      this.changeGroup();
    });

    // Request a Group button
    document.getElementById('requestGroupBtn').addEventListener('click', () => {
      this.requestGroup();
    });

    // Main action buttons
    document.getElementById('randomVerseBtn').addEventListener('click', () => {
      this.showRandomVerse();
    });

    document.getElementById('shareBtn').addEventListener('click', () => {
      this.shareVerse();
    });

    document.getElementById('downloadBtn').addEventListener('click', () => {
      this.downloadVerseImage();
    });

    document.getElementById('searchBtn').addEventListener('click', () => {
      this.showVerseSearchModal();
      this.toggleQuickMenu();
    });

    document.getElementById('feedbackBtn').addEventListener('click', () => {
      this.openFeedback();
    });

    // Engagement actions
    document.getElementById('heartBtn').addEventListener('click', () => {
      this.toggleHeart();
    });

    document.getElementById('favoriteBtn').addEventListener('click', () => {
      this.toggleFavorite();
    });

    document.getElementById('qrBtn').addEventListener('click', () => {
      this.showQRCode();
    });

    document.getElementById('refreshBtn').addEventListener('click', () => {
      this.refreshVerse();
    });

    document.getElementById('historyBtn').addEventListener('click', () => {
      this.showHistory();
    });

    // Community event listeners
    document.getElementById('submitPrayerBtn').addEventListener('click', () => {
      this.showPrayerRequestModal();
    });

    document.getElementById('submitPraiseBtn').addEventListener('click', () => {
      this.showPraiseReportModal();
    });

    document.getElementById('submitInsightBtn').addEventListener('click', () => {
      this.showVerseInsightModal();
    });

    // Authentication event listeners (now in menu)
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
      loginBtn.addEventListener('click', () => {
        this.showLoginModal();
      });
    }

    document.getElementById('loginMenuBtn').addEventListener('click', () => {
      this.showLoginModal();
      this.toggleQuickMenu();
    });

    document.getElementById('registerMenuBtn').addEventListener('click', () => {
      this.showRegisterModal();
      this.toggleQuickMenu();
    });

    document.getElementById('logoutBtn').addEventListener('click', () => {
      this.handleLogout();
      this.toggleQuickMenu();
    });

    document.getElementById('profileBtn').addEventListener('click', () => {
      this.showProfileModal();
      this.toggleQuickMenu();
    });

    // Close menus when clicking outside
    document.addEventListener('click', (e) => {
      // Quick menu
      const menu = document.getElementById('quickMenu');
      const toggle = document.getElementById('menuToggle');
      if (!menu.contains(e.target) && !toggle.contains(e.target)) {
        menu.classList.add('hidden');
      }
      
      // Links menu
      const linksMenu = document.getElementById('quickLinksMenu');
      const linksToggle = document.getElementById('linksBtn');
      if (linksMenu && linksToggle && !linksMenu.contains(e.target) && !linksToggle.contains(e.target)) {
        this.hideLinksMenu();
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.target.type === 'text' || e.target.type === 'textarea') return;
      
      switch(e.key) {
        case 'ArrowLeft':
          this.navigateDay(-1);
          break;
        case 'ArrowRight':
          this.navigateDay(1);
          break;
        case ' ':
          e.preventDefault();
          this.showRandomVerse();
          break;
        case 'h':
          this.toggleHeart();
          break;
        case 'f':
          this.toggleFavorite();
          break;
        case 't':
          this.goToToday();
          break;
        case 'd':
          this.toggleTheme();
          break;
      }
    });

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
    
    this.hideLoading();
    
    if (verse.content_type === 'text') {
      document.getElementById('verseText').textContent = verse.verse_text;
      document.getElementById('verseReference').textContent = verse.bible_reference || '';
      document.getElementById('verseReferenceDesktop').textContent = verse.bible_reference || '';
      
      const contextEl = document.getElementById('verseContext');
      if (verse.context) {
        contextEl.textContent = verse.context;
        contextEl.classList.remove('hidden');
      } else {
        contextEl.classList.add('hidden');
      }
      
      textVerse.classList.remove('hidden');
      imageVerse.classList.add('hidden');
    } else {
      const img = document.getElementById('verseImage');
      img.src = verse.image_path;
      img.alt = verse.bible_reference || 'Church Tap image';
      
      document.getElementById('imageReference').textContent = verse.bible_reference || '';
      document.getElementById('imageReferenceDesktop').textContent = verse.bible_reference || '';
      
      const contextEl = document.getElementById('imageContext');
      if (verse.context) {
        contextEl.textContent = verse.context;
        contextEl.classList.remove('hidden');
      } else {
        contextEl.classList.add('hidden');
      }
      
      imageVerse.classList.remove('hidden');
      textVerse.classList.add('hidden');
    }
    
    // Display personalization badge if applicable
    const personalizationBadge = document.getElementById('personalizationBadge');
    if (verse.personalized) {
      const personalizationText = document.getElementById('personalizationText');
      personalizationText.textContent = verse.reason || 'Personalized for you';
      personalizationBadge.classList.remove('hidden');
    } else {
      personalizationBadge.classList.add('hidden');
    }
    
    // Display tags
    this.displayTags(verse.tags);
    
    // Update translation button labels
    this.updateTranslationButtons();
    
    verseContent.classList.remove('hidden');
    engagementActions.classList.remove('hidden');
    
    // Update heart count
    document.getElementById('heartCount').textContent = verse.hearts || 0;
  }

  displayTags(tagsString) {
    const tagsContainer = document.getElementById('verseTags');
    
    if (!tagsString) {
      tagsContainer.classList.add('hidden');
      return;
    }
    
    const tags = tagsString.split(',').map(tag => tag.trim()).filter(tag => tag);
    
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
    document.getElementById('loadingVerse').classList.add('hidden');
  }

  showNoVerse() {
    this.hideLoading();
    document.getElementById('verseContent').classList.add('hidden');
    document.getElementById('noVerse').classList.remove('hidden');
    document.getElementById('engagementActions').classList.add('hidden');
  }

  showOfflineMessage() {
    this.hideLoading();
    document.getElementById('verseContent').classList.add('hidden');
    document.getElementById('noVerse').classList.remove('hidden');
    document.querySelector('#noVerse h3').textContent = 'No internet connection';
    document.querySelector('#noVerse p').textContent = 'Please check your connection and try again.';
  }

  showErrorState(section, message) {
    if (section === 'verse') {
      this.hideLoading();
      document.getElementById('verseContent').classList.add('hidden');
      document.getElementById('noVerse').classList.remove('hidden');
      document.querySelector('#noVerse h3').textContent = 'Something went wrong';
      document.querySelector('#noVerse p').textContent = message;
      document.getElementById('backToToday').textContent = 'Try Again';
      document.getElementById('backToToday').onclick = () => this.retry('verse');
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
    this.currentDate = today;
    this.loadVerse(today);
    this.loadCommunity(today);
  }

  async showRandomVerse() {
    try {
      const response = await fetch(this.buildApiUrl('/api/verse/random'));
      const data = await response.json();
      
      if (data.success && data.verse) {
        const verse = data.verse;
        
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
            
            <div class="verse-text text-lg leading-relaxed text-gray-800 dark:text-gray-200 mb-6">
              ${verse.verse_text}
            </div>
            
            <div class="verse-reference text-base font-semibold text-primary-600 dark:text-primary-400 mb-4">
              ${verse.bible_reference}
            </div>
            
            ${verse.context ? `<div class="text-sm text-gray-600 dark:text-gray-400 italic">${verse.context}</div>` : ''}
            
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
      text: `${verse.verse_text}\n\n— ${verse.bible_reference}`,
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

  toggleQuickMenu() {
    const menu = document.getElementById('quickMenu');
    menu.classList.toggle('hidden');
  }

  toggleLinksMenu() {
    const menu = document.getElementById('quickLinksMenu');
    const linksBtn = document.getElementById('linksBtn');
    
    menu.classList.toggle('hidden');
    
    // Update aria-expanded
    if (linksBtn) {
      linksBtn.setAttribute('aria-expanded', !menu.classList.contains('hidden'));
    }
  }

  hideLinksMenu() {
    const menu = document.getElementById('quickLinksMenu');
    const linksBtn = document.getElementById('linksBtn');
    
    menu.classList.add('hidden');
    
    if (linksBtn) {
      linksBtn.setAttribute('aria-expanded', 'false');
    }
  }

  hideQuickMenu() {
    const menu = document.getElementById('quickMenu');
    menu.classList.add('hidden');
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

  toggleFavorite() {
    if (!this.currentVerse) return;
    
    const verseId = this.currentVerse.id;
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
        ? `"${this.currentVerse.verse_text}" - ${this.currentVerse.bible_reference || 'Bible'}`
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
        searchResultsList.innerHTML = data.verses.map(verse => `
          <div class="p-3 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors" onclick="app.goToDate('${verse.date}')">
            <div class="font-medium text-sm text-primary-600 dark:text-primary-400 mb-1">${verse.bible_reference}</div>
            <div class="text-sm text-gray-600 dark:text-gray-400 mb-1">${verse.date}</div>
            ${verse.verse_text ? `<div class="text-sm text-gray-800 dark:text-gray-200 line-clamp-2">${verse.verse_text.substring(0, 100)}${verse.verse_text.length > 100 ? '...' : ''}</div>` : ''}
            ${verse.tags ? `<div class="text-xs text-gray-500 dark:text-gray-400 mt-1">${verse.tags}</div>` : ''}
          </div>
        `).join('');
        
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

  showModal(title, content) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-lg max-w-md w-full p-6">
        <h3 class="text-lg font-semibold mb-4 text-gray-900 dark:text-white">${title}</h3>
        ${content}
      </div>
    `;
    
    modal.addEventListener('click', (e) => {
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
      document.getElementById('splash').style.display = 'none';
      document.getElementById('app').classList.remove('hidden');
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
      
      if (this.orgParam) {
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

  getUserPreferredTranslation() {
    // Default to NASB if no user preference or not logged in
    return this.currentUser?.preferredTranslation || 'NASB';
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
        this.showChapterModal(data, reference, translation);
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

  showChapterModal(chapterData, reference, translation) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4';
    modal.style.zIndex = '9999';
    
    // Parse reference to get book and chapter for title
    const parsedRef = this.parseBibleReference(reference);
    const chapterTitle = parsedRef ? `Chapter ${parsedRef.chapter}` : 'Bible Chapter';
    
    // Handle bolls.life chapter response - it returns an array of verse objects
    let versesHtml = '';
    if (Array.isArray(chapterData)) {
      versesHtml = chapterData.map(verse => `
        <div class="mb-3">
          <span class="text-sm font-medium text-primary-600 dark:text-primary-400 mr-2">${verse.verse}</span>
          <span class="verse-text text-gray-800 dark:text-gray-200 size-${this.textSize}">${verse.text}</span>
        </div>
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
        <div class="p-4 overflow-y-auto flex-1 min-h-0">
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
    
    this.recentlyViewed.unshift({
      id: verse.id,
      date: verse.date,
      bible_reference: verse.bible_reference,
      preview: verse.content_type === 'text' 
        ? verse.verse_text.substring(0, 50) + '...'
        : verse.bible_reference,
      content_type: verse.content_type,
      verse_text: verse.verse_text,
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
                  ? (verse.verse_text ? verse.verse_text.substring(0, 80) + '...' : 'Text verse')
                  : verse.bible_reference || 'Image verse'
                }
              </div>
              <div class="flex justify-between items-center">
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  ${new Date(verse.date).toLocaleDateString()}
                </div>
                ${verse.tags ? `<div class="text-xs text-primary-500 dark:text-primary-400">${verse.tags.split(',')[0]}</div>` : ''}
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
              ? (verse.verse_text ? verse.verse_text.substring(0, 120) + '...' : 'Text verse')
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
              ${verse.tags.split(',').slice(0, 3).map(tag => 
                `<span class="px-2 py-0.5 bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 text-xs rounded-full">${tag.trim()}</span>`
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
  }

  getTagSession() {
    return JSON.parse(localStorage.getItem('nfc_tag_session') || 'null');
  }

  updateTagSessionUI() {
    const tagSessionInfo = document.getElementById('tagSessionInfo');
    const tagSessionId = document.getElementById('tagSessionId');
    
    if (this.currentTagId) {
      const session = this.getTagSession();
      tagSessionInfo.classList.remove('hidden');
      
      if (session && session.pageViews) {
        tagSessionId.textContent = `${this.currentTagId} • ${session.pageViews} views`;
      } else {
        tagSessionId.textContent = this.currentTagId;
      }
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
      
      // Add to menu
      const settingsSection = document.querySelector('#quickMenu .border-t');
      if (settingsSection) {
        settingsSection.parentNode.insertBefore(installBtn, settingsSection);
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
      const response = await fetch(this.buildApiUrl(`/api/community/${date}`));
      const data = await response.json();
      
      if (data.success) {
        this.currentCommunity = data.community;
        this.updateCommunityHeader(date);
        this.displayCommunity(data.community);
      } else {
        this.showEmptyCommunity();
      }
    } catch (error) {
      console.error('Error loading community:', error);
      this.showEmptyCommunity();
    }
  }

  updateCommunityHeader(date) {
    const today = new Date().toISOString().split('T')[0];
    const header = document.getElementById('communityDateHeader');
    
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
    const { prayer_requests, praise_reports, verse_insights } = community;
    
    document.getElementById('loadingCommunity').classList.add('hidden');
    document.getElementById('communitySection').classList.remove('hidden');
    
    // Display prayer requests
    if (prayer_requests && prayer_requests.length > 0) {
      this.displayPrayerRequests(prayer_requests);
      document.getElementById('prayerRequestsSection').classList.remove('hidden');
    } else {
      document.getElementById('prayerRequestsSection').classList.add('hidden');
    }
    
    // Display verse insights
    if (verse_insights && verse_insights.length > 0) {
      this.displayVerseInsights(verse_insights);
      document.getElementById('verseInsightsSection').classList.remove('hidden');
    } else {
      document.getElementById('verseInsightsSection').classList.add('hidden');
    }
    
    // Display praise reports
    if (praise_reports && praise_reports.length > 0) {
      this.displayPraiseReports(praise_reports);
      document.getElementById('praiseReportsSection').classList.remove('hidden');
    } else {
      document.getElementById('praiseReportsSection').classList.add('hidden');
    }
    
    // Show empty state if no content
    if ((!prayer_requests || prayer_requests.length === 0) && 
        (!praise_reports || praise_reports.length === 0) && 
        (!verse_insights || verse_insights.length === 0)) {
      document.getElementById('emptyCommunity').classList.remove('hidden');
    } else {
      document.getElementById('emptyCommunity').classList.add('hidden');
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
    document.getElementById('loadingCommunity').classList.add('hidden');
    document.getElementById('communitySection').classList.remove('hidden');
    document.getElementById('prayerRequestsSection').classList.add('hidden');
    document.getElementById('praiseReportsSection').classList.add('hidden');
    document.getElementById('emptyCommunity').classList.remove('hidden');
  }

  showPrayerRequestModal() {
    this.showModal('Submit Prayer Request', `
      <form id="prayerRequestForm" class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
            Share your prayer request anonymously:
          </label>
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
      this.submitPrayerRequest(textarea.value);
    });
  }

  showVerseInsightModal() {
    const verseReference = this.currentVerse?.bible_reference || 'Today\'s Verse';
    
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
        <div class="text-xs text-gray-500">
          Insights are shared anonymously and will appear after moderation.
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
        this.submitVerseInsight(content, verseReference);
      }
    });
  }

  showPraiseReportModal() {
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
      this.submitPraiseReport(textarea.value);
    });
  }

  async submitPrayerRequest(content) {
    try {
      const response = await fetch(this.buildApiUrl('/api/prayer-request'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: content,
          user_token: this.userToken,
          date: this.currentDate
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

  async submitVerseInsight(content, verseReference) {
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
          date: this.currentDate || new Date().toISOString().split('T')[0]
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

  async submitPraiseReport(content) {
    try {
      const response = await fetch(this.buildApiUrl('/api/praise-report'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: content,
          user_token: this.userToken,
          date: this.currentDate
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
  async checkAuthStatus() {
    try {
      const response = await fetch(this.buildApiUrl('/api/auth/me'), {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          this.currentUser = data.user;
          this.updateUIForLoggedInUser();
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
        this.currentUser = data.user;
        this.authToken = data.token;
        this.closeModal();
        this.updateUIForLoggedInUser();
        
        if (data.requiresOnboarding) {
          this.showOnboardingModal();
        } else {
          this.showToast('Welcome back! 🙏');
        }
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
        this.currentUser = data.user;
        this.authToken = data.token;
        this.closeModal();
        this.updateUIForLoggedInUser();
        this.showToast('Account created! Welcome! ✨');
        this.showOnboardingModal();
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

  showOnboardingModal() {
    this.showModal('Welcome! Let\'s Personalize Your Experience', `
      <div class="text-sm text-gray-600 dark:text-gray-400 mb-6">
        Help us personalize your daily verses by sharing a bit about yourself. This is optional but will help us provide more relevant content.
      </div>
      <form id="onboardingForm" class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Life Stage</label>
          <select id="lifeStage" class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
            <option value="">Select your life stage</option>
            <option value="teen">Teen (13-19)</option>
            <option value="young_adult">Young Adult (20-29)</option>
            <option value="adult">Adult (30-49)</option>
            <option value="middle_aged">Middle-aged (50-64)</option>
            <option value="senior">Senior (65+)</option>
          </select>
        </div>

        <div>
          <label class="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Interests (Select all that apply)</label>
          <div id="interestsGrid" class="grid grid-cols-2 gap-2">
            <label class="flex items-center space-x-2">
              <input type="checkbox" value="faith_growth" class="rounded">
              <span class="text-sm">Faith Growth</span>
            </label>
            <label class="flex items-center space-x-2">
              <input type="checkbox" value="family" class="rounded">
              <span class="text-sm">Family</span>
            </label>
            <label class="flex items-center space-x-2">
              <input type="checkbox" value="relationships" class="rounded">
              <span class="text-sm">Relationships</span>
            </label>
            <label class="flex items-center space-x-2">
              <input type="checkbox" value="work_career" class="rounded">
              <span class="text-sm">Work/Career</span>
            </label>
            <label class="flex items-center space-x-2">
              <input type="checkbox" value="health" class="rounded">
              <span class="text-sm">Health</span>
            </label>
            <label class="flex items-center space-x-2">
              <input type="checkbox" value="finances" class="rounded">
              <span class="text-sm">Finances</span>
            </label>
            <label class="flex items-center space-x-2">
              <input type="checkbox" value="service" class="rounded">
              <span class="text-sm">Service</span>
            </label>
            <label class="flex items-center space-x-2">
              <input type="checkbox" value="leadership" class="rounded">
              <span class="text-sm">Leadership</span>
            </label>
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Current Struggles (Optional - helps us provide supportive verses)</label>
          <div id="strugglesGrid" class="grid grid-cols-2 gap-2">
            <label class="flex items-center space-x-2">
              <input type="checkbox" value="anxiety" class="rounded">
              <span class="text-sm">Anxiety</span>
            </label>
            <label class="flex items-center space-x-2">
              <input type="checkbox" value="depression" class="rounded">
              <span class="text-sm">Depression</span>
            </label>
            <label class="flex items-center space-x-2">
              <input type="checkbox" value="loneliness" class="rounded">
              <span class="text-sm">Loneliness</span>
            </label>
            <label class="flex items-center space-x-2">
              <input type="checkbox" value="grief" class="rounded">
              <span class="text-sm">Grief</span>
            </label>
            <label class="flex items-center space-x-2">
              <input type="checkbox" value="anger" class="rounded">
              <span class="text-sm">Anger</span>
            </label>
            <label class="flex items-center space-x-2">
              <input type="checkbox" value="doubt" class="rounded">
              <span class="text-sm">Doubt</span>
            </label>
            <label class="flex items-center space-x-2">
              <input type="checkbox" value="addiction" class="rounded">
              <span class="text-sm">Addiction</span>
            </label>
            <label class="flex items-center space-x-2">
              <input type="checkbox" value="forgiveness" class="rounded">
              <span class="text-sm">Forgiveness</span>
            </label>
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">How often do you pray?</label>
          <select id="prayerFrequency" class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
            <option value="">Select frequency</option>
            <option value="multiple_daily">Multiple times daily</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="occasionally">Occasionally</option>
            <option value="rarely">Rarely</option>
          </select>
        </div>

        <div>
          <label class="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Preferred Bible Translation</label>
          <select id="preferredTranslation" class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
            <option value="NASB" selected>NASB - New American Standard Bible (Recommended)</option>
            <option value="ESV">ESV - English Standard Version</option>
            <option value="NIV">NIV - New International Version</option>
            <option value="NLT">NLT - New Living Translation</option>
            <option value="KJV">KJV - King James Version</option>
            <option value="MSG">MSG - The Message</option>
            <option value="CSB">CSB - Christian Standard Bible</option>
          </select>
        </div>

        <div id="onboardingError" class="hidden text-red-600 text-sm"></div>
        <div class="flex space-x-3">
          <button type="submit" class="btn-primary flex-1">✨ Complete Setup</button>
          <button type="button" onclick="window.churchTapApp.skipOnboarding()" class="btn-secondary">Skip for Now</button>
        </div>
      </form>
    `);

    document.getElementById('onboardingForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleOnboarding();
    });
  }

  async handleOnboarding() {
    const lifeStage = document.getElementById('lifeStage').value;
    const prayerFrequency = document.getElementById('prayerFrequency').value;
    const preferredTranslation = document.getElementById('preferredTranslation').value;
    const errorEl = document.getElementById('onboardingError');

    // Collect selected interests
    const interests = Array.from(document.querySelectorAll('#interestsGrid input[type="checkbox"]:checked'))
      .map(cb => cb.value);

    // Collect selected struggles
    const struggles = Array.from(document.querySelectorAll('#strugglesGrid input[type="checkbox"]:checked'))
      .map(cb => cb.value);

    try {
      const response = await fetch('/api/auth/onboarding', {
        method: 'POST',
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
        this.closeModal();
        this.showToast('Setup complete! Your verses will be personalized 🎯');
        // Reload today's verse to potentially get a personalized one
        this.loadVerse();
      } else {
        errorEl.textContent = data.error || 'Failed to save preferences';
        errorEl.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Onboarding error:', error);
      errorEl.textContent = 'Connection error';
      errorEl.classList.remove('hidden');
    }
  }

  skipOnboarding() {
    this.closeModal();
    this.showToast('You can set preferences later in your profile');
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
              <label class="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Prayer Frequency</label>
              <select id="profilePrayerFrequency" class="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                <option value="daily" ${this.currentUser.prayerFrequency === 'daily' ? 'selected' : ''}>Daily</option>
                <option value="weekly" ${this.currentUser.prayerFrequency === 'weekly' ? 'selected' : ''}>Weekly</option>
                <option value="as_needed" ${this.currentUser.prayerFrequency === 'as_needed' ? 'selected' : ''}>As Needed</option>
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

    try {
      const response = await fetch('/api/auth/preferences', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          lifeStage,
          prayerFrequency,
          preferredTranslation
        })
      });

      const data = await response.json();

      if (data.success) {
        this.currentUser.lifeStage = lifeStage;
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

  
  escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
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
    const linksContainer = document.getElementById('quickLinksList');
    const linksButton = document.getElementById('linksBtn');
    
    console.log('DisplayOrganizationLinks called with:', links);
    console.log('Links container found:', !!linksContainer);
    console.log('Links button found:', !!linksButton);
    
    if (!linksContainer || !links || links.length === 0) {
      console.log('Hiding links button - no links or container missing');
      if (linksButton) {
        linksButton.style.display = 'none';
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

    linksContainer.innerHTML = links.map(link => `
      <button onclick="window.open('${link.url}', '_blank')" 
              class="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center space-x-2">
        <span>${iconMap[link.icon] || '🌐'}</span>
        <span class="truncate">${link.title}</span>
      </button>
    `).join('');
    
    // Show the links button
    if (linksButton) {
      linksButton.style.display = 'flex';
    }
  }

  // ===== Calendar & CTA additions =====
  formatLocalDateString(dateInput) {
    const d = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  async updateCalendarIndicatorForToday() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const res = await fetch(this.withOrg('/api/organization/calendar/daily', { date: today }));
      const data = await res.json();
      console.log('[Calendar] daily events for', today, data);
      const dot = document.getElementById('calendarIndicator');
      if (dot) {
        if (data?.success && (data.events || []).length > 0) dot.classList.remove('hidden');
        else dot.classList.add('hidden');
      }
    } catch (e) {
      // ignore
    }
  }

  async openCalendarModal() {
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
    const items = this._calendar.events.filter(ev => this.formatLocalDateString(ev.start_at) === dateStr);
    if (items.length === 0) {
      list.innerHTML = `<div class="text-sm text-gray-500 dark:text-gray-400 py-2">No events on ${dateStr}</div>`;
      return;
    }
    const fmtTime = (ev) => {
      if (ev.all_day) return 'All day';
      const s = new Date(ev.start_at);
      const e = ev.end_at ? new Date(ev.end_at) : null;
      const f = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return e ? `${f(s)} – ${f(e)}` : f(s);
    };
    list.innerHTML = items.map(ev => {
      const dateLabel = new Date(ev.start_at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      const timeLabel = fmtTime(ev);
      const addressAnchor = ev.address ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.address)}" target="_blank" class="underline">${ev.address}</a>` : '';
      const directionsBtn = ev.address ? `<a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(ev.address)}" target="_blank" class="px-2 py-1 rounded-md text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600">Directions</a>` : '';
      const detailsBtn = ev.link ? `<a href="${ev.link}" target="_blank" class="px-2 py-1 rounded-md text-xs bg-primary-600 hover:bg-primary-700 text-white" onclick="app.trackAnalytics && app.trackAnalytics('calendar_details_click')">Details</a>` : '';
      return `
        <div class="p-3 mb-2 bg-gray-50 border border-gray-200 rounded-lg text-sm dark:bg-gray-900/40 dark:border-gray-700">
          <div class="font-semibold text-gray-900 dark:text-gray-100">${ev.title}</div>
          <div class="mt-1 space-y-1 text-gray-700 dark:text-gray-300">
            <div class="flex items-start gap-2"><span>🗓️</span><span>${dateLabel} • ${timeLabel}</span></div>
            ${ev.location ? `<div class="flex items-start gap-2"><span>🏛️</span><span>${ev.location}</span></div>` : ''}
            ${ev.address ? `<div class="flex items-start gap-2"><span>📍</span><span>${addressAnchor}</span></div>` : ''}
          </div>
          ${ev.description ? `<div class="mt-2 text-gray-600 dark:text-gray-400">${ev.description}</div>` : ''}
          ${(detailsBtn || directionsBtn) ? `<div class="mt-3 flex items-center gap-2">${detailsBtn}${directionsBtn}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  async initCTA() {
    try {
      const res = await fetch(this.withOrg('/api/organization/cta'));
      const data = await res.json();
      console.log('[CTA] response', data);
      const cta = data?.cta;
      if (!cta) return;
      this.renderCTACrawl(cta);
    } catch (e) {
      console.warn('[CTA] fetch failed', e);
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

    inner.style.backgroundColor = cta.bg_color || '#0ea5e9';
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
      inner.style.backgroundColor = `color-mix(in srgb, ${cta.bg_color || '#0ea5e9'} 90%, white 10%)`;
      rightArrow.style.transform = 'translateY(-50%) translateX(2px)';
    });
    inner.addEventListener('mouseleave', () => {
      inner.style.backgroundColor = cta.bg_color || '#0ea5e9';
      rightArrow.style.transform = 'translateY(-50%) translateX(0px)';
    });
    
    console.log('[CTA] rendering crawl, visible now');

    // Simple marquee effect
    const parent = textEl.parentElement;
    parent.style.overflow = 'hidden';
    
    // Edge fades for marquee
    const bg = cta.bg_color || '#0ea5e9';
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

    // Update group display
    this.updateGroupDisplay();
  }

  // Update the current group display in the menu
  updateGroupDisplay() {
    const currentGroupName = document.getElementById('currentGroupName');
    const groupSection = document.getElementById('groupSection');

    if (currentGroupName) {
      // Check for injected context first, then try to get from organization param
      if (window.nfcOrgContext && window.nfcOrgContext.organization) {
        currentGroupName.textContent = window.nfcOrgContext.organization.name;
        groupSection.style.display = 'block';
      } else if (this.orgParam) {
        // Try to get organization name from a cached lookup or default display
        currentGroupName.textContent = this.orgParam.toUpperCase();
        groupSection.style.display = 'block';
      } else {
        currentGroupName.textContent = 'No Group Selected';
        groupSection.style.display = 'block';
      }
    }
  }

  // Handle change group button click
  changeGroup() {
    // Get the current tag ID to pass to the chooser
    const tagId = this.tagIdParam || this.currentTagId;

    if (tagId) {
      // Navigate to the organization chooser with the current tag ID
      window.location.href = `/choose-organization?uid=${tagId}`;
    } else {
      // If no tag ID, show a message or navigate to a general chooser
      this.showToast('No NFC tag session found. Please scan an NFC tag first.');
    }

    // Hide menu after action
    this.hideQuickMenu();
  }

  // Handle request group button click
  requestGroup() {
    // Get the current tag ID to pass to the chooser page
    const tagId = this.tagIdParam || this.currentTagId;

    if (tagId) {
      // Navigate to the organization chooser which has request functionality
      window.location.href = `/choose-organization?uid=${tagId}`;
    } else {
      // If no tag ID, show a message or navigate to a general chooser
      this.showToast('No NFC tag session found. Please scan an NFC tag first.');
    }

    // Hide menu after action
    this.hideQuickMenu();
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
            <button onclick="window.location.href = '/choose-organization?uid=${tagId}'" 
                    class="w-full btn-primary text-sm">
              ✨ Claim Bracelet
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
        
        <button onclick="window.location.href = '/choose-organization?uid=${tagId}'" 
                class="w-full btn-primary text-sm">
          ✨ Choose Organization
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
            Changing organizations will reassign your bracelet. This action may require approval 
            from the new organization.
          </p>
        </div>
        
        <div class="space-y-3">
          <button onclick="window.location.href = '/choose-organization?uid=${tagId}'" 
                  class="w-full btn-primary">
            🔄 Choose New Organization
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
    if (!this.currentUser || !this.authToken) {
      return false;
    }

    try {
      const response = await fetch(`/api/user/bracelet/${tagId}/linked`, {
        headers: {
          'Authorization': `Bearer ${this.authToken}`
        }
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
    if (!this.currentUser) {
      this.showToast('Please login first to link your bracelet');
      return;
    }

    try {
      const response = await fetch('/api/user/link-bracelet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`
        },
        body: JSON.stringify({
          bracelet_uid: tagId,
          is_primary: true // Mark as primary since it's the one they're using
        })
      });

      const data = await response.json();
      
      if (data.success) {
        this.showToast('✅ Bracelet linked to your account!');
        // Refresh the bracelet info to show the linked status
        this.loadBraceletInfo();
      } else {
        this.showToast(`❌ ${data.error || 'Failed to link bracelet'}`);
      }
    } catch (error) {
      console.error('Error linking bracelet:', error);
      this.showToast('❌ Connection error. Please try again.');
    }
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