"use strict";
(function () {
    'use strict';
    function formatSpeed(s) {
        return `${Math.round(s * 100) / 100}x`;
    }
    function etaMainPart(seconds) {
        if (seconds < 60)
            return '<1 min left';
        if (seconds < 3600)
            return `${Math.floor(seconds / 60)} min left`;
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return `${h}h ${m}m left`;
    }
    function renderEtaInto(el, seconds, kind, speed) {
        el.textContent = ''; // clear prior children
        if (seconds === null)
            return;
        if (kind !== 'finite')
            return;
        if (!Number.isFinite(seconds) || seconds <= 0)
            return;
        el.appendChild(document.createTextNode(`${etaMainPart(seconds)} @ `));
        const strong = document.createElement('strong');
        strong.style.fontWeight = '700';
        strong.textContent = formatSpeed(speed);
        el.appendChild(strong);
        if (speed > 1) {
            el.appendChild(document.createTextNode(' ⚡'));
        }
    }
    let targetSpeed = 1.0;
    let enforceSpeed = false;
    let speedOverlay = null;
    let overlayTimeout = null;
    let shortcutsEnabled = true;
    let linkedinIconUrl = null;
    let hideSlowSpeeds = false;
    const ETA_DATA_ATTR = 'data-eta-display';
    let etaSpan = null;
    let etaTickHandle;
    function classifyDuration(d) {
        if (Number.isNaN(d))
            return 'unknown';
        if (!Number.isFinite(d))
            return 'live';
        return 'finite';
    }
    function injectEtaSpan() {
        const anchor = document.getElementById('player-controls');
        if (!anchor)
            return; // silent absence (PRD/F1-5)
        if (anchor.parentElement?.querySelector(`[${ETA_DATA_ATTR}]`))
            return;
        const span = document.createElement('span');
        span.setAttribute(ETA_DATA_ATTR, 'true');
        span.setAttribute('aria-hidden', 'true');
        // Copy the timestamp's computed font so the eta matches family/size/weight
        // and shares the same line-box height for clean vertical centering against
        // #player-controls in the parent flex row.
        const anchorStyle = window.getComputedStyle(anchor);
        span.style.cssText = `
      display: inline-flex;
      align-items: center;
      align-self: center;
      margin-left: 12px;
      font-family: ${anchorStyle.fontFamily};
      font-size: ${anchorStyle.fontSize};
      font-weight: ${anchorStyle.fontWeight};
      line-height: ${anchorStyle.lineHeight};
      color: #4CAF50;
      user-select: none;
    `;
        anchor.insertAdjacentElement('afterend', span);
        etaSpan = span;
    }
    function updateEtaSpan() {
        if (!etaSpan)
            return;
        const video = document.querySelector('video');
        if (!video) {
            etaSpan.textContent = '';
            return;
        }
        const kind = classifyDuration(video.duration);
        if (kind !== 'finite') {
            renderEtaInto(etaSpan, null, kind, video.playbackRate); // PRD/F4-1, F4-2
            return;
        }
        if (video.currentTime >= video.duration) {
            renderEtaInto(etaSpan, null, 'finite', video.playbackRate); // PRD/F4-3 (ended)
            return;
        }
        const remaining = (video.duration - video.currentTime) / video.playbackRate;
        renderEtaInto(etaSpan, remaining, 'finite', video.playbackRate);
    }
    function startEtaTicker() {
        if (etaTickHandle !== undefined)
            return;
        etaTickHandle = setInterval(() => {
            if (!etaSpan || !etaSpan.isConnected) {
                etaSpan = null;
                injectEtaSpan();
            }
            updateEtaSpan();
        }, 1000);
    }
    function applySlowSpeedFilter() {
        const items = document.querySelectorAll('#playback-speed-menu li[data-custom-speed]');
        items.forEach(item => {
            const speed = parseFloat(item.getAttribute('data-custom-speed') || '0');
            item.style.display = (hideSlowSpeeds && speed < 1) ? 'none' : '';
        });
    }
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
            const speedText = speed > 2 ? `${speed.toFixed(2)}x ⚡` : `${speed.toFixed(2)}x`;
            speedSpan.textContent = speedText;
            if (speed > 2) {
                speedSpan.style.color = '#4CAF50';
                speedSpan.setAttribute('title', 'Speed above Echo360 native cap');
            }
            else {
                // S1: clear our override so Echo360's default styling shows through.
                speedSpan.style.color = '';
                speedSpan.removeAttribute('title');
            }
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
        // Header-subtitle keyboard hint (non-interactive, presentation-only)
        const hintItem = document.createElement('li');
        hintItem.setAttribute('role', 'presentation');
        hintItem.setAttribute('data-custom-hint', 'true');
        hintItem.setAttribute('aria-hidden', 'true');
        hintItem.style.cssText = `
      padding: 6px 16px 8px;
      font-size: 11px;
      color: rgba(255, 255, 255, 0.55);
      pointer-events: none;
      cursor: default;
      border-bottom: 1px solid rgba(128, 128, 128, 0.25);
      margin-bottom: 4px;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 4px;
    `;
        const KEY_CSS = `
      display: inline-block;
      padding: 1px 5px;
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 10px;
      background: rgba(255, 255, 255, 0.14);
      border: 1px solid rgba(255, 255, 255, 0.55);
      border-radius: 3px;
      line-height: 1.3;
      vertical-align: middle;
      color: rgba(255, 255, 255, 0.9);
    `;
        const makeKey = (text) => {
            const el = document.createElement('span');
            el.textContent = text;
            el.style.cssText = KEY_CSS;
            return el;
        };
        const makeRow = (emoji, secondKey) => {
            const row = document.createElement('div');
            row.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        padding-left: 8px;
      `;
            row.appendChild(document.createTextNode(emoji));
            row.appendChild(makeKey('Shift'));
            row.appendChild(document.createTextNode('+'));
            row.appendChild(makeKey(secondKey));
            return row;
        };
        const hintLabel = document.createElement('div');
        hintLabel.textContent = 'Shortcuts';
        hintLabel.style.fontWeight = '600';
        hintItem.appendChild(hintLabel);
        hintItem.appendChild(makeRow('🐌', '<'));
        hintItem.appendChild(makeRow('⚡', '>'));
        menu.appendChild(hintItem);
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
            // C2: announce >2x speeds explicitly to AT and as tooltip
            if (speed > 2) {
                newOption.setAttribute('aria-label', `${speed}x — above Echo360's native cap`);
                newOption.setAttribute('title', 'Speed above Echo360 native cap');
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
        // Apply the current filter (covers first-render with stored preference)
        applySlowSpeedFilter();
        // Hide-slow-speeds toggle row
        const toggleItem = document.createElement('li');
        toggleItem.setAttribute('role', 'presentation');
        toggleItem.setAttribute('data-custom-toggle', 'hide-slow-speeds');
        toggleItem.style.cssText = `
      padding: 8px 16px;
      list-style: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      color: rgba(255, 255, 255, 0.85);
      font-size: 11px;
      border-top: 1px solid rgba(128, 128, 128, 0.25);
      margin-top: 4px;
      cursor: pointer;
      user-select: none;
    `;
        const toggleLabel = document.createElement('span');
        toggleLabel.textContent = 'Hide slow speeds';
        const toggleSwitch = document.createElement('span');
        toggleSwitch.setAttribute('role', 'switch');
        toggleSwitch.setAttribute('aria-checked', hideSlowSpeeds ? 'true' : 'false');
        toggleSwitch.style.cssText = `
      position: relative;
      width: 32px;
      height: 18px;
      background: ${hideSlowSpeeds ? '#4CAF50' : '#8C0047'};
      border-radius: 18px;
      transition: background-color 0.2s;
      flex-shrink: 0;
    `;
        const toggleKnob = document.createElement('span');
        toggleKnob.style.cssText = `
      position: absolute;
      width: 14px;
      height: 14px;
      background: white;
      border-radius: 50%;
      top: 2px;
      left: 2px;
      transition: transform 0.2s;
      transform: translateX(${hideSlowSpeeds ? '14px' : '0'});
    `;
        toggleSwitch.appendChild(toggleKnob);
        toggleItem.appendChild(toggleLabel);
        toggleItem.appendChild(toggleSwitch);
        toggleItem.addEventListener('click', (e) => {
            e.stopPropagation();
            hideSlowSpeeds = !hideSlowSpeeds;
            toggleSwitch.setAttribute('aria-checked', hideSlowSpeeds ? 'true' : 'false');
            toggleSwitch.style.background = hideSlowSpeeds ? '#4CAF50' : '#8C0047';
            toggleKnob.style.transform = `translateX(${hideSlowSpeeds ? '14px' : '0'})`;
            applySlowSpeedFilter();
            window.postMessage({
                type: 'HIDE_SLOW_SPEEDS_CHANGED',
                hideSlowSpeeds
            }, '*');
        });
        menu.appendChild(toggleItem);
        // Footer CTA: accent-pill report link
        const ctaItem = document.createElement('li');
        ctaItem.setAttribute('role', 'presentation');
        ctaItem.setAttribute('data-custom-cta', 'true');
        ctaItem.style.cssText = `
      padding: 10px 16px 12px;
      list-style: none;
      display: flex;
      justify-content: center;
    `;
        const ctaLink = document.createElement('a');
        ctaLink.href = 'https://www.linkedin.com/in/wei-chong/';
        ctaLink.target = '_blank';
        ctaLink.rel = 'noopener noreferrer';
        ctaLink.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      background: rgba(76, 175, 80, 0.12);
      border: 1px solid #4CAF50;
      border-radius: 16px;
      color: #4CAF50;
      text-decoration: none;
      font-size: 11px;
      font-weight: 600;
      transition: background-color 0.15s;
      outline: none;
    `;
        ctaLink.addEventListener('mouseenter', () => { ctaLink.style.background = 'rgba(76, 175, 80, 0.22)'; });
        ctaLink.addEventListener('mouseleave', () => { ctaLink.style.background = 'rgba(76, 175, 80, 0.12)'; });
        const ctaText = document.createElement('span');
        ctaText.textContent = 'Request feature / report bug';
        ctaLink.appendChild(ctaText);
        if (linkedinIconUrl) {
            const ctaIcon = document.createElement('img');
            ctaIcon.src = linkedinIconUrl;
            ctaIcon.alt = '';
            ctaIcon.width = 14;
            ctaIcon.height = 14;
            ctaIcon.style.display = 'block';
            ctaLink.appendChild(ctaIcon);
        }
        ctaItem.appendChild(ctaLink);
        menu.appendChild(ctaItem);
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
    const menuRefresher = setInterval(() => {
        if (document.querySelector('#playback-speed-menu')) {
            addCustomSpeedOptions();
        }
        // Ensure speed button span stays green (fallback) — only at >2x
        const speedButton = document.querySelector('[data-testid="playback-speed-button"]');
        if (speedButton) {
            const spans = speedButton.querySelectorAll('span');
            const speedSpan = spans[1];
            if (speedSpan) {
                if (targetSpeed > 2) {
                    if (!speedSpan.style.color) {
                        speedSpan.style.color = '#4CAF50';
                    }
                }
                else {
                    // S1-4: don't let the fallback loop re-green at ≤2x.
                    if (speedSpan.style.color === 'rgb(76, 175, 80)' || speedSpan.style.color === '#4CAF50') {
                        speedSpan.style.color = '';
                    }
                }
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
    let speedMonitor = null;
    function monitorSpeedChanges() {
        let lastSpeed = 1.0;
        speedMonitor = setInterval(() => {
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
    window.addEventListener('beforeunload', () => {
        clearInterval(menuRefresher);
        if (speedMonitor)
            clearInterval(speedMonitor);
        menuObserver.disconnect();
        if (etaTickHandle !== undefined) {
            clearInterval(etaTickHandle);
            etaTickHandle = undefined;
        }
    });
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
            const rawDuration = video ? video.duration : NaN;
            const rawCurrentTime = video ? video.currentTime : 0;
            console.log(`[Echo360 Speed Control] Message received GET_ECHO_SPEED: responding with ${currentSpeed.toFixed(2)}x`);
            window.postMessage({
                type: 'CURRENT_ECHO_SPEED',
                speed: currentSpeed,
                duration: rawDuration,
                currentTime: rawCurrentTime
            }, '*');
        }
        else if (event.data.type === 'SET_SHORTCUTS_ENABLED') {
            console.log(`[Echo360 Speed Control] Message received SET_SHORTCUTS_ENABLED: ${event.data.enabled}`);
            shortcutsEnabled = event.data.enabled;
        }
        else if (event.data.type === 'SET_ASSET_URLS') {
            if (typeof event.data.linkedinIcon === 'string') {
                linkedinIconUrl = event.data.linkedinIcon;
            }
        }
        else if (event.data.type === 'SET_HIDE_SLOW_SPEEDS') {
            hideSlowSpeeds = event.data.hideSlowSpeeds === true;
            applySlowSpeedFilter();
        }
    });
    injectEtaSpan();
    startEtaTicker();
    console.log('[Echo360 Speed Control] Extension injected and initialized (injector-simple.js)');
})();
