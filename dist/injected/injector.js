"use strict";
(function () {
    'use strict';
    let targetSpeed = 1.0;
    let videoElements = new WeakSet();
    let speedOverlay = null;
    let overlayTimeout = null;
    let shortcutsEnabled = true;
    const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
    Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
        get: function () {
            return originalDescriptor.get.call(this);
        },
        set: function (value) {
            if (this.tagName === 'VIDEO') {
                if (videoElements.has(this) && value <= 2 && targetSpeed > 2) {
                    return originalDescriptor.set.call(this, targetSpeed);
                }
                if (!videoElements.has(this)) {
                    videoElements.add(this);
                    setupVideoElement(this);
                }
            }
            return originalDescriptor.set.call(this, value);
        },
        configurable: true
    });
    function setupVideoElement(video) {
        const clonedVideo = video.cloneNode(true);
        video.parentNode.replaceChild(clonedVideo, video);
        const originalAddEventListener = clonedVideo.addEventListener;
        clonedVideo.addEventListener = function (type, listener, options) {
            if (type === 'ratechange') {
                return;
            }
            return originalAddEventListener.call(this, type, listener, options);
        };
    }
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
        const speedButtons = document.querySelectorAll('.playback-rate-button, .speed-button, [aria-label*="speed"], [aria-label*="Speed"]');
        speedButtons.forEach(button => {
            if (button.textContent?.includes('x')) {
                button.textContent = `${speed.toFixed(2)}x`;
                button.style.color = '#4CAF50';
            }
        });
    }
    function forceSetSpeed(speed) {
        targetSpeed = speed;
        showSpeedOverlay(speed);
        updateSpeedButton(speed);
        // Notify content script about speed change
        window.postMessage({
            type: 'SPEED_CHANGED',
            speed: speed
        }, '*');
        const videos = document.querySelectorAll('video, video.leader, video.sc-bUyWVT, video[data-test="leader"], video[role="region"]');
        if (videos.length === 0) {
            setTimeout(() => forceSetSpeed(speed), 1000);
            return;
        }
        videos.forEach(video => {
            videoElements.add(video);
            if (video.playbackRate !== speed) {
                try {
                    video.playbackRate = speed;
                }
                catch (e) {
                    // Silent fail
                }
                try {
                    originalDescriptor.set.call(video, speed);
                }
                catch (e) {
                    // Silent fail
                }
                try {
                    Object.defineProperty(video, 'playbackRate', {
                        value: speed,
                        writable: true,
                        configurable: true
                    });
                }
                catch (e) {
                    // Silent fail
                }
            }
            setTimeout(() => {
                if (video.playbackRate !== speed) {
                    originalDescriptor.set.call(video, speed);
                }
            }, 100);
        });
    }
    window.addEventListener('message', (event) => {
        if (event.source !== window)
            return;
        if (event.data.type === 'SET_PLAYBACK_SPEED') {
            forceSetSpeed(event.data.speed);
        }
        else if (event.data.type === 'GET_PLAYBACK_SPEED') {
            const video = document.querySelector('video');
            window.postMessage({
                type: 'CURRENT_SPEED',
                speed: video ? video.playbackRate : 1.0
            }, '*');
        }
        else if (event.data.type === 'SET_SHORTCUTS_ENABLED') {
            shortcutsEnabled = event.data.enabled;
        }
    });
    setInterval(() => {
        const videos = document.querySelectorAll('video, video.leader, video.sc-bUyWVT, video[data-test="leader"], video[role="region"]');
        videos.forEach(video => {
            if (targetSpeed !== 1.0 && video.playbackRate !== targetSpeed) {
                try {
                    originalDescriptor.set.call(video, targetSpeed);
                }
                catch (e) {
                    video.playbackRate = targetSpeed;
                }
                videoElements.add(video);
            }
        });
    }, 500);
    if (window.Math) {
        const originalMin = Math.min;
        Math.min = function (...args) {
            if (args.length === 2 && (args[1] === 2 || args[1] === 2.0)) {
                const stack = new Error().stack;
                if (stack && stack.includes('playback')) {
                    return args[0];
                }
            }
            return originalMin.apply(this, args);
        };
        const originalMax = Math.max;
        Math.max = function (...args) {
            if (args.length === 2 && (args[1] === 0.25 || args[1] === 0.5)) {
                const stack = new Error().stack;
                if (stack && stack.includes('playback')) {
                    return args[0];
                }
            }
            return originalMax.apply(this, args);
        };
    }
    function handleKeyboardShortcuts(event) {
        if (!shortcutsEnabled)
            return;
        if (event.shiftKey && (event.key === '<' || event.key === ',')) {
            event.preventDefault();
            const video = document.querySelector('video');
            if (video) {
                const currentSpeed = video.playbackRate;
                const newSpeed = Math.max(0.25, currentSpeed - 0.25);
                forceSetSpeed(newSpeed);
            }
        }
        else if (event.shiftKey && (event.key === '>' || event.key === '.')) {
            event.preventDefault();
            const video = document.querySelector('video');
            if (video) {
                const currentSpeed = video.playbackRate;
                const newSpeed = Math.min(5, currentSpeed + 0.25);
                forceSetSpeed(newSpeed);
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
    window.setEchoSpeed = function (speed) {
        forceSetSpeed(speed);
        return 'Speed set to ' + speed;
    };
    function waitForVideo() {
        const checkForVideo = setInterval(() => {
            const videos = document.querySelectorAll('video');
            if (videos.length > 0) {
                videos.forEach(video => {
                    const wrapper = video.closest('[data-test-component="VideoWrapper"]');
                    if (wrapper || video.src.includes('echo360') || window.location.hostname.includes('echo360')) {
                        videoElements.add(video);
                    }
                });
                clearInterval(checkForVideo);
            }
        }, 1000);
    }
    waitForVideo();
})();
