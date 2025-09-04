/**
 * Controller module for popup functionality
 */

class PopupController {
  constructor() {
    this.currentDomain = '';
    this.initializeElements();
    this.loadConstants();
  }

  /**
   * Initialize DOM element references
   */
  initializeElements() {
    this.elements = {
      currentSpeed: document.getElementById('currentSpeed'),
      speedSlider: document.getElementById('speedSlider'),
      sliderValue: document.getElementById('sliderValue'),
      status: document.getElementById('status'),
      themeToggle: document.getElementById('themeToggle'),
      shortcutsToggle: document.getElementById('shortcutsToggle'),
      keyboardHint: document.querySelector('.keyboard-hint'),
      presetButtons: document.querySelectorAll('.preset-btn'),
      presetsToggle: document.getElementById('presetsToggle'),
      presetButtonsWrapper: document.getElementById('presetButtons')
    };
  }

  /**
   * Load configuration constants
   */
  loadConstants() {
    // These would normally be imported from constants.js
    this.config = {
      SPEED_MIN: 0.25,
      SPEED_MAX: 3.0,
      SPEED_STEP: 0.25,
      SPEED_DEFAULT: 1.0,
      STATUS_TIMEOUT: 2000,
      STORAGE_THEME: 'theme',
      STORAGE_SHORTCUTS: 'shortcutsEnabled',
      DEFAULT_THEME: 'dark',
      DEFAULT_SHORTCUTS: true
    };

    this.actions = {
      SET_SPEED: 'setSpeed',
      GET_SPEED: 'getSpeed',
      UPDATE_SHORTCUTS: 'updateShortcuts'
    };

    this.errorTypes = {
      NO_VIDEO: 'no-video',
      NOT_CONNECTED: 'not-connected',
      INVALID_PAGE: 'invalid-page'
    };
  }

  /**
   * Initialize the popup
   */
  async init() {
    await this.initTheme();
    await this.initShortcuts();
    await this.getCurrentSpeed();
    this.attachEventListeners();
    this.listenForSpeedChanges();
  }

  /**
   * Initialize theme from storage
   */
  async initTheme() {
    const result = await this.getStorage([this.config.STORAGE_THEME]);
    const theme = result[this.config.STORAGE_THEME] || this.config.DEFAULT_THEME;
    document.documentElement.className = theme === 'light' ? 'light' : '';
  }

  /**
   * Initialize shortcuts setting from storage
   */
  async initShortcuts() {
    const result = await this.getStorage([this.config.STORAGE_SHORTCUTS]);
    const enabled = result[this.config.STORAGE_SHORTCUTS] !== false;
    this.elements.shortcutsToggle.checked = enabled;
    this.elements.keyboardHint.classList.toggle('disabled', !enabled);
  }

  /**
   * Toggle theme between light and dark
   */
  toggleTheme() {
    const isLight = document.documentElement.classList.contains('light');
    const newTheme = isLight ? 'dark' : 'light';
    document.documentElement.className = newTheme === 'light' ? 'light' : '';
    this.setStorage({ [this.config.STORAGE_THEME]: newTheme });
  }

  /**
   * Toggle keyboard shortcuts
   */
  async toggleShortcuts() {
    const enabled = this.elements.shortcutsToggle.checked;
    await this.setStorage({ [this.config.STORAGE_SHORTCUTS]: enabled });
    this.elements.keyboardHint.classList.toggle('disabled', !enabled);
    
    try {
      await this.sendMessage({
        action: this.actions.UPDATE_SHORTCUTS,
        enabled: enabled
      });
    } catch (error) {
      console.error('Failed to update shortcuts:', error);
    }
  }

  /**
   * Get current playback speed
   */
  async getCurrentSpeed() {
    try {
      const tabs = await this.getActiveTabs();
      if (!tabs[0]) return;

      // Extract domain
      try {
        const url = new URL(tabs[0].url);
        this.currentDomain = url.hostname.replace('www.', '');
      } catch (e) {
        console.error('Invalid URL:', e);
      }

      const response = await this.sendTabMessage(tabs[0].id, {
        action: this.actions.GET_SPEED
      });

      if (response && response.speed) {
        this.updateSpeedDisplay(response.speed);
        setTimeout(() => this.loadSpeedForDomain(), 100);
      } else {
        this.elements.currentSpeed.textContent = 'N/A';
        this.showDetailedError(this.errorTypes.NO_VIDEO);
      }
    } catch (error) {
      this.elements.currentSpeed.textContent = 'N/A';
      if (this.currentDomain.includes('echo360')) {
        this.showDetailedError(this.errorTypes.NOT_CONNECTED);
      } else {
        this.showDetailedError(this.errorTypes.INVALID_PAGE);
      }
    }
  }

  /**
   * Set playback speed
   */
  async setSpeed(speed, shouldSave = true) {
    try {
      const response = await this.sendMessage({
        action: this.actions.SET_SPEED,
        speed: parseFloat(speed)
      });

      if (response && response.success) {
        this.updateSpeedDisplay(parseFloat(speed));
        this.showStatus(`Speed set to ${parseFloat(speed).toFixed(2)}x`, 'success');
        
        if (shouldSave) {
          await this.saveSpeedForDomain(parseFloat(speed));
        }
      } else {
        this.showDetailedError(this.errorTypes.NO_VIDEO);
      }
    } catch (error) {
      this.showDetailedError(this.errorTypes.NOT_CONNECTED);
    }
  }

  /**
   * Update speed display
   */
  updateSpeedDisplay(speed) {
    this.elements.currentSpeed.textContent = `${speed.toFixed(2)}x`;
    this.elements.speedSlider.value = speed;
    this.elements.sliderValue.textContent = `${speed.toFixed(2)}x`;
    this.elements.speedSlider.setAttribute('aria-valuenow', speed);
  }

  /**
   * Save speed for current domain
   */
  async saveSpeedForDomain(speed) {
    if (!this.currentDomain) return;
    const key = `speed_${this.currentDomain}`;
    await this.setStorage({ [key]: speed });
  }

  /**
   * Load saved speed for current domain
   */
  async loadSpeedForDomain() {
    if (!this.currentDomain) return;
    const key = `speed_${this.currentDomain}`;
    const result = await this.getStorage([key]);
    
    if (result[key]) {
      const savedSpeed = parseFloat(result[key]);
      await this.setSpeed(savedSpeed, false);
      this.updateSpeedDisplay(savedSpeed);
      this.showStatus(`Restored speed: ${savedSpeed.toFixed(2)}x`, 'success');
    }
  }

  /**
   * Show status message
   */
  showStatus(message, type = '') {
    this.elements.status.textContent = message;
    this.elements.status.className = `status ${type}`;
    
    if (type !== 'error') {
      setTimeout(() => {
        this.elements.status.className = 'status';
        this.elements.status.textContent = 'Ready';
      }, this.config.STATUS_TIMEOUT);
    }
  }

  /**
   * Show detailed error message
   */
  showDetailedError(type) {
    const messages = {
      [this.errorTypes.NO_VIDEO]: 'No video detected. Please start playing a lecture first.',
      [this.errorTypes.NOT_CONNECTED]: 'Extension not connected. Please refresh the page.',
      [this.errorTypes.INVALID_PAGE]: 'This page is not an Echo360 lecture. Extension only works on Echo360 domains.'
    };
    
    this.elements.status.className = 'status error detailed-error';
    this.elements.status.textContent = messages[type] || 'Something went wrong. Please try refreshing the page.';
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Theme toggle
    this.elements.themeToggle.addEventListener('click', () => this.toggleTheme());
    
    // Shortcuts toggle
    this.elements.shortcutsToggle.addEventListener('change', () => this.toggleShortcuts());
    
    // Speed slider
    this.elements.speedSlider.addEventListener('input', () => {
      this.elements.sliderValue.textContent = `${parseFloat(this.elements.speedSlider.value).toFixed(2)}x`;
      this.elements.speedSlider.setAttribute('aria-valuenow', this.elements.speedSlider.value);
    });
    
    this.elements.speedSlider.addEventListener('change', () => {
      this.setSpeed(this.elements.speedSlider.value);
    });
    
    // Preset buttons
    this.elements.presetButtons.forEach(button => {
      button.addEventListener('click', () => {
        this.setSpeed(button.dataset.speed);
      });
    });
    
    // Keyboard shortcuts
    this.attachKeyboardListeners();
  }

  /**
   * Listen for speed changes from content script
   */
  listenForSpeedChanges() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'updateSpeed') {
        // Update the UI with the new speed
        this.updateSpeedDisplay(request.speed);
        
        // Don't save to storage as it's already saved by content script
        // Just update the UI
      }
    });
  }

  /**
   * Attach keyboard shortcut listeners
   */
  attachKeyboardListeners() {
    document.addEventListener('keydown', (e) => {
      // Number keys for speed selection
      if (e.key >= '1' && e.key <= '9') {
        const speed = parseInt(e.key);
        if (speed <= this.config.SPEED_MAX) {
          this.setSpeed(speed);
        }
      }
      
      // Arrow keys for slider control
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        const newValue = Math.max(this.config.SPEED_MIN, parseFloat(this.elements.speedSlider.value) - this.config.SPEED_STEP);
        this.elements.speedSlider.value = newValue;
        this.updateSpeedDisplay(newValue);
        this.setSpeed(newValue);
      }
      
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        const newValue = Math.min(this.config.SPEED_MAX, parseFloat(this.elements.speedSlider.value) + this.config.SPEED_STEP);
        this.elements.speedSlider.value = newValue;
        this.updateSpeedDisplay(newValue);
        this.setSpeed(newValue);
      }
      
      // R for reset
      if (e.key === 'r' || e.key === 'R') {
        this.setSpeed(this.config.SPEED_DEFAULT);
      }
      
      // T for theme toggle
      if (e.key === 't' || e.key === 'T') {
        this.toggleTheme();
      }
    });
  }

  /**
   * Helper: Get from Chrome storage
   */
  getStorage(keys) {
    return new Promise((resolve) => {
      chrome.storage.sync.get(keys, resolve);
    });
  }

  /**
   * Helper: Set in Chrome storage
   */
  setStorage(items) {
    return new Promise((resolve) => {
      chrome.storage.sync.set(items, resolve);
    });
  }

  /**
   * Helper: Get active tabs
   */
  getActiveTabs() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, resolve);
    });
  }

  /**
   * Helper: Send message to tab
   */
  sendTabMessage(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  }

  /**
   * Helper: Send message to active tab
   */
  async sendMessage(message) {
    const tabs = await this.getActiveTabs();
    if (!tabs[0]) throw new Error('No active tab');
    return this.sendTabMessage(tabs[0].id, message);
  }
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const controller = new PopupController();
  controller.init();
});