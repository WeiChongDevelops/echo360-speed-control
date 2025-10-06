/**
 * Utility functions for the Echo360 Speed Control extension
 */
/**
 * Clamps a value between min and max
 */
export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
/**
 * Formats a speed value for display
 */
export function formatSpeed(speed) {
    return speed.toFixed(2) + 'x';
}
/**
 * Gets domain key for storage
 */
export function getDomainStorageKey(hostname) {
    const cleanHostname = hostname.replace('www.', '');
    return `speed_${cleanHostname}`;
}
/**
 * Sends a message to the active tab
 */
export function sendMessageToActiveTab(message) {
    return new Promise((resolve, reject) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]) {
                reject(new Error('No active tab found'));
                return;
            }
            chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                }
                else {
                    resolve(response);
                }
            });
        });
    });
}
/**
 * Gets a value from Chrome storage
 */
export function getFromStorage(keys) {
    return new Promise((resolve) => {
        chrome.storage.sync.get(keys, (result) => resolve(result));
    });
}
/**
 * Sets a value in Chrome storage
 */
export function setInStorage(items) {
    return new Promise((resolve) => {
        chrome.storage.sync.set(items, () => resolve());
    });
}
/**
 * Creates and styles a speed overlay element
 */
export function createSpeedOverlay() {
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
 */
export function debounce(func, wait) {
    let timeout = null;
    return function executedFunction(...args) {
        const later = () => {
            timeout = null;
            func(...args);
        };
        if (timeout)
            clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
/**
 * Checks if current page is an Echo360 domain
 */
export function isEcho360Domain(url) {
    return Boolean(url && url.includes('echo360'));
}
/**
 * Gets all video elements on the page
 */
export function getVideoElements() {
    return document.querySelectorAll('video, video.leader, video.sc-bUyWVT, video[data-test="leader"], video[role="region"]');
}
