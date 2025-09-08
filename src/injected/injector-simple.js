(function() {
  'use strict';

  
  let targetSpeed = 1.0;
  let enforceSpeed = false;
  let speedOverlay = null;
  let overlayTimeout = null;
  let shortcutsEnabled = true;

  const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
  
  Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
    get: function() {
      const actualSpeed = originalDescriptor.get.call(this);
      if (enforceSpeed && this.tagName === 'VIDEO') {
        return targetSpeed;
      }
      return actualSpeed;
    },
    set: function(value) {
      if (enforceSpeed && this.tagName === 'VIDEO' && targetSpeed > 2) {
        if (value === targetSpeed || value > 2) {
          originalDescriptor.set.call(this, value);
          if (value > 2) {
            targetSpeed = value;
          }
        } else {
          originalDescriptor.set.call(this, targetSpeed);
        }
      } else {
        originalDescriptor.set.call(this, value);
      }
    },
    configurable: true
  });

  function createOverlayElement() {
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
    document.body.appendChild(overlay);
    return overlay;
  }

  function showSpeedOverlay(speed) {
    if (!speedOverlay) {
      speedOverlay = createOverlayElement();
    }
    
    speedOverlay.textContent = `${speed.toFixed(2)}x`;
    speedOverlay.style.opacity = '1';
    
    if (overlayTimeout) {
      clearTimeout(overlayTimeout);
    }
    
    overlayTimeout = setTimeout(() => {
      if (speedOverlay) {
        speedOverlay.style.opacity = '0';
        setTimeout(() => {
          if (speedOverlay && speedOverlay.style.opacity === '0') {
            speedOverlay.remove();
            speedOverlay = null;
          }
        }, 300);
      }
    }, 2000);
  }

  function updateSpeedButton(speed) {
    // Update the native Echo360 speed button display
    const speedButton = document.querySelector('.sc-bRyDhe.bwEIwI');
    if (speedButton) {
      speedButton.style.color = '#4CAF50';
      speedButton.textContent = `${speed.toFixed(2)}x`;
      speedButton.style.position = '';
    }
  }

  window.setSpeed = function(speed) {
    targetSpeed = speed;
    enforceSpeed = true;
    
    showSpeedOverlay(speed);
    updateSpeedButton(speed);
    
    document.querySelectorAll('video').forEach(video => {
      originalDescriptor.set.call(video, speed);
    });
    
    // Notify content script about speed change
    window.postMessage({ 
      type: 'SPEED_CHANGED', 
      speed: speed 
    }, '*');
    
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

  window.resetSpeed = function() {
    enforceSpeed = false;
    targetSpeed = 1.0;
    return 'Speed control released';
  };

  function addCustomSpeedOptions() {
    const menu = document.querySelector('#playback-speed-menu ul[role="menu"]');
    if (!menu) {
      return;
    }
    
    if (menu.querySelector('[data-custom-speed]')) {
      return;
    }
    
    
    menu.innerHTML = '';
    
    const video = document.querySelector('video');
    const currentSpeed = video ? video.playbackRate : 1;
    
    const allSpeeds = [4, 3.75, 3.5, 3.25, 3, 2.75, 2.5, 2.25, 2, 1.75, 1.5, 1.25, 1, 0.75, 0.5, 0.25];
    
    allSpeeds.forEach(speed => {
      const newOption = document.createElement('li');
      newOption.setAttribute('role', 'menuitemradio');
      newOption.setAttribute('tabindex', '-1');
      newOption.setAttribute('data-test-component', 'SettingsRadioOption');
      newOption.setAttribute('class', 'sc-hQrNYi ilDWTJ');
      newOption.setAttribute('data-custom-speed', speed);
      newOption.setAttribute('aria-checked', Math.abs(speed - currentSpeed) < 0.01 ? 'true' : 'false');
      
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
      
      const speedText = speed > 2 ? `${speed}x ⚡` : `${speed}x`;
      const textNode = document.createTextNode(speedText);
      newOption.appendChild(textNode);
      
      newOption.addEventListener('click', function(e) {
        e.stopPropagation();
        
        window.setSpeed(speed);
        
        // Also broadcast the speed change
        window.postMessage({ 
          type: 'SPEED_CHANGED', 
          speed: speed 
        }, '*');
        
        menu.querySelectorAll('li').forEach(li => {
          li.setAttribute('aria-checked', 'false');
          const svg = li.querySelector('svg');
          if (svg) {
            svg.classList.remove('ilbfGM');
            svg.classList.add('kzXfpL');
          }
        });
        
        this.setAttribute('aria-checked', 'true');
        const svg = this.querySelector('svg');
        if (svg) {
          svg.classList.remove('kzXfpL');
          svg.classList.add('ilbfGM');
        }
        
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
        
        setTimeout(() => {
          const menu = document.querySelector('#playback-speed-menu');
          if (menu) {
            menu.style.display = 'none';
            menu.dispatchEvent(new Event('mouseleave'));
          }
        }, 100);
      });
      
      menu.appendChild(newOption);
    });
    
  }
  
  const menuObserver = new MutationObserver((mutations) => {
    if (document.querySelector('#playback-speed-menu')) {
      addCustomSpeedOptions();
    }
  });
  
  function startObserving() {
    if (document.body) {
      menuObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class']
      });
    } else {
      setTimeout(startObserving, 100);
    }
  }
  
  startObserving();
  
  setInterval(() => {
    if (document.querySelector('#playback-speed-menu')) {
      addCustomSpeedOptions();
    }
    
    const speedButton = document.querySelector('.sc-bRyDhe.bwEIwI');
    if (speedButton && !speedButton.style.color) {
      speedButton.style.color = '#4CAF50';
    }
  }, 1000);

  function handleKeyboardShortcuts(event) {
    if (!shortcutsEnabled) return;
    
    // Shift+< to decrease speed
    if (event.shiftKey && (event.key === '<' || event.key === ',')) {
      event.preventDefault();
      const video = document.querySelector('video');
      if (video) {
        const currentSpeed = video.playbackRate;
        const newSpeed = Math.max(0.25, currentSpeed - 0.25);
        window.setSpeed(newSpeed);
      }
    // Shift+> to increase speed
    } else if (event.shiftKey && (event.key === '>' || event.key === '.')) {
      event.preventDefault();
      const video = document.querySelector('video');
      if (video) {
        const currentSpeed = video.playbackRate;
        const newSpeed = Math.min(4, currentSpeed + 0.25);
        window.setSpeed(newSpeed);
      }
    }
  }

  document.addEventListener('keydown', handleKeyboardShortcuts);

  // Monitor for speed changes from native player controls
  function monitorSpeedChanges() {
    let lastSpeed = 1.0;
    setInterval(() => {
      const video = document.querySelector('video');
      if (video) {
        const currentSpeed = video.playbackRate;
        if (Math.abs(currentSpeed - lastSpeed) > 0.01) {
          lastSpeed = currentSpeed;
          targetSpeed = currentSpeed;
          
          // Update button display
          updateSpeedButton(currentSpeed);
          
          // Broadcast speed change to extension
          window.postMessage({ 
            type: 'SPEED_CHANGED', 
            speed: currentSpeed 
          }, '*');
        }
      }
    }, 500);
  }
  
  monitorSpeedChanges();

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
    } else if (event.data.type === 'SET_SHORTCUTS_ENABLED') {
      shortcutsEnabled = event.data.enabled;
    }
  });

})();