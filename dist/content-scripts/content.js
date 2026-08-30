"use strict";
(function () {
    'use strict';
    // Correlates each GET_ECHO_SPEED round trip with its CURRENT_ECHO_SPEED reply.
    let requestSeq = 0;
    function getDomainKey() {
        return 'speed_echo360';
    }
    const isEcho360 = window.location.hostname.includes('echo360');
    const scriptName = isEcho360 ? 'injected/injector-simple.js' : 'injected/injector.js';
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(scriptName);
    script.onload = function () {
        script.remove();
        const key = getDomainKey();
        chrome.storage.sync.get([key, 'shortcutsEnabled', 'hideSlowSpeeds'], (result) => {
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
            // Send hide-slow-speeds preference (default false)
            window.postMessage({
                type: 'SET_HIDE_SLOW_SPEEDS',
                hideSlowSpeeds: result.hideSlowSpeeds === true
            }, '*');
            // Send icon URLs to injected (ARCH-001: chrome.* lives in content script only)
            const assetUrls = {
                linkedinIcon: chrome.runtime.getURL('assets/icons/linkedin.svg'),
                kofiIcon: chrome.runtime.getURL('assets/images/kofi.png')
            };
            if (!assetUrls.kofiIcon) {
                console.error('[Echo360 Speed Control] chrome.runtime.getURL returned nothing for assets/images/kofi.png. It is probably missing from web_accessible_resources in manifest.json.');
            }
            window.postMessage({
                type: 'SET_ASSET_URLS',
                ...assetUrls
            }, '*');
        });
    };
    script.onerror = function () {
        console.error('[Echo360 Speed Control] Failed to load injected script');
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
        if (event.source !== window)
            return;
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
        else if (event.data.type === 'HIDE_SLOW_SPEEDS_CHANGED') {
            chrome.storage.sync.set({ hideSlowSpeeds: event.data.hideSlowSpeeds === true });
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
        }
        else if (request.action === 'getSpeed') {
            const requestId = `gs_${++requestSeq}`;
            let responded = false;
            const listener = (event) => {
                if (event.source !== window || event.data.type !== 'CURRENT_ECHO_SPEED')
                    return;
                if (event.data.requestId !== requestId)
                    return;
                window.removeEventListener('message', listener);
                // The correlated reply owns the response from here, even when the
                // no-video path delays it past the 1 s mark; cancel the bridge timer now.
                clearTimeout(timer);
                const hasVideo = document.querySelector('video') !== null;
                const rawDuration = typeof event.data.duration === 'number' ? event.data.duration : NaN;
                const rawCurrentTime = typeof event.data.currentTime === 'number' ? event.data.currentTime : 0;
                const durationKind = Number.isNaN(rawDuration) ? 'unknown'
                    : !Number.isFinite(rawDuration) ? 'live'
                        : 'finite';
                const reply = () => {
                    if (responded)
                        return;
                    responded = true;
                    clearTimeout(timer);
                    sendResponse({
                        connected: true,
                        hasVideo,
                        speed: event.data.speed,
                        durationKind,
                        duration: durationKind === 'finite' ? rawDuration : 0,
                        currentTime: rawCurrentTime
                    });
                };
                // No-video frames wait 900 ms so a video frame elsewhere can win the callback race (ADR-6).
                if (hasVideo)
                    reply();
                else
                    setTimeout(reply, 900);
            };
            window.addEventListener('message', listener);
            window.postMessage({ type: 'GET_ECHO_SPEED', requestId }, '*');
            const timer = setTimeout(() => {
                window.removeEventListener('message', listener);
                if (!responded) {
                    responded = true;
                    console.warn(`[Echo360 Speed Control] getSpeed ${requestId} got no CURRENT_ECHO_SPEED reply within 1 s; reporting injected_timeout instead of a fake no-video answer.`);
                    sendResponse({ connected: true, failureKind: 'injected_timeout' });
                }
            }, 1000);
            return true;
        }
        else if (request.action === 'updateShortcuts') {
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
