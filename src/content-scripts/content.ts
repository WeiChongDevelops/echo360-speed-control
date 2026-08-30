(function() {
  'use strict';

  interface SpeedMessage {
    type: string;
    speed?: number;
    enabled?: boolean;
    linkedinIcon?: string;
    kofiIcon?: string;
    hideSlowSpeeds?: boolean;
    duration?: number;
    currentTime?: number;
    paused?: boolean;
    seeking?: boolean;
    requestId?: string;
    savedSecondsDelta?: number;
    sampledWallSeconds?: number;
    totalSeconds?: number;
  }

  interface ChromeMessage {
    action: string;
    speed?: number;
    enabled?: boolean;
  }

  interface SpeedResponse {
    speed?: number;
    success?: boolean;
    connected?: boolean;
    hasVideo?: boolean;
    durationKind?: 'finite' | 'live' | 'unknown';
    duration?: number;
    currentTime?: number;
    failureKind?: 'injected_timeout';
    paused?: boolean;
    seeking?: boolean;
    snapshot?: null;
  }

  // Correlates each GET_ECHO_SPEED round trip with its CURRENT_ECHO_SPEED reply.
  let requestSeq = 0;

  // Independent wall clock for time-saved delta validation (M1): the injected
  // script's claimed wall time rides the same hostile postMessage channel, so
  // content tracks its own time between accepted batches.
  let lastAcceptedBatchAtMs = Date.now();

  function getDomainKey(): string {
    return 'speed_echo360';
  }

  const isEcho360 = window.location.hostname.includes('echo360');
  const scriptName = isEcho360 ? 'injected/injector-simple.js' : 'injected/injector.js';

  // Time-saved stat bridge (ADR-5). Subscribed here at script load, BEFORE the
  // initial storage.local read inside the onload handshake below, so a write
  // landing between the two is never missed.
  let onChangedHopLogged = false;
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !('totalTimeSavedSeconds' in changes)) return;
    if (!onChangedHopLogged) {
      onChangedHopLogged = true;
      // The SDD labels this hop unconfirmed; this one-time log verifies it during unpacked testing.
      console.log('[Echo360 Speed Control] storage.onChanged fired in the content script; the stat bridge hop works.');
    }
    const totalSeconds = changes.totalTimeSavedSeconds.newValue;
    if (typeof totalSeconds === 'number' && Number.isFinite(totalSeconds)) {
      window.postMessage({
        type: 'SET_TIME_SAVED_TOTAL',
        totalSeconds
      } as SpeedMessage, '*');
    } else {
      console.warn(`[Echo360 Speed Control] Ignored totalTimeSavedSeconds change with non-numeric value: ${String(totalSeconds)}.`);
    }
  });

  const script = document.createElement('script');
  script.src = chrome.runtime.getURL(scriptName);
  script.onload = function() {
    script.remove();

    const key = getDomainKey();
    chrome.storage.sync.get([key, 'shortcutsEnabled', 'hideSlowSpeeds'], (result) => {
      if (result[key]) {
        const savedSpeed = parseFloat(result[key] as string);
        window.postMessage({
          type: 'SET_ECHO_SPEED',
          speed: savedSpeed
        } as SpeedMessage, '*');
      }

      // Send shortcuts setting to injected script
      const shortcutsEnabled = result.shortcutsEnabled !== false; // Default to true
      window.postMessage({
        type: 'SET_SHORTCUTS_ENABLED',
        enabled: shortcutsEnabled
      } as SpeedMessage, '*');

      // Send hide-slow-speeds preference (default false)
      window.postMessage({
        type: 'SET_HIDE_SLOW_SPEEDS',
        hideSlowSpeeds: result.hideSlowSpeeds === true
      } as SpeedMessage, '*');

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
      } as SpeedMessage, '*');

      // Initial stat hydration rides this same handshake so the page listener
      // is guaranteed to exist (gotcha: never post beside script injection).
      // The onChanged subscription above was registered before this read.
      chrome.storage.local.get('totalTimeSavedSeconds', (localResult) => {
        const totalSeconds = localResult.totalTimeSavedSeconds;
        if (typeof totalSeconds === 'number' && Number.isFinite(totalSeconds)) {
          window.postMessage({
            type: 'SET_TIME_SAVED_TOTAL',
            totalSeconds
          } as SpeedMessage, '*');
        }
      });
    });
  };
  script.onerror = function() {
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
      } as SpeedMessage, '*');
    }
  });

  // Listen for speed changes from the injected script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    if (event.data.type === 'SPEED_CHANGED') {
      // Save the new speed to storage
      const key = getDomainKey();
      chrome.storage.sync.set({ [key]: event.data.speed });

      // Notify the popup if it's open
      chrome.runtime.sendMessage({
        action: 'speedChanged',
        speed: event.data.speed
      });
    } else if (event.data.type === 'HIDE_SLOW_SPEEDS_CHANGED') {
      chrome.storage.sync.set({ hideSlowSpeeds: event.data.hideSlowSpeeds === true });
    } else if (event.data.type === 'TIME_SAVED_DELTA') {
      // Page-exposed channel: validate before forwarding (D3, M1).
      const claimed = event.data.sampledWallSeconds;
      const delta = event.data.savedSecondsDelta;
      const observedWall = (Date.now() - lastAcceptedBatchAtMs) / 1000;
      const bound = 3 * Math.min(claimed, observedWall) * 1.25;
      let reason: string | null = null;
      if (!Number.isFinite(delta)) reason = 'delta not finite';
      else if (delta <= 0) reason = 'delta not positive';
      else if (!Number.isFinite(claimed)) reason = 'claimed wall not finite';
      else if (claimed <= 0) reason = 'claimed wall not positive';
      // Accept cadence floor: legitimate batches flush every ~10 s, so anything
      // arriving under 1 s of observed wall time since the last accepted batch
      // is a hostile or buggy rapid-fire post; capping the accept rate keeps the
      // service worker's serialized storage jobs at ~1/s worst case.
      else if (observedWall < 1) reason = 'batch arrived under the 1 s accept interval';
      else if (delta > bound) reason = 'delta exceeds the wall-time bound';
      if (reason !== null) {
        console.warn(`[Echo360 Speed Control] Rejected time-saved delta ${delta} (claimed wall ${claimed}s, observed ${observedWall.toFixed(1)}s, bound ${bound.toFixed(1)}s): ${reason}.`);
        return;
      }
      lastAcceptedBatchAtMs = Date.now();
      chrome.runtime.sendMessage({
        action: 'timeSavedDelta',
        savedSecondsDelta: delta,
        claimedWallSeconds: claimed
      }, () => {
        // D11: read lastError so a dead-SW send never surfaces as unchecked noise.
        if (chrome.runtime.lastError) {
          console.warn(`[Echo360 Speed Control] Time-saved delta did not reach the service worker: ${chrome.runtime.lastError.message}. The batch is lost.`);
        }
      });
    }
  });

  chrome.runtime.onMessage.addListener((request: ChromeMessage, sender, sendResponse) => {
    if (request.action === 'setSpeed') {
      window.postMessage({
        type: 'SET_ECHO_SPEED',
        speed: request.speed
      } as SpeedMessage, '*');
      const key = getDomainKey();
      chrome.storage.sync.set({ [key]: request.speed });

      sendResponse({ success: true } as SpeedResponse);
      return true;
    } else if (request.action === 'getSpeed') {
      const requestId = `gs_${++requestSeq}`;
      let responded = false;
      const listener = (event: MessageEvent) => {
        if (event.source !== window || event.data.type !== 'CURRENT_ECHO_SPEED') return;
        if (event.data.requestId !== requestId) return;
        window.removeEventListener('message', listener);
        // The correlated reply owns the response from here, even when the
        // no-video path delays it past the 1 s mark; cancel the bridge timer now.
        clearTimeout(timer);
        const hasVideo = document.querySelector('video') !== null;
        const rawDuration: number = typeof event.data.duration === 'number' ? event.data.duration : NaN;
        const rawCurrentTime: number = typeof event.data.currentTime === 'number' ? event.data.currentTime : 0;
        const durationKind: 'finite' | 'live' | 'unknown' =
          Number.isNaN(rawDuration) ? 'unknown'
            : !Number.isFinite(rawDuration) ? 'live'
            : 'finite';
        const reply = () => {
          if (responded) return;
          responded = true;
          clearTimeout(timer);
          sendResponse({
            connected: true,
            hasVideo,
            speed: event.data.speed,
            durationKind,
            duration: durationKind === 'finite' ? rawDuration : 0,
            currentTime: rawCurrentTime
          } as SpeedResponse);
        };
        // No-video frames wait 900 ms so a video frame elsewhere can win the callback race (ADR-6).
        if (hasVideo) reply();
        else setTimeout(reply, 900);
      };
      window.addEventListener('message', listener);
      window.postMessage({ type: 'GET_ECHO_SPEED', requestId } as SpeedMessage, '*');
      const timer = setTimeout(() => {
        window.removeEventListener('message', listener);
        if (!responded) {
          responded = true;
          console.warn(`[Echo360 Speed Control] getSpeed ${requestId} got no CURRENT_ECHO_SPEED reply within 1 s; reporting injected_timeout instead of a fake no-video answer.`);
          sendResponse({ connected: true, failureKind: 'injected_timeout' } as SpeedResponse);
        }
      }, 1000);

      return true;
    } else if (request.action === 'getSnapshot') {
      // Side-effect-free playback snapshot for the popup's ETA poller (ADR-2).
      // Mirrors the getSpeed round trip mechanics but never touches detection
      // state or stored speed; a bridge timeout answers { snapshot: null }.
      const requestId = `sn_${++requestSeq}`;
      let responded = false;
      const listener = (event: MessageEvent) => {
        if (event.source !== window || event.data.type !== 'CURRENT_ECHO_SPEED') return;
        if (event.data.requestId !== requestId) return;
        window.removeEventListener('message', listener);
        // The correlated reply owns the response from here, even when the
        // no-video path delays it past the 1 s mark; cancel the bridge timer now.
        clearTimeout(timer);
        const hasVideo = document.querySelector('video') !== null;
        const rawDuration: number = typeof event.data.duration === 'number' ? event.data.duration : NaN;
        const rawCurrentTime: number = typeof event.data.currentTime === 'number' ? event.data.currentTime : 0;
        const durationKind: 'finite' | 'live' | 'unknown' =
          Number.isNaN(rawDuration) ? 'unknown'
            : !Number.isFinite(rawDuration) ? 'live'
            : 'finite';
        const reply = () => {
          if (responded) return;
          responded = true;
          clearTimeout(timer);
          sendResponse({
            speed: event.data.speed,
            durationKind,
            duration: durationKind === 'finite' ? rawDuration : 0,
            currentTime: rawCurrentTime,
            paused: event.data.paused === true,
            seeking: event.data.seeking === true
          } as SpeedResponse);
        };
        // No-video frames wait 900 ms so a video frame elsewhere can win the callback race (ADR-6).
        if (hasVideo) reply();
        else setTimeout(reply, 900);
      };
      window.addEventListener('message', listener);
      window.postMessage({ type: 'GET_ECHO_SPEED', requestId } as SpeedMessage, '*');
      const timer = setTimeout(() => {
        window.removeEventListener('message', listener);
        if (!responded) {
          responded = true;
          console.warn(`[Echo360 Speed Control] getSnapshot ${requestId} got no CURRENT_ECHO_SPEED reply within 1 s; answering with a null snapshot so the popup keeps its last values.`);
          sendResponse({ snapshot: null } as SpeedResponse);
        }
      }, 1000);

      return true;
    } else if (request.action === 'updateShortcuts') {
      // Forward shortcuts update to injected script
      window.postMessage({
        type: 'SET_SHORTCUTS_ENABLED',
        enabled: request.enabled
      } as SpeedMessage, '*');
      sendResponse({ success: true } as SpeedResponse);
      return true;
    } else if (request.action === 'toggleStudySpeed') {
      // Forward the popup's R press to the injected toggle; the page owns the toggle state (ADR-7).
      window.postMessage({
        type: 'TOGGLE_STUDY_SPEED'
      } as SpeedMessage, '*');
      sendResponse({ success: true } as SpeedResponse);
      return true;
    }
  });

})();
