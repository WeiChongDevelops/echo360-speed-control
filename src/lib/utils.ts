/**
 * Utility functions for the Echo360 Speed Control extension
 */

/**
 * Clamps a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Formats a speed value for display
 */
export function formatSpeed(speed: number): string {
  return speed.toFixed(2) + 'x';
}

/**
 * Gets domain key for storage
 */
export function getDomainStorageKey(hostname: string): string {
  const cleanHostname = hostname.replace('www.', '');
  return `speed_${cleanHostname}`;
}

/**
 * Sends a message to the active tab
 */
export function sendMessageToActiveTab<T = any>(message: any): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) {
        reject(new Error('No active tab found'));
        return;
      }

      chrome.tabs.sendMessage(tabs[0].id!, message, (response: T) => {
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
 */
export function getFromStorage<T = any>(keys: string | string[]): Promise<T> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, (result) => resolve(result as T));
  });
}

/**
 * Sets a value in Chrome storage
 */
export function setInStorage(items: Record<string, any>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set(items, () => resolve());
  });
}

/**
 * Creates and styles a speed overlay element
 */
export function createSpeedOverlay(): HTMLElement {
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
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: number | null = null;
  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      func(...args);
    };
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(later, wait) as unknown as number;
  };
}

/**
 * Checks if current page is an Echo360 domain
 */
export function isEcho360Domain(url: string): boolean {
  return Boolean(url && url.includes('echo360'));
}

/**
 * Gets all video elements on the page
 */
export function getVideoElements(): NodeListOf<HTMLVideoElement> {
  return document.querySelectorAll('video, video.leader, video.sc-bUyWVT, video[data-test="leader"], video[role="region"]');
}
