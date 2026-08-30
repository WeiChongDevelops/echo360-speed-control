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
    function renderEtaInto(el, seconds, kind, speed, paused) {
        el.textContent = ''; // clear prior children
        if (seconds === null)
            return;
        if (kind !== 'finite')
            return;
        if (!Number.isFinite(seconds) || seconds <= 0)
            return;
        const prefix = paused ? 'Paused, ' : '';
        el.appendChild(document.createTextNode(`${prefix}${etaMainPart(seconds)} @ `));
        const strong = document.createElement('strong');
        strong.style.fontWeight = '700';
        strong.textContent = formatSpeed(speed);
        el.appendChild(strong);
        if (!paused && speed > 1) {
            el.appendChild(document.createTextNode(' ⚡'));
        }
    }
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
    const etaEl = document.getElementById('eta');
    let currentDomain = '';
    let currentStatusState = 'detecting';
    let lastStatusPayload = {};
    let statusRevertTimer;
    // Detection attempt correlation (F3): one auto retry per attempt, stale callbacks discarded.
    let detectionAttemptId = 0;
    let autoRetryUsedForAttempt = false;
    // Handle for renderDetection's delayed loadSpeedForDomain restore; cleared by any
    // user speed action or incoming updateSpeed so a fresh choice is never overwritten.
    let restoreSpeedTimer;
    function clearRestoreSpeedTimer() {
        if (restoreSpeedTimer !== undefined) {
            clearTimeout(restoreSpeedTimer);
            restoreSpeedTimer = undefined;
        }
    }
    let cachedDuration = 0;
    let cachedCurrentTime = 0;
    let cachedSpeed = 1;
    let cachedDurationKind = 'absent';
    let cachedPaused = false;
    let etaTickHandle;
    // Serial poller discipline (ADR-2): at most one getSnapshot in flight.
    let etaPollInFlight = false;
    // Snapshot staleness guard, same pattern as detectionAttemptId: a poll
    // captures the generation at send and its response is discarded if any
    // user speed action, incoming updateSpeed, or ETA stop moved it on.
    let etaGeneration = 0;
    const ETA_VISIBLE_STATES = ['connected_idle', 'connected_speed_set'];
    function etaUpdateFromResponse(response) {
        if ('durationKind' in response && response.durationKind !== undefined) {
            cachedDuration = response.duration ?? 0;
            cachedCurrentTime = response.currentTime ?? 0;
            cachedDurationKind = response.durationKind;
            if (typeof response.speed === 'number') {
                cachedSpeed = response.speed;
            }
            cachedPaused = response.paused === true;
        }
        else {
            cachedDurationKind = 'absent';
        }
    }
    function etaCompute() {
        if (cachedDurationKind !== 'finite')
            return null;
        if (cachedCurrentTime >= cachedDuration)
            return null;
        return (cachedDuration - cachedCurrentTime) / cachedSpeed;
    }
    function etaRender() {
        if (!etaEl)
            return;
        const remaining = etaCompute();
        const kindForFormat = cachedDurationKind === 'absent' ? 'unknown' : cachedDurationKind;
        renderEtaInto(etaEl, remaining, kindForFormat, cachedSpeed, cachedPaused);
    }
    // Drift fix (F4): every tick pulls a fresh playback snapshot instead of
    // advancing a fake clock, so pauses freeze the countdown and seeks show
    // the fresh value on the next poll. Serial by design: a tick that finds a
    // request still in flight does nothing. Null snapshots keep the last
    // rendered values and never mark an error (detection owns errors).
    // NEVER route this through getCurrentSpeed/renderDetection/loadSpeedForDomain;
    // that path re-applies the stored speed, which is the bug this replaces.
    function etaPollSnapshot() {
        if (etaPollInFlight)
            return;
        if (!ETA_VISIBLE_STATES.includes(currentStatusState))
            return;
        etaPollInFlight = true;
        const generationAtSend = etaGeneration;
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]) {
                etaPollInFlight = false;
                return;
            }
            chrome.tabs.sendMessage(tabs[0].id, { action: 'getSnapshot' }, (response) => {
                etaPollInFlight = false;
                // Discard snapshots from a superseded generation: a newer speed was
                // committed (or the ETA epoch ended) while this one was in flight,
                // and applying it would roll cachedSpeed back until the next poll.
                if (generationAtSend !== etaGeneration) {
                    return;
                }
                // Re-check the gate at landing time: detection may have flipped to an
                // error state during the round trip, and a late snapshot must not
                // repaint a stale ETA under an error status.
                if (!ETA_VISIBLE_STATES.includes(currentStatusState)) {
                    return;
                }
                if (chrome.runtime.lastError || !response || response.snapshot === null) {
                    return;
                }
                etaUpdateFromResponse(response);
                etaRender();
            });
        });
    }
    function etaStartTicking() {
        if (etaTickHandle !== undefined)
            return;
        // Immediate first poll so a popup opened on a paused video shows the
        // paused form now rather than after the first interval tick.
        etaPollSnapshot();
        etaTickHandle = setInterval(() => {
            etaPollSnapshot();
        }, 1000);
    }
    function etaStopTicking() {
        // Close the ETA epoch: a snapshot still in flight from before this stop
        // must not apply after a reconnect.
        etaGeneration++;
        if (etaTickHandle !== undefined) {
            clearInterval(etaTickHandle);
            etaTickHandle = undefined;
        }
    }
    // Verbose, screen-reader-friendly version of the eta. Distinct from the
    // visible compact form (`24 min left` / `1h 13m left`); EARS-F5-2 wants a
    // self-disambiguating phrase delivered via the `#currentSpeed` aria-label.
    // Returns the leading `, ` so callers can string-concat directly.
    function etaSuffixForAriaLabel() {
        const remaining = etaCompute();
        if (remaining === null)
            return '';
        if (!Number.isFinite(remaining) || remaining <= 0)
            return '';
        if (remaining < 60)
            return ', less than a minute left';
        if (remaining < 3600) {
            const m = Math.floor(remaining / 60);
            return m === 1 ? ', 1 minute left' : `, ${m} minutes left`;
        }
        const h = Math.floor(remaining / 3600);
        const m = Math.floor((remaining % 3600) / 60);
        const hPart = h === 1 ? '1 hour' : `${h} hours`;
        if (m === 0)
            return `, ${hPart} left`;
        const mPart = m === 1 ? '1 minute' : `${m} minutes`;
        return `, ${hPart} ${mPart} left`;
    }
    // Centralised aria-label writer. EARS-F5-2: every speed-textContent change
    // must mirror into aria-label so the single aria-live polite announcement
    // (driven by textContent change on #currentSpeed) carries the eta too.
    // Spec 001 M3-1 silent-restore preservation: do NOT call this from paths
    // that don't already update textContent — keeping setter symmetry with
    // textContent prevents accidental announcement coupling.
    function applyCurrentSpeedAria(speed) {
        if (!currentSpeedEl)
            return;
        currentSpeedEl.setAttribute('aria-label', `Current playback speed ${speed.toFixed(2)}x${etaSuffixForAriaLabel()}`);
    }
    function resetCurrentSpeedAria() {
        if (!currentSpeedEl)
            return;
        currentSpeedEl.setAttribute('aria-label', 'Current playback speed');
    }
    setStatusState('detecting');
    initTheme();
    initShortcuts();
    initPresetVisibility();
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
                text = 'Connection hiccup. Retrying…';
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
        // One shared button; label reassigned on every render per state.
        retryButton.textContent = currentStatusState === 'transient_error' ? 'Retry now' : '↻ Retry';
        reportLink.classList.toggle('hidden', currentStatusState !== 'persistent_error');
        // Gate eta visibility on FSM state (EARS-F2-4). Tick start/stop is controlled here;
        // start happens in the getSpeed response hook to avoid double-starting.
        if (ETA_VISIBLE_STATES.includes(currentStatusState)) {
            etaRender();
        }
        else {
            etaStopTicking();
            if (etaEl)
                etaEl.textContent = '';
        }
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
    // Read once at popup open; a mid-session toggle on the page stays stale until reopen (decision D1).
    function initPresetVisibility() {
        chrome.storage.sync.get(['hideSlowSpeeds'], (result) => {
            const hide = result.hideSlowSpeeds === true; // absent defaults to false
            presetButtons.forEach(button => {
                const presetSpeed = parseFloat(button.dataset.speed);
                button.hidden = hide && presetSpeed < 1;
            });
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
                // A page-driven change supersedes a pending restore too.
                clearRestoreSpeedTimer();
                // And supersedes any snapshot still in flight (staleness guard).
                etaGeneration++;
                // Update the UI with the new speed
                currentSpeedEl.textContent = `${request.speed.toFixed(2)}x`;
                speedSlider.value = request.speed.toString();
                updateSliderDisplay();
                updateActivePreset(request.speed);
                setStatusState('connected_speed_set', { speed: request.speed });
                // Eta wiring (T1.4 / EARS-F2-2): refresh immediately, no waiting for next tick.
                cachedSpeed = request.speed;
                etaRender();
                // T1.5 / EARS-F5-2: mirror textContent into aria-label with eta suffix.
                applyCurrentSpeedAria(request.speed);
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
        // Bridge timeout is checked before the no-video branch: a missed reply is a
        // hiccup to retry, never a fake "no video" verdict (F3).
        if (response.failureKind === 'injected_timeout') {
            return { kind: 'transient_timeout' };
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
                // T1.5 / EARS-F5-2: aria-label initial render. Eta cache is updated
                // by the getCurrentSpeed callback (etaUpdateFromResponse) BEFORE this
                // function runs at all... actually no, this runs first. We re-apply
                // aria-label after etaUpdateFromResponse below (in getCurrentSpeed
                // callback) to ensure the suffix reflects the freshly-cached eta.
                applyCurrentSpeedAria(result.speed);
                clearRestoreSpeedTimer();
                restoreSpeedTimer = setTimeout(() => {
                    restoreSpeedTimer = undefined;
                    loadSpeedForDomain();
                }, 100);
                return;
            case 'connected_no_video':
                currentSpeedEl.textContent = 'N/A';
                resetCurrentSpeedAria();
                setStatusState('no_video');
                return;
            case 'transient_timeout':
                if (!autoRetryUsedForAttempt) {
                    autoRetryUsedForAttempt = true;
                    setStatusState('transient_error');
                    console.warn('[Echo360 Speed Control] Bridge timeout on getSpeed; retrying once automatically for this detection attempt.');
                    getCurrentSpeed();
                }
                else {
                    console.warn('[Echo360 Speed Control] Bridge timeout persisted after the automatic retry; showing persistent error.');
                    currentSpeedEl.textContent = 'N/A';
                    resetCurrentSpeedAria();
                    setStatusState('persistent_error');
                }
                return;
            case 'not_connected':
                currentSpeedEl.textContent = 'N/A';
                resetCurrentSpeedAria();
                setStatusState('persistent_error');
                return;
            case 'invalid_page':
                currentSpeedEl.textContent = 'N/A';
                resetCurrentSpeedAria();
                setStatusState('invalid_page');
                return;
        }
    }
    function getCurrentSpeed() {
        // Capture before the async tab query: a manual retry that lands while the
        // query is pending must supersede this request, not be adopted by it.
        const attemptId = detectionAttemptId;
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
                    if (attemptId !== detectionAttemptId) {
                        console.warn(`[Echo360 Speed Control] Discarding getSpeed result from superseded detection attempt ${attemptId} (current attempt ${detectionAttemptId}).`);
                        return;
                    }
                    const result = classifyDetection(tabs[0].url, chrome.runtime.lastError, response);
                    renderDetection(result);
                    // Eta wiring (T1.4). Update cache from response, then start/stop ticking
                    // based on the just-set FSM state. SDD Example 3 backwards-compat:
                    // missing durationKind → cachedDurationKind = 'absent' → etaCompute returns null.
                    if (response) {
                        etaUpdateFromResponse(response);
                    }
                    else {
                        cachedDurationKind = 'absent';
                    }
                    if (ETA_VISIBLE_STATES.includes(currentStatusState)) {
                        etaRender();
                        etaStartTicking();
                        // T1.5 / EARS-F5-2: re-apply aria-label now that eta cache is
                        // populated. renderDetection already set aria-label with an
                        // empty suffix (cache was stale at that point); this overwrite
                        // adds the eta suffix. aria-label changes don't trigger
                        // aria-live announcements, so spec 001 M3-1 is preserved.
                        if (result.kind === 'connected_with_video') {
                            applyCurrentSpeedAria(result.speed);
                        }
                    }
                    else {
                        etaStopTicking();
                        if (etaEl)
                            etaEl.textContent = '';
                    }
                });
            }
        });
    }
    function setSpeed(speed, shouldSave = true, shouldAnnounce = true) {
        // Any speed send supersedes a pending restore (harmless no-op when the
        // caller is the restore itself, since its timer has already fired).
        clearRestoreSpeedTimer();
        // And supersedes any snapshot still in flight (staleness guard).
        etaGeneration++;
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
                        // Eta wiring (T1.4 / EARS-F2-2): update cached speed for the local-driven
                        // change so the sub-line reflects the new ETA within the 200ms budget.
                        cachedSpeed = parseFloat(speed.toString());
                        etaRender();
                        // T1.5 / EARS-F5-2: mirror textContent into aria-label with eta suffix.
                        applyCurrentSpeedAria(parseFloat(speed.toString()));
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
        // Manual retry starts a fresh detection attempt with a fresh auto-retry budget.
        detectionAttemptId++;
        autoRetryUsedForAttempt = false;
        setStatusState('detecting');
        getCurrentSpeed();
    });
    function isEditableTarget(e) {
        const el = (e.composedPath ? e.composedPath()[0] : e.target);
        if (!el)
            return false;
        if (el.isContentEditable)
            return true;
        const tag = el.tagName;
        if (tag === 'TEXTAREA' || tag === 'SELECT')
            return true;
        if (tag === 'INPUT') {
            const nonTextTypes = ['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image', 'hidden'];
            return !nonTextTypes.includes(el.type);
        }
        return false;
    }
    document.addEventListener('keydown', (e) => {
        if (isEditableTarget(e))
            return;
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
