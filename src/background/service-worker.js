/**
 * Service worker for handling communication between popup and content scripts
 */

// Relay speed change messages to all connected popups
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'speedChanged') {
    // Broadcast to all extension views (including popup)
    chrome.runtime.sendMessage({
      action: 'updateSpeed',
      speed: request.speed,
      tabId: sender.tab?.id
    });
  }
});