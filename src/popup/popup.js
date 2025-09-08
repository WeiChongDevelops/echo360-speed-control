(function() {
  'use strict';

  const currentSpeedEl = document.getElementById('currentSpeed');
  const speedSlider = document.getElementById('speedSlider');
  const sliderValueEl = document.getElementById('sliderValue');
  const statusEl = document.getElementById('status');
  const presetButtons = document.querySelectorAll('.preset-btn');
  const themeToggle = document.getElementById('themeToggle');
  const shortcutsToggle = document.getElementById('shortcutsToggle');
  const keyboardHint = document.querySelector('.keyboard-hint');
  
  let currentDomain = '';

  initTheme();
  initShortcuts();
  getCurrentSpeed();
  listenForSpeedChanges();
  function initTheme() {
    chrome.storage.sync.get(['theme'], (result) => {
      const theme = result.theme || 'dark';
      document.documentElement.className = theme === 'light' ? 'light' : '';
    });
  }

  function toggleTheme() {
    const isLight = document.documentElement.classList.contains('light');
    const newTheme = isLight ? 'dark' : 'light';
    
    document.documentElement.className = newTheme === 'light' ? 'light' : '';
    chrome.storage.sync.set({ theme: newTheme });
  }

  function initShortcuts() {
    chrome.storage.sync.get(['shortcutsEnabled'], (result) => {
      const enabled = result.shortcutsEnabled !== false; // Default to true
      shortcutsToggle.checked = enabled;
      keyboardHint.classList.toggle('disabled', !enabled);
    });
  }

  function toggleShortcuts() {
    const enabled = shortcutsToggle.checked;
    chrome.storage.sync.set({ shortcutsEnabled: enabled });
    keyboardHint.classList.toggle('disabled', !enabled);
    
    // Notify content script about the change
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { 
          action: 'updateShortcuts', 
          enabled: enabled 
        });
      }
    });
  }

  function getDomainKey() {
    return `speed_${currentDomain}`;
  }

  function saveSpeedForDomain(speed) {
    if (!currentDomain) return;
    
    const key = getDomainKey();
    chrome.storage.sync.set({ [key]: speed });
  }

  function loadSpeedForDomain() {
    if (!currentDomain) return;
    
    const key = getDomainKey();
    chrome.storage.sync.get([key], (result) => {
      if (result[key]) {
        const savedSpeed = parseFloat(result[key]);
        setSpeed(savedSpeed, false);
        speedSlider.value = savedSpeed;
        updateSliderDisplay();
        showStatus(`Restored speed: ${savedSpeed.toFixed(2)}x`, 'success');
      }
    });
  }

  function listenForSpeedChanges() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'updateSpeed') {
        // Update the UI with the new speed
        currentSpeedEl.textContent = `${request.speed.toFixed(2)}x`;
        speedSlider.value = request.speed;
        updateSliderDisplay();
      }
    });
  }

  function updateSliderDisplay() {
    const value = parseFloat(speedSlider.value);
    sliderValueEl.textContent = value.toFixed(2) + 'x';
    speedSlider.setAttribute('aria-valuenow', value);
  }

  function showDetailedError(type) {
    let message = '';
    statusEl.className = 'status error detailed-error';
    
    switch(type) {
      case 'no-video':
        message = 'No video detected. Please start playing a lecture first.';
        break;
      case 'not-connected':
        message = 'Extension not connected. Please refresh the page.';
        break;
      case 'invalid-page':
        message = 'This page is not an Echo360 lecture. Extension only works on Echo360 domains.';
        break;
      default:
        message = 'Something went wrong. Please try refreshing the page.';
    }
    
    statusEl.textContent = message;
  }

  function getCurrentSpeed() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        try {
          const url = new URL(tabs[0].url);
          currentDomain = url.hostname.replace('www.', '');
        } catch (e) {
          console.error('Invalid URL:', e);
        }
        
        chrome.tabs.sendMessage(tabs[0].id, { action: 'getSpeed' }, (response) => {
          if (chrome.runtime.lastError) {
            currentSpeedEl.textContent = 'N/A';
            
            if (tabs[0].url && tabs[0].url.includes('echo360')) {
              showDetailedError('not-connected');
            } else {
              showDetailedError('invalid-page');
            }
            return;
          }
          
          if (response && response.speed) {
            currentSpeedEl.textContent = response.speed.toFixed(2) + 'x';
            speedSlider.value = response.speed;
            updateSliderDisplay();
            
            setTimeout(() => {
              loadSpeedForDomain();
            }, 100);
          } else {
            currentSpeedEl.textContent = 'N/A';
            showDetailedError('no-video');
          }
        });
      }
    });
  }

  function setSpeed(speed, shouldSave = true) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { 
          action: 'setSpeed', 
          speed: parseFloat(speed) 
        }, (response) => {
          if (chrome.runtime.lastError) {
            showDetailedError('not-connected');
            return;
          }
          
          if (response && response.success) {
            currentSpeedEl.textContent = parseFloat(speed).toFixed(2) + 'x';
            showStatus('Speed set to ' + parseFloat(speed).toFixed(2) + 'x', 'success');
            
            if (shouldSave) {
              saveSpeedForDomain(parseFloat(speed));
            }
            
            speedSlider.value = speed;
            updateSliderDisplay();
          } else {
            showDetailedError('no-video');
          }
        });
      }
    });
  }

  function showStatus(message, type = '') {
    statusEl.textContent = message;
    statusEl.className = 'status ' + type;
    
    if (type !== 'error') {
      setTimeout(() => {
        statusEl.className = 'status';
        statusEl.textContent = 'Ready';
      }, 2000);
    }
  }

  themeToggle.addEventListener('click', toggleTheme);
  
  shortcutsToggle.addEventListener('change', toggleShortcuts);
  
  speedSlider.addEventListener('input', () => {
    updateSliderDisplay();
  });

  speedSlider.addEventListener('change', () => {
    setSpeed(speedSlider.value);
  });

  presetButtons.forEach(button => {
    button.addEventListener('click', () => {
      const speed = button.dataset.speed;
      setSpeed(speed);
    });
  });

  document.addEventListener('keydown', (e) => {
    // Number keys for quick speed selection
    if (e.key >= '1' && e.key <= '9') {
      const speed = parseInt(e.key);
      if (speed <= 5) {
        setSpeed(speed);
      }
    }
    
    // Arrow keys for slider control
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      const newValue = Math.max(0.25, parseFloat(speedSlider.value) - 0.25);
      speedSlider.value = newValue;
      updateSliderDisplay();
      setSpeed(newValue);
    }
    
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      const newValue = Math.min(4, parseFloat(speedSlider.value) + 0.25);
      speedSlider.value = newValue;
      updateSliderDisplay();
      setSpeed(newValue);
    }
    
    // R for reset to 1x
    if (e.key === 'r' || e.key === 'R') {
      setSpeed(1);
    }
    
    // T for theme toggle
    if (e.key === 't' || e.key === 'T') {
      toggleTheme();
    }
  });
})();