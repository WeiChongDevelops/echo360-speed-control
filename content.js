// Early injection to override playbackRate before Echo360 scripts load
(function() {
  'use strict';

  // Inject our override script into the page context
  // Use simple version for Echo360 domains (less aggressive, cleaner)
  const isEcho360 = window.location.hostname.includes('echo360');
  const scriptName = isEcho360 ? 'injector-simple.js' : 'injector.js';
  
  
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL(scriptName);
  script.onload = function() {
    this.remove();
  };
  script.onerror = function() {
  };
  (document.head || document.documentElement).appendChild(script);

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'setSpeed') {
      // Use postMessage for all domains to avoid CSP issues
      window.postMessage({ 
        type: 'SET_ECHO_SPEED', 
        speed: request.speed 
      }, '*');
      sendResponse({ success: true });
      return true;
    } else if (request.action === 'getSpeed') {
      // Request current speed via postMessage
      window.postMessage({ type: 'GET_ECHO_SPEED' }, '*');
      
      // Wait for response
      const listener = (event) => {
        if (event.data.type === 'CURRENT_ECHO_SPEED') {
          window.removeEventListener('message', listener);
          sendResponse({ speed: event.data.speed });
        }
      };
      window.addEventListener('message', listener);
      
      // Timeout after 1 second if no response
      setTimeout(() => {
        window.removeEventListener('message', listener);
        sendResponse({ speed: 1 });
      }, 1000);
      
      return true; // Keep message channel open for async response
    }
  });

})();