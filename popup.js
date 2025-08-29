// Popup script for Chrome extension
(function() {
  'use strict';

  const currentSpeedEl = document.getElementById('currentSpeed');
  const speedSlider = document.getElementById('speedSlider');
  const sliderValueEl = document.getElementById('sliderValue');
  const statusEl = document.getElementById('status');
  const presetButtons = document.querySelectorAll('.preset-btn');

  // Get current speed on popup open
  getCurrentSpeed();

  // Update slider display
  function updateSliderDisplay() {
    const value = parseFloat(speedSlider.value);
    sliderValueEl.textContent = value.toFixed(2) + 'x';
  }

  // Get current speed from content script
  function getCurrentSpeed() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'getSpeed' }, (response) => {
          if (chrome.runtime.lastError) {
            showStatus('Waiting for video...', 'error');
            return;
          }
          if (response && response.speed) {
            currentSpeedEl.textContent = response.speed.toFixed(2) + 'x';
            speedSlider.value = response.speed;
            updateSliderDisplay();
          } else {
            currentSpeedEl.textContent = 'N/A';
            showStatus('No video detected', 'error');
          }
        });
      }
    });
  }

  // Set playback speed
  function setSpeed(speed) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { 
          action: 'setSpeed', 
          speed: parseFloat(speed) 
        }, (response) => {
          if (response && response.success) {
            currentSpeedEl.textContent = parseFloat(speed).toFixed(2) + 'x';
            showStatus('Speed set to ' + parseFloat(speed).toFixed(2) + 'x', 'success');
            
            // Update slider if speed was set via preset or custom input
            speedSlider.value = speed;
            updateSliderDisplay();
          } else {
            showStatus('Failed to set speed', 'error');
          }
        });
      }
    });
  }

  // Show status message
  function showStatus(message, type = '') {
    statusEl.textContent = message;
    statusEl.className = 'status ' + type;
    setTimeout(() => {
      statusEl.className = 'status';
      statusEl.textContent = 'Ready';
    }, 2000);
  }

  // Slider change handler
  speedSlider.addEventListener('input', () => {
    updateSliderDisplay();
  });

  speedSlider.addEventListener('change', () => {
    setSpeed(speedSlider.value);
  });

  // Preset button handlers
  presetButtons.forEach(button => {
    button.addEventListener('click', () => {
      const speed = button.dataset.speed;
      setSpeed(speed);
    });
  });


  // Keyboard shortcuts in popup
  document.addEventListener('keydown', (e) => {
    if (e.key >= '1' && e.key <= '9') {
      const speed = parseInt(e.key);
      if (speed <= 5) {
        setSpeed(speed);
      }
    }
  });
})();