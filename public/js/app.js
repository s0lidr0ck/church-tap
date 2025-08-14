class ChurchTapApp {
  constructor() {
    this.currentDate = new Date().toISOString().split('T')[0];
    this.currentVerse = null;
    this.textSize = localStorage.getItem('textSize') || 'medium';
    this.theme = localStorage.getItem('theme') || 'light';
    this.userToken = this.getUserToken();
    this.favorites = JSON.parse(localStorage.getItem('favorites') || '[]');
    this.recentlyViewed = JSON.parse(localStorage.getItem('recentlyViewed') || '[]');
    
    this.currentCommunity = null;
    this.userInteractions = JSON.parse(localStorage.getItem('userInteractions') || '{}');
    this.currentUser = null;
    this.authToken = null;
    
    this.init();
  }

  init() {
    try {
      console.log('1. Starting init');
      this.setupEventListeners();
      console.log('2. Event listeners setup');
      this.applyTheme();
      console.log('3. Theme applied');
      this.applyTextSize();
      console.log('4. Text size applied');
      this.checkAuthStatus();
      console.log('5. Auth status checked');
      this.hideSplashScreen();
      console.log('6. Splash screen hidden');
      this.loadVerse(this.currentDate);
      console.log('7. Verse loading started');
      this.loadCommunity(this.currentDate);
      console.log('8. Community loading started');
      this.setupSwipeGestures();
      console.log('9. Swipe gestures setup');
      this.checkNotificationPermission();
      console.log('10. Notification permission checked');
      this.detectNFCSupport();
      console.log('11. NFC support detected');
    } catch (error) {
      console.error('Init error:', error);
      // Still show the app even if there's an error
      this.hideSplashScreen();
    }
  }

  setupEventListeners() {
    // Theme toggle
    document.getElementById('themeToggle').addEventListener('click', () => {
      this.toggleTheme();
    });

    // Text size toggle
    document.getElementById('textSizeBtn').addEventListener('click', () => {
      this.cycleTextSize();
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

    // Quick menu actions
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
      this.openSearch();
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

    // Community event listeners
    document.getElementById('submitPrayerBtn').addEventListener('click', () => {
      this.showPrayerRequestModal();
    });

    document.getElementById('submitPraiseBtn').addEventListener('click', () => {
      this.showPraiseReportModal();
    });

    // Authentication event listeners
    document.getElementById('loginBtn').addEventListener('click', () => {
      this.showLoginModal();
    });

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

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('quickMenu');
      const toggle = document.getElementById('menuToggle');
      if (!menu.contains(e.target) && !toggle.contains(e.target)) {
        menu.classList.add('hidden');
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
      
      if (Math.abs(diffX) > Math.abs(diffY)) {
        if (Math.abs(diffX) > 50) {
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
        if (Math.abs(diffY) > 100) {
          if (diffY > 0) {
            // Swipe up - increase text size
            this.cycleTextSize();
          } else {
            // Swipe down - decrease text size
            this.cycleTextSize(true);
          }
          startX = 0;
          startY = 0;
        }
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
      
      const response = await fetch(`/api/verse/${date}`);
      const data = await response.json();
      
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

  updateDateDisplay(date) {
    const dateObj = new Date(date + 'T00:00:00');
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const dateStr = dateObj.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    
    document.getElementById('currentDate').textContent = dateStr;
    
    const description = document.getElementById('dateDescription');
    if (date === today.toISOString().split('T')[0]) {
      description.textContent = "Today's Verse";
    } else if (date === yesterday.toISOString().split('T')[0]) {
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
    if (newDate > today || newDate < twoWeeksAgoStr) {
      navigator.vibrate && navigator.vibrate(100);
      return;
    }
    
    this.currentDate = newDate;
    this.loadVerse(newDate);
    this.loadCommunity(newDate);
    
    // Add animation class
    const container = document.getElementById('verseContainer');
    container.style.opacity = '0';
    setTimeout(() => {
      container.style.opacity = '1';
    }, 150);
  }

  goToToday() {
    const today = new Date().toISOString().split('T')[0];
    this.currentDate = today;
    this.loadVerse(today);
    this.loadCommunity(today);
  }

  async showRandomVerse() {
    try {
      const response = await fetch('/api/verse/random');
      const data = await response.json();
      
      if (data.success && data.verse) {
        this.currentDate = data.verse.date;
        this.currentVerse = data.verse;
        this.displayVerse(data.verse);
        this.updateDateDisplay(data.verse.date);
        this.updateEngagementState();
        this.trackAnalytics('random_verse', data.verse.id);
        this.showToast('🎲 Random verse loaded!');
      }
    } catch (error) {
      console.error('Error loading random verse:', error);
      this.showToast('Failed to load random verse');
    }
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
  }

  toggleQuickMenu() {
    const menu = document.getElementById('quickMenu');
    menu.classList.toggle('hidden');
  }

  async toggleHeart() {
    if (!this.currentVerse) return;
    
    try {
      const response = await fetch('/api/verse/heart', {
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

  addToRecentlyViewed(verse) {
    const existing = this.recentlyViewed.findIndex(v => v.id === verse.id);
    if (existing !== -1) {
      this.recentlyViewed.splice(existing, 1);
    }
    
    this.recentlyViewed.unshift({
      id: verse.id,
      date: verse.date,
      preview: verse.content_type === 'text' 
        ? verse.verse_text.substring(0, 50) + '...'
        : verse.bible_reference
    });
    
    if (this.recentlyViewed.length > 5) {
      this.recentlyViewed = this.recentlyViewed.slice(0, 5);
    }
    
    localStorage.setItem('recentlyViewed', JSON.stringify(this.recentlyViewed));
  }

  async trackAnalytics(action, verseId = null) {
    try {
      await fetch('/api/analytics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: action,
          verse_id: verseId,
          user_token: this.userToken,
          timestamp: Date.now()
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

  // Community Functions
  async loadCommunity(date) {
    try {
      const response = await fetch(`/api/community/${date}`);
      const data = await response.json();
      
      if (data.success) {
        this.currentCommunity = data.community;
        this.displayCommunity(data.community);
      } else {
        this.showEmptyCommunity();
      }
    } catch (error) {
      console.error('Error loading community:', error);
      this.showEmptyCommunity();
    }
  }

  displayCommunity(community) {
    const { prayer_requests, praise_reports } = community;
    
    document.getElementById('loadingCommunity').classList.add('hidden');
    document.getElementById('communitySection').classList.remove('hidden');
    
    // Display prayer requests
    if (prayer_requests && prayer_requests.length > 0) {
      this.displayPrayerRequests(prayer_requests);
      document.getElementById('prayerRequestsSection').classList.remove('hidden');
    } else {
      document.getElementById('prayerRequestsSection').classList.add('hidden');
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
        (!praise_reports || praise_reports.length === 0)) {
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
      const response = await fetch('/api/prayer-request', {
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

  async submitPraiseReport(content) {
    try {
      const response = await fetch('/api/praise-report', {
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
      const response = await fetch('/api/prayer-request/pray', {
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

  async celebrateReport(praiseReportId) {
    try {
      const response = await fetch('/api/praise-report/celebrate', {
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
      const response = await fetch('/api/auth/me', {
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
    // Show logged in elements
    document.getElementById('loginBtn').classList.add('hidden');
    document.getElementById('userMenuBtn').classList.remove('hidden');
    document.getElementById('userMenuItems').classList.remove('hidden');
    document.getElementById('guestMenuItems').classList.add('hidden');

    // Update user avatar with initials
    if (this.currentUser) {
      const initials = this.getUserInitials(this.currentUser);
      document.getElementById('userAvatar').textContent = initials;
    }
  }

  updateUIForLoggedOutUser() {
    // Show logged out elements
    document.getElementById('loginBtn').classList.remove('hidden');
    document.getElementById('userMenuBtn').classList.add('hidden');
    document.getElementById('userMenuItems').classList.add('hidden');
    document.getElementById('guestMenuItems').classList.remove('hidden');
    
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
            <option value="">Select translation</option>
            <option value="NIV">NIV - New International Version</option>
            <option value="ESV">ESV - English Standard Version</option>
            <option value="NLT">NLT - New Living Translation</option>
            <option value="NASB">NASB - New American Standard Bible</option>
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
                <option value="NIV" ${this.currentUser.preferredTranslation === 'NIV' ? 'selected' : ''}>NIV</option>
                <option value="ESV" ${this.currentUser.preferredTranslation === 'ESV' ? 'selected' : ''}>ESV</option>
                <option value="NLT" ${this.currentUser.preferredTranslation === 'NLT' ? 'selected' : ''}>NLT</option>
                <option value="NASB" ${this.currentUser.preferredTranslation === 'NASB' ? 'selected' : ''}>NASB</option>
                <option value="KJV" ${this.currentUser.preferredTranslation === 'KJV' ? 'selected' : ''}>KJV</option>
              </select>
            </div>
            
            <div id="preferencesError" class="hidden text-red-600 text-sm"></div>
            <button type="submit" class="w-full btn-primary">Update Preferences</button>
          </form>
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
}

// Initialize the app
window.churchTapApp = new ChurchTapApp();