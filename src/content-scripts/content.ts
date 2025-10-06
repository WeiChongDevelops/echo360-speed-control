(function() {
  'use strict';

  interface SpeedMessage {
    type: string;
    speed?: number;
    enabled?: boolean;
  }

  interface ChromeMessage {
    action: string;
    speed?: number;
    enabled?: boolean;
  }

  interface SpeedResponse {
    speed?: number;
    success?: boolean;
  }

  function getDomainKey(): string {
    const hostname = window.location.hostname.replace('www.', '');
    return `speed_${hostname}`;
  }

  const isEcho360 = window.location.hostname.includes('echo360');
  const scriptName = isEcho360 ? 'injected/injector-simple.js' : 'injected/injector.js';

  const script = document.createElement('script');
  script.src = chrome.runtime.getURL(scriptName);
  script.onload = function() {
    script.remove();

    const key = getDomainKey();
    chrome.storage.sync.get([key, 'shortcutsEnabled'], (result) => {
      if (result[key]) {
        const savedSpeed = parseFloat(result[key] as string);
        window.postMessage({
          type: 'SET_ECHO_SPEED',
          speed: savedSpeed
        } as SpeedMessage, '*');
      }

      // Send shortcuts setting to injected script
      const shortcutsEnabled = result.shortcutsEnabled !== false; // Default to true
      window.postMessage({
        type: 'SET_SHORTCUTS_ENABLED',
        enabled: shortcutsEnabled
      } as SpeedMessage, '*');
    });
  };
  script.onerror = function() {
    console.error('Failed to load injected script');
  };
  (document.head || document.documentElement).appendChild(script);

  window.addEventListener('storage', (e) => {
    const key = getDomainKey();
    if (e.key === key && e.newValue) {
      const newSpeed = parseFloat(e.newValue);
      window.postMessage({
        type: 'SET_ECHO_SPEED',
        speed: newSpeed
      } as SpeedMessage, '*');
    }
  });

  // Listen for speed changes from the injected script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    if (event.data.type === 'SPEED_CHANGED') {
      // Save the new speed to storage
      const key = getDomainKey();
      chrome.storage.sync.set({ [key]: event.data.speed });

      // Notify the popup if it's open
      chrome.runtime.sendMessage({
        action: 'speedChanged',
        speed: event.data.speed
      });
    }
  });

  chrome.runtime.onMessage.addListener((request: ChromeMessage, sender, sendResponse) => {
    if (request.action === 'setSpeed') {
      window.postMessage({
        type: 'SET_ECHO_SPEED',
        speed: request.speed
      } as SpeedMessage, '*');
      const key = getDomainKey();
      chrome.storage.sync.set({ [key]: request.speed });

      sendResponse({ success: true } as SpeedResponse);
      return true;
    } else if (request.action === 'getSpeed') {
      window.postMessage({ type: 'GET_ECHO_SPEED' } as SpeedMessage, '*');
      const listener = (event: MessageEvent) => {
        if (event.data.type === 'CURRENT_ECHO_SPEED') {
          window.removeEventListener('message', listener);
          sendResponse({ speed: event.data.speed } as SpeedResponse);
        }
      };
      window.addEventListener('message', listener);
      setTimeout(() => {
        window.removeEventListener('message', listener);
        sendResponse({ speed: 1 } as SpeedResponse);
      }, 1000);

      return true;
    } else if (request.action === 'updateShortcuts') {
      // Forward shortcuts update to injected script
      window.postMessage({
        type: 'SET_SHORTCUTS_ENABLED',
        enabled: request.enabled
      } as SpeedMessage, '*');
      sendResponse({ success: true } as SpeedResponse);
      return true;
    }
  });

})();
