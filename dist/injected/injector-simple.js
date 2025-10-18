"use strict";
(function () {
    'use strict';
    let targetSpeed = 1.0;
    let enforceSpeed = false;
    let speedOverlay = null;
    let overlayTimeout = null;
    let shortcutsEnabled = true;
    const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
    Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
        get: function () {
            const actualSpeed = originalDescriptor.get.call(this);
            if (enforceSpeed && this.tagName === 'VIDEO') {
                return targetSpeed;
            }
            return actualSpeed;
        },
        set: function (value) {
            if (enforceSpeed && this.tagName === 'VIDEO' && targetSpeed > 2) {
                if (value === targetSpeed || value > 2) {
                    originalDescriptor.set.call(this, value);
                    if (value > 2) {
                        console.log(`[Echo360 Speed Control] Property descriptor: accepting speed ${value.toFixed(2)}x (target was ${targetSpeed.toFixed(2)}x)`);
                        targetSpeed = value;
                    }
                }
                else {
                    console.log(`[Echo360 Speed Control] Property descriptor: Echo360 attempted to set ${value.toFixed(2)}x, enforcing ${targetSpeed.toFixed(2)}x instead`);
                    originalDescriptor.set.call(this, targetSpeed);
                }
            }
            else {
                originalDescriptor.set.call(this, value);
            }
        },
        configurable: true
    });
    function createOverlayElement() {
        if (!document.body) {
            console.warn('[Echo360 Speed Control] document.body not ready, cannot create overlay yet');
            return null;
        }
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
    function showSpeedOverlay(speed, retryCount = 0) {
        if (!speedOverlay) {
            speedOverlay = createOverlayElement();
            if (!speedOverlay) {
                // Body not ready, retry with exponential backoff (max 5 retries)
                if (retryCount < 5) {
                    const delay = 100 * Math.pow(2, retryCount);
                    setTimeout(() => showSpeedOverlay(speed, retryCount + 1), delay);
                    return;
                }
                console.error('[Echo360 Speed Control] Could not create overlay after retries, document.body still not available');
                return;
            }
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
    function updateSpeedButton(speed, retryCount = 0) {
        // Use stable data-testid selector instead of minified classes
        const speedButton = document.querySelector('[data-testid="playback-speed-button"]');
        if (!speedButton) {
            // Retry with exponential backoff (max 5 retries: 100ms, 200ms, 400ms, 800ms, 1600ms)
            if (retryCount < 5) {
                const delay = 100 * Math.pow(2, retryCount);
                setTimeout(() => updateSpeedButton(speed, retryCount + 1), delay);
                return;
            }
            console.warn('[Echo360 Speed Control] Speed button not found after retries. Echo360 may have changed their button structure.');
            return;
        }
        // Find the speed display span (second span child)
        const spans = speedButton.querySelectorAll('span');
        const speedSpan = spans[1]; // Second span contains the speed value
        if (speedSpan) {
            speedSpan.style.color = '#4CAF50';
            const speedText = speed > 2 ? `${speed.toFixed(2)}x ⚡` : `${speed.toFixed(2)}x`;
            speedSpan.textContent = speedText;
        }
    }
    window.setSpeed = function (speed) {
        console.log(`[Echo360 Speed Control] setSpeed called: ${speed.toFixed(2)}x (previous target: ${targetSpeed.toFixed(2)}x)`);
        targetSpeed = speed;
        enforceSpeed = true;
        showSpeedOverlay(speed);
        updateSpeedButton(speed);
        const videos = document.querySelectorAll('video');
        console.log(`[Echo360 Speed Control] Found ${videos.length} video element(s) to update`);
        videos.forEach((video, index) => {
            const currentSpeed = originalDescriptor.get.call(video);
            console.log(`[Echo360 Speed Control] Video ${index}: current speed ${currentSpeed.toFixed(2)}x → setting to ${speed.toFixed(2)}x`);
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
                    console.log(`[Echo360 Speed Control] Speed drift detected: ${current.toFixed(2)}x → re-enforcing ${speed.toFixed(2)}x`);
                    originalDescriptor.set.call(video, speed);
                }
            });
            count++;
            if (count > 20)
                clearInterval(enforcer);
        }, 250);
        console.log(`[Echo360 Speed Control] Speed successfully set to ${speed.toFixed(2)}x`);
        return `Speed set to ${speed}x`;
    };
    window.resetSpeed = function () {
        enforceSpeed = false;
        targetSpeed = 1.0;
        return 'Speed control released';
    };
    function addCustomSpeedOptions(retryCount = 0) {
        const menu = document.querySelector('#playback-speed-menu ul[role="menu"]');
        if (!menu) {
            // Menu element not found - this is normal if called before menu is opened
            return;
        }
        if (menu.querySelector('[data-custom-speed]')) {
            // Custom options already added
            return;
        }
        // Clone an existing menu item to inherit all Echo360 styles
        const templateItem = menu.querySelector('li[role="menuitemradio"]');
        if (!templateItem) {
            // Retry with exponential backoff (max 3 retries: 50ms, 100ms, 200ms)
            if (retryCount < 3) {
                const delay = 50 * Math.pow(2, retryCount);
                setTimeout(() => addCustomSpeedOptions(retryCount + 1), delay);
                return;
            }
            console.error('[Echo360 Speed Control] No template menu item found to clone after retries. Echo360 may have changed their menu structure.');
            return;
        }
        const video = document.querySelector('video');
        const currentSpeed = video ? video.playbackRate : 1;
        console.log(`[Echo360 Speed Control] Cloning menu items from template. Current speed: ${currentSpeed.toFixed(2)}x`);
        // Clear existing menu
        menu.innerHTML = '';
        const allSpeeds = [4, 3.75, 3.5, 3.25, 3, 2.75, 2.5, 2.25, 2, 1.75, 1.5, 1.25, 1, 0.75, 0.5, 0.25];
        allSpeeds.forEach(speed => {
            // Clone the template item to inherit all styles automatically
            const newOption = templateItem.cloneNode(true);
            // Mark as custom speed
            newOption.setAttribute('data-custom-speed', speed.toString());
            // Set checked state
            const isChecked = Math.abs(speed - currentSpeed) < 0.01;
            newOption.setAttribute('aria-checked', isChecked ? 'true' : 'false');
            // Update SVG checkmark visibility using inline styles (class-agnostic)
            const svg = newOption.querySelector('svg');
            if (svg) {
                svg.style.visibility = isChecked ? 'visible' : 'hidden';
            }
            // Update text content
            const speedText = speed > 2 ? `${speed}x ⚡` : `${speed}x`;
            // Find and replace the text node (last child is typically the text)
            const textNode = Array.from(newOption.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
            if (textNode) {
                textNode.textContent = speedText;
            }
            else {
                // Fallback: append new text node
                newOption.appendChild(document.createTextNode(speedText));
            }
            newOption.addEventListener('click', function (e) {
                e.stopPropagation();
                console.log(`[Echo360 Speed Control] Menu item clicked: ${speed.toFixed(2)}x`);
                window.setSpeed(speed);
                window.postMessage({
                    type: 'SPEED_CHANGED',
                    speed: speed
                }, '*');
                // Update all menu items' checked state
                menu.querySelectorAll('li').forEach(li => {
                    li.setAttribute('aria-checked', 'false');
                    const svg = li.querySelector('svg');
                    if (svg) {
                        svg.style.visibility = 'hidden';
                    }
                });
                // Mark this item as checked
                this.setAttribute('aria-checked', 'true');
                const svg = this.querySelector('svg');
                if (svg) {
                    svg.style.visibility = 'visible';
                }
                // Update speed button display
                updateSpeedButton(speed);
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
        }
        else {
            setTimeout(startObserving, 100);
        }
    }
    startObserving();
    setInterval(() => {
        if (document.querySelector('#playback-speed-menu')) {
            addCustomSpeedOptions();
        }
        // Ensure speed button span stays green (fallback)
        const speedButton = document.querySelector('[data-testid="playback-speed-button"]');
        if (speedButton) {
            const spans = speedButton.querySelectorAll('span');
            const speedSpan = spans[1];
            if (speedSpan && !speedSpan.style.color) {
                speedSpan.style.color = '#4CAF50';
            }
        }
    }, 1000);
    function handleKeyboardShortcuts(event) {
        if (!shortcutsEnabled)
            return;
        if (event.shiftKey && (event.key === '<' || event.key === ',')) {
            event.preventDefault();
            const video = document.querySelector('video');
            if (video) {
                const currentSpeed = video.playbackRate;
                const newSpeed = Math.max(0.25, currentSpeed - 0.25);
                console.log(`[Echo360 Speed Control] Keyboard shortcut (decrease): ${currentSpeed.toFixed(2)}x → ${newSpeed.toFixed(2)}x`);
                window.setSpeed(newSpeed);
            }
        }
        else if (event.shiftKey && (event.key === '>' || event.key === '.')) {
            event.preventDefault();
            const video = document.querySelector('video');
            if (video) {
                const currentSpeed = video.playbackRate;
                const newSpeed = Math.min(4, currentSpeed + 0.25);
                console.log(`[Echo360 Speed Control] Keyboard shortcut (increase): ${currentSpeed.toFixed(2)}x → ${newSpeed.toFixed(2)}x`);
                window.setSpeed(newSpeed);
            }
        }
    }
    document.addEventListener('keydown', handleKeyboardShortcuts);
    function monitorSpeedChanges() {
        let lastSpeed = 1.0;
        setInterval(() => {
            const video = document.querySelector('video');
            if (video) {
                const currentSpeed = video.playbackRate;
                if (Math.abs(currentSpeed - lastSpeed) > 0.01) {
                    console.log(`[Echo360 Speed Control] Speed change detected (monitor): ${lastSpeed.toFixed(2)}x → ${currentSpeed.toFixed(2)}x`);
                    lastSpeed = currentSpeed;
                    targetSpeed = currentSpeed;
                    updateSpeedButton(currentSpeed);
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
        if (event.source !== window)
            return;
        if (event.data.type === 'SET_ECHO_SPEED') {
            console.log(`[Echo360 Speed Control] Message received SET_ECHO_SPEED: ${event.data.speed?.toFixed(2)}x`);
            window.setSpeed(event.data.speed);
        }
        else if (event.data.type === 'GET_ECHO_SPEED') {
            const video = document.querySelector('video');
            const currentSpeed = video ? video.playbackRate : 1;
            console.log(`[Echo360 Speed Control] Message received GET_ECHO_SPEED: responding with ${currentSpeed.toFixed(2)}x`);
            window.postMessage({
                type: 'CURRENT_ECHO_SPEED',
                speed: currentSpeed
            }, '*');
        }
        else if (event.data.type === 'SET_SHORTCUTS_ENABLED') {
            console.log(`[Echo360 Speed Control] Message received SET_SHORTCUTS_ENABLED: ${event.data.enabled}`);
            shortcutsEnabled = event.data.enabled;
        }
    });
    console.log('[Echo360 Speed Control] Extension injected and initialized (injector-simple.js)');
})();
