(function() {
  'use strict';

  function getDomainKey() {
    const hostname = window.location.hostname.replace('www.', '');
    return `speed_${hostname}`;
  }

  const isEcho360 = window.location.hostname.includes('echo360');
  const scriptName = isEcho360 ? 'src/injected/injector-simple.js' : 'src/injected/injector.js';
  
  
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL(scriptName);
  script.onload = function() {
    this.remove();
    
    const key = getDomainKey();
    chrome.storage.sync.get([key, 'shortcutsEnabled'], (result) => {
      if (result[key]) {
        const savedSpeed = parseFloat(result[key]);
        window.postMessage({ 
          type: 'SET_ECHO_SPEED', 
          speed: savedSpeed 
        }, '*');
      }
      
      // Send shortcuts setting to injected script
      const shortcutsEnabled = result.shortcutsEnabled !== false; // Default to true
      window.postMessage({ 
        type: 'SET_SHORTCUTS_ENABLED', 
        enabled: shortcutsEnabled 
      }, '*');
    });
  };
  script.onerror = function() {
  };
  (document.head || document.documentElement).appendChild(script);

  window.addEventListener('storage', (e) => {
    const key = getDomainKey();
    if (e.key === key && e.newValue) {
      const newSpeed = parseFloat(e.newValue);
      window.postMessage({ 
        type: 'SET_ECHO_SPEED', 
        speed: newSpeed 
      }, '*');
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

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'setSpeed') {
      window.postMessage({ 
        type: 'SET_ECHO_SPEED', 
        speed: request.speed 
      }, '*');
      const key = getDomainKey();
      chrome.storage.sync.set({ [key]: request.speed });
      
      sendResponse({ success: true });
      return true;
    } else if (request.action === 'getSpeed') {
      window.postMessage({ type: 'GET_ECHO_SPEED' }, '*');
      const listener = (event) => {
        if (event.data.type === 'CURRENT_ECHO_SPEED') {
          window.removeEventListener('message', listener);
          sendResponse({ speed: event.data.speed });
        }
      };
      window.addEventListener('message', listener);
      setTimeout(() => {
        window.removeEventListener('message', listener);
        sendResponse({ speed: 1 });
      }, 1000);
      
      return true;    
    } else if (request.action === 'updateShortcuts') {
      // Forward shortcuts update to injected script
      window.postMessage({ 
        type: 'SET_SHORTCUTS_ENABLED', 
        enabled: request.enabled 
      }, '*');
      sendResponse({ success: true });
      return true;
    }
  });

})();