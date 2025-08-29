// Simple, direct override for Echo360 speed control
(function() {
  'use strict';

  
  let targetSpeed = 1.0;
  let enforceSpeed = false;

  // Override the playbackRate property at the prototype level
  const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
  
  Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
    get: function() {
      const actualSpeed = originalDescriptor.get.call(this);
      // If we're enforcing and this is a video, return our target
      if (enforceSpeed && this.tagName === 'VIDEO') {
        return targetSpeed;
      }
      return actualSpeed;
    },
    set: function(value) {
      // If we're enforcing a custom speed and something tries to reset it
      if (enforceSpeed && this.tagName === 'VIDEO' && targetSpeed > 2) {
        // Only allow the change if it's to our target speed or higher than 2
        if (value === targetSpeed || value > 2) {
          originalDescriptor.set.call(this, value);
          if (value > 2) {
            targetSpeed = value;
          }
        } else {
          // Silently maintain our speed
          originalDescriptor.set.call(this, targetSpeed);
        }
      } else {
        // Normal operation
        originalDescriptor.set.call(this, value);
      }
    },
    configurable: true
  });

  // Simple speed setter
  window.setSpeed = function(speed) {
    targetSpeed = speed;
    enforceSpeed = true;
    
    // Apply to all current videos
    document.querySelectorAll('video').forEach(video => {
      originalDescriptor.set.call(video, speed);
    });
    
    // Keep it enforced for a while
    let count = 0;
    const enforcer = setInterval(() => {
      document.querySelectorAll('video').forEach(video => {
        const current = originalDescriptor.get.call(video);
        if (current !== speed) {
          originalDescriptor.set.call(video, speed);
        }
      });
      count++;
      if (count > 20) clearInterval(enforcer);
    }, 250);
    
    return `Speed set to ${speed}x`;
  };

  // Stop enforcement
  window.resetSpeed = function() {
    enforceSpeed = false;
    targetSpeed = 1.0;
    return 'Speed control released';
  };

  // Function to replace all speed options with custom ones
  function addCustomSpeedOptions() {
    const menu = document.querySelector('#playback-speed-menu ul[role="menu"]');
    if (!menu) {
      return;
    }
    
    // Check if we already replaced options
    if (menu.querySelector('[data-custom-speed]')) {
      return;
    }
    
    
    // Clear the entire menu
    menu.innerHTML = '';
    
    // Get current video speed to mark as selected
    const video = document.querySelector('video');
    const currentSpeed = video ? video.playbackRate : 1;
    
    // All speeds we want (from fastest to slowest)
    const allSpeeds = [3, 2.75, 2.5, 2.25, 2, 1.75, 1.5, 1.25, 1, 0.75, 0.5, 0.25];
    
    allSpeeds.forEach(speed => {
      // Create new option
      const newOption = document.createElement('li');
      newOption.setAttribute('role', 'menuitemradio');
      newOption.setAttribute('tabindex', '-1');
      newOption.setAttribute('data-test-component', 'SettingsRadioOption');
      newOption.setAttribute('class', 'sc-hQrNYi ilDWTJ');
      newOption.setAttribute('data-custom-speed', speed);
      newOption.setAttribute('aria-checked', Math.abs(speed - currentSpeed) < 0.01 ? 'true' : 'false');
      
      // Add checkmark SVG
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('role', 'img');
      svg.setAttribute('class', `sc-bZQynM lnqVmQ sc-hHRaiR ${Math.abs(speed - currentSpeed) < 0.01 ? 'ilbfGM' : 'kzXfpL'}`);
      svg.setAttribute('data-test-component', 'Icon');
      svg.setAttribute('data-test-name', 'check');
      svg.setAttribute('aria-label', 'check');
      svg.setAttribute('viewBox', '0 0 448 512');
      
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = 'check';
      svg.appendChild(title);
      
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'can-be-filled');
      path.setAttribute('d', 'M440.1 103C450.3 112.4 450.3 127.6 440.1 136.1L176.1 400.1C167.6 410.3 152.4 410.3 143 400.1L7.029 264.1C-2.343 255.6-2.343 240.4 7.029 231C16.4 221.7 31.6 221.7 40.97 231L160 350.1L407 103C416.4 93.66 431.6 93.66 440.1 103V103z');
      svg.appendChild(path);
      
      newOption.appendChild(svg);
      
      // Add speed text with lightning for speeds > 2
      const speedText = speed > 2 ? `${speed}x ⚡` : `${speed}x`;
      const textNode = document.createTextNode(speedText);
      newOption.appendChild(textNode);
      
      // Add click handler
      newOption.addEventListener('click', function(e) {
        e.stopPropagation();
        
        // Set the speed
        window.setSpeed(speed);
        
        // Update UI - uncheck all options
        menu.querySelectorAll('li').forEach(li => {
          li.setAttribute('aria-checked', 'false');
          const svg = li.querySelector('svg');
          if (svg) {
            svg.classList.remove('ilbfGM');
            svg.classList.add('kzXfpL');
          }
        });
        
        // Check this option
        this.setAttribute('aria-checked', 'true');
        const svg = this.querySelector('svg');
        if (svg) {
          svg.classList.remove('kzXfpL');
          svg.classList.add('ilbfGM');
        }
        
        // Update the button text with green color
        const speedButton = document.querySelector('.sc-bRyDhe.bwEIwI');
        if (speedButton) {
          speedButton.style.color = '#4CAF50';
          if (speed > 2) {
            speedButton.innerHTML = `${speed}x <span style="position: absolute; bottom: 2px; right: 2px; font-size: 0.7em;">⚡</span>`;
            speedButton.style.position = 'relative';
          } else {
            speedButton.textContent = `${speed}x`;
            speedButton.style.position = '';
          }
        }
        
        // Close the menu
        setTimeout(() => {
          const menu = document.querySelector('#playback-speed-menu');
          if (menu) {
            menu.style.display = 'none';
            // Trigger any close handlers
            menu.dispatchEvent(new Event('mouseleave'));
          }
        }, 100);
      });
      
      // Append to menu
      menu.appendChild(newOption);
    });
    
  }
  
  // Watch for the menu to appear
  const menuObserver = new MutationObserver((mutations) => {
    // Check if playback speed menu exists
    if (document.querySelector('#playback-speed-menu')) {
      addCustomSpeedOptions();
    }
  });
  
  // Wait for document.body to exist before observing
  function startObserving() {
    if (document.body) {
      menuObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class']
      });
    } else {
      // Try again in 100ms if body doesn't exist yet
      setTimeout(startObserving, 100);
    }
  }
  
  startObserving();
  
  // Also check periodically in case menu is already there
  setInterval(() => {
    if (document.querySelector('#playback-speed-menu')) {
      addCustomSpeedOptions();
    }
    
    // Make speed button green
    const speedButton = document.querySelector('.sc-bRyDhe.bwEIwI');
    if (speedButton && !speedButton.style.color) {
      speedButton.style.color = '#4CAF50';
    }
  }, 1000);

  // Listen for messages from content script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    
    if (event.data.type === 'SET_ECHO_SPEED') {
      window.setSpeed(event.data.speed);
    } else if (event.data.type === 'GET_ECHO_SPEED') {
      const video = document.querySelector('video');
      const currentSpeed = video ? video.playbackRate : 1;
      window.postMessage({ 
        type: 'CURRENT_ECHO_SPEED', 
        speed: currentSpeed 
      }, '*');
    }
  });

})();