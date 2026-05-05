"use strict";
(function () {
    'use strict';
    const currentSpeedEl = document.getElementById('currentSpeed');
    const speedSlider = document.getElementById('speedSlider');
    const sliderValueEl = document.getElementById('sliderValue');
    const statusEl = document.getElementById('status');
    const retryButton = document.getElementById('statusRetry');
    const reportLink = document.getElementById('statusReport');
    const presetButtons = document.querySelectorAll('.preset-btn');
    const themeToggle = document.getElementById('themeToggle');
    const shortcutsToggle = document.getElementById('shortcutsToggle');
    const shortcutsDisclosure = document.querySelector('.shortcuts-disclosure');
    let currentDomain = '';
    let currentStatusState = 'detecting';
    let lastStatusPayload = {};
    let statusRevertTimer;
    setStatusState('detecting');
    initTheme();
    initShortcuts();
    getCurrentSpeed();
    listenForSpeedChanges();
    function setStatusState(next, payload = {}) {
        if (statusRevertTimer !== undefined) {
            clearTimeout(statusRevertTimer);
            statusRevertTimer = undefined;
        }
        currentStatusState = next;
        lastStatusPayload = payload;
        renderStatus();
        if (next === 'connected_speed_set') {
            statusRevertTimer = setTimeout(() => {
                statusRevertTimer = undefined;
                setStatusState('connected_idle');
            }, 2000);
        }
    }
    function renderStatus() {
        let text = '';
        let className = 'status';
        switch (currentStatusState) {
            case 'detecting':
                text = 'Detecting Echo360 player…';
                className = 'status';
                break;
            case 'connected_idle':
                text = 'Connected to lecture';
                className = 'status';
                break;
            case 'connected_speed_set':
                text = `Speed set to ${(lastStatusPayload.speed ?? 0).toFixed(2)}x`;
                className = 'status success';
                break;
            case 'no_video':
                text = 'No video detected. Start playing a lecture.';
                className = 'status error detailed-error';
                break;
            case 'transient_error':
                text = 'Connection hiccup. Try again.';
                className = 'status error';
                break;
            case 'persistent_error':
                text = 'Cannot communicate with the player. Try refreshing the page. If the problem persists, reload the extension or report.';
                className = 'status error detailed-error';
                break;
            case 'invalid_page':
                text = 'This page is not an Echo360 lecture.';
                className = 'status error detailed-error';
                break;
        }
        statusEl.textContent = text;
        statusEl.className = className;
        const errorStates = ['no_video', 'transient_error', 'persistent_error', 'invalid_page'];
        retryButton.classList.toggle('hidden', !errorStates.includes(currentStatusState));
        reportLink.classList.toggle('hidden', currentStatusState !== 'persistent_error');
    }
    function updateActivePreset(currentSpeed) {
        presetButtons.forEach(button => {
            const presetSpeed = parseFloat(button.dataset.speed);
            const isActive = Math.abs(presetSpeed - currentSpeed) < 0.01;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
    }
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
            shortcutsDisclosure.classList.toggle('disabled', !enabled);
        });
    }
    function toggleShortcuts() {
        const enabled = shortcutsToggle.checked;
        chrome.storage.sync.set({ shortcutsEnabled: enabled });
        shortcutsDisclosure.classList.toggle('disabled', !enabled);
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
        return 'speed_echo360';
    }
    function saveSpeedForDomain(speed) {
        if (!currentDomain)
            return;
        const key = getDomainKey();
        chrome.storage.sync.set({ [key]: speed });
    }
    function loadSpeedForDomain() {
        if (!currentDomain)
            return;
        const key = getDomainKey();
        chrome.storage.sync.get([key], (result) => {
            if (result[key]) {
                const savedSpeed = parseFloat(result[key]);
                setSpeed(savedSpeed, false, false);
                speedSlider.value = savedSpeed.toString();
                updateSliderDisplay();
                updateActivePreset(savedSpeed);
            }
        });
    }
    function listenForSpeedChanges() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'updateSpeed') {
                // Update the UI with the new speed
                currentSpeedEl.textContent = `${request.speed.toFixed(2)}x`;
                speedSlider.value = request.speed.toString();
                updateSliderDisplay();
                updateActivePreset(request.speed);
                setStatusState('connected_speed_set', { speed: request.speed });
            }
        });
    }
    function updateSliderDisplay() {
        const value = parseFloat(speedSlider.value);
        sliderValueEl.textContent = value.toFixed(2) + 'x';
        speedSlider.setAttribute('aria-valuenow', value.toString());
    }
    function classifyDetection(url, runtimeError, response) {
        if (!url || !url.includes('echo360')) {
            return { kind: 'invalid_page' };
        }
        if (runtimeError || !response) {
            return { kind: 'not_connected' };
        }
        if (response.hasVideo === false) {
            return { kind: 'connected_no_video' };
        }
        if (response.speed === undefined) {
            return { kind: 'connected_no_video' };
        }
        return { kind: 'connected_with_video', speed: response.speed };
    }
    function renderDetection(result) {
        switch (result.kind) {
            case 'connected_with_video':
                currentSpeedEl.textContent = `${result.speed.toFixed(2)}x`;
                speedSlider.value = result.speed.toString();
                updateSliderDisplay();
                updateActivePreset(result.speed);
                setStatusState('connected_idle');
                setTimeout(() => loadSpeedForDomain(), 100);
                return;
            case 'connected_no_video':
                currentSpeedEl.textContent = 'N/A';
                setStatusState('no_video');
                return;
            case 'not_connected':
                currentSpeedEl.textContent = 'N/A';
                setStatusState('persistent_error');
                return;
            case 'invalid_page':
                currentSpeedEl.textContent = 'N/A';
                setStatusState('invalid_page');
                return;
        }
    }
    function getCurrentSpeed() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                try {
                    const url = new URL(tabs[0].url);
                    currentDomain = url.hostname.replace('www.', '');
                }
                catch (e) {
                    console.error('[Echo360 Speed Control] Invalid URL:', e);
                }
                chrome.tabs.sendMessage(tabs[0].id, { action: 'getSpeed' }, (response) => {
                    const result = classifyDetection(tabs[0].url, chrome.runtime.lastError, response);
                    renderDetection(result);
                });
            }
        });
    }
    function setSpeed(speed, shouldSave = true, shouldAnnounce = true) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: 'setSpeed',
                    speed: parseFloat(speed.toString())
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        setStatusState('persistent_error');
                        return;
                    }
                    if (response && response.success) {
                        currentSpeedEl.textContent = parseFloat(speed.toString()).toFixed(2) + 'x';
                        updateActivePreset(parseFloat(speed.toString()));
                        if (shouldAnnounce) {
                            setStatusState('connected_speed_set', { speed: parseFloat(speed.toString()) });
                        }
                        if (shouldSave) {
                            saveSpeedForDomain(parseFloat(speed.toString()));
                        }
                        speedSlider.value = speed.toString();
                        updateSliderDisplay();
                    }
                    else {
                        setStatusState('no_video');
                    }
                });
            }
        });
    }
    themeToggle.addEventListener('click', toggleTheme);
    shortcutsToggle.addEventListener('change', toggleShortcuts);
    speedSlider.addEventListener('input', () => {
        updateSliderDisplay();
        updateActivePreset(parseFloat(speedSlider.value));
    });
    speedSlider.addEventListener('change', () => {
        setSpeed(parseFloat(speedSlider.value));
    });
    presetButtons.forEach(button => {
        button.addEventListener('click', () => {
            const speed = button.dataset.speed;
            setSpeed(parseFloat(speed));
        });
    });
    retryButton.addEventListener('click', () => {
        setStatusState('detecting');
        getCurrentSpeed();
    });
    document.addEventListener('keydown', (e) => {
        // Number keys for quick speed selection — clamp to slider max (4x)
        if (e.key >= '1' && e.key <= '9') {
            const speed = parseInt(e.key);
            const max = parseFloat(speedSlider.max);
            const clamped = Math.min(speed, max);
            setSpeed(clamped);
        }
        // Arrow keys for slider control
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            const newValue = Math.max(0.25, parseFloat(speedSlider.value) - 0.25);
            speedSlider.value = newValue.toString();
            updateSliderDisplay();
            setSpeed(newValue);
        }
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            const newValue = Math.min(4, parseFloat(speedSlider.value) + 0.25);
            speedSlider.value = newValue.toString();
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
