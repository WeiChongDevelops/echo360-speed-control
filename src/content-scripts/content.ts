(function() {
  'use strict';

  interface SpeedMessage {
    type: string;
    speed?: number;
    enabled?: boolean;
    linkedinIcon?: string;
    hideSlowSpeeds?: boolean;
    duration?: number;
    currentTime?: number;
  }

  interface ChromeMessage {
    action: string;
    speed?: number;
    enabled?: boolean;
  }

  interface SpeedResponse {
    speed?: number;
    success?: boolean;
    connected?: boolean;
    hasVideo?: boolean;
    durationKind?: 'finite' | 'live' | 'unknown';
    duration?: number;
    currentTime?: number;
  }

  function getDomainKey(): string {
    return 'speed_echo360';
  }

  const isEcho360 = window.location.hostname.includes('echo360');
  const scriptName = isEcho360 ? 'injected/injector-simple.js' : 'injected/injector.js';

  const script = document.createElement('script');
  script.src = chrome.runtime.getURL(scriptName);
  script.onload = function() {
    script.remove();

    const key = getDomainKey();
    chrome.storage.sync.get([key, 'shortcutsEnabled', 'hideSlowSpeeds'], (result) => {
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

      // Send hide-slow-speeds preference (default false)
      window.postMessage({
        type: 'SET_HIDE_SLOW_SPEEDS',
        hideSlowSpeeds: result.hideSlowSpeeds === true
      } as SpeedMessage, '*');

      // Send LinkedIn icon URL to injected (ARCH-001: chrome.* lives in content script only)
      window.postMessage({
        type: 'SET_ASSET_URLS',
        linkedinIcon: chrome.runtime.getURL('assets/icons/linkedin.svg')
      } as SpeedMessage, '*');
    });
  };
  script.onerror = function() {
    console.error('[Echo360 Speed Control] Failed to load injected script');
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
    } else if (event.data.type === 'HIDE_SLOW_SPEEDS_CHANGED') {
      chrome.storage.sync.set({ hideSlowSpeeds: event.data.hideSlowSpeeds === true });
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
        if (event.source !== window) return;
        if (event.data.type === 'CURRENT_ECHO_SPEED') {
          window.removeEventListener('message', listener);
          const hasVideo = document.querySelector('video') !== null;
          const rawDuration: number = typeof event.data.duration === 'number' ? event.data.duration : NaN;
          const rawCurrentTime: number = typeof event.data.currentTime === 'number' ? event.data.currentTime : 0;
          const durationKind: 'finite' | 'live' | 'unknown' =
            Number.isNaN(rawDuration) ? 'unknown'
              : !Number.isFinite(rawDuration) ? 'live'
              : 'finite';
          sendResponse({
            connected: true,
            hasVideo,
            speed: event.data.speed,
            durationKind,
            duration: durationKind === 'finite' ? rawDuration : 0,
            currentTime: rawCurrentTime
          } as SpeedResponse);
        }
      };
      window.addEventListener('message', listener);
      setTimeout(() => {
        window.removeEventListener('message', listener);
        sendResponse({ connected: true, hasVideo: false, speed: 1 } as SpeedResponse);
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
