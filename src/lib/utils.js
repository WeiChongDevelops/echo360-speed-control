/**
 * Utility functions for the Echo360 Speed Control extension
 */

/**
 * Clamps a value between min and max
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Formats a speed value for display
 * @param {number} speed - Speed value
 * @returns {string} Formatted speed string (e.g., "1.50x")
 */
function formatSpeed(speed) {
  return speed.toFixed(2) + 'x';
}

/**
 * Gets domain key for storage
 * @param {string} hostname - The hostname to create key for
 * @returns {string} Storage key for the domain
 */
function getDomainStorageKey(hostname) {
  const cleanHostname = hostname.replace('www.', '');
  return `speed_${cleanHostname}`;
}

/**
 * Sends a message to the active tab
 * @param {object} message - Message to send
 * @returns {Promise} Promise that resolves with the response
 */
function sendMessageToActiveTab(message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) {
        reject(new Error('No active tab found'));
        return;
      }
      
      chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  });
}

/**
 * Gets a value from Chrome storage
 * @param {string|string[]} keys - Storage key(s) to retrieve
 * @returns {Promise} Promise that resolves with the stored values
 */
function getFromStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, resolve);
  });
}

/**
 * Sets a value in Chrome storage
 * @param {object} items - Items to store
 * @returns {Promise} Promise that resolves when stored
 */
function setInStorage(items) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(items, resolve);
  });
}

/**
 * Creates and styles a speed overlay element
 * @returns {HTMLElement} The created overlay element
 */
function createSpeedOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'echo360-speed-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: rgba(0, 0, 0, 0.8);
    color: #4CAF50;
    padding: 10px 20px;
    border-radius: 25px;
    font-size: 18px;
    font-weight: bold;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    z-index: 999999;
    transition: opacity 0.3s ease;
    pointer-events: none;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  `;
  return overlay;
}

/**
 * Debounce function to limit function execution rate
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Checks if current page is an Echo360 domain
 * @param {string} url - URL to check
 * @returns {boolean} True if Echo360 domain
 */
function isEcho360Domain(url) {
  return url && url.includes('echo360');
}

/**
 * Gets all video elements on the page
 * @returns {NodeList} List of video elements
 */
function getVideoElements() {
  return document.querySelectorAll('video, video.leader, video.sc-bUyWVT, video[data-test="leader"], video[role="region"]');
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    clamp,
    formatSpeed,
    getDomainStorageKey,
    sendMessageToActiveTab,
    getFromStorage,
    setInStorage,
    createSpeedOverlay,
    debounce,
    isEcho360Domain,
    getVideoElements
  };
}