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

  type DurationKind = 'finite' | 'live' | 'unknown';

  function formatSpeed(s: number): string {
    return `${Math.round(s * 100) / 100}x`;
  }

  function etaMainPart(seconds: number): string {
    if (seconds < 60) return '<1 min left';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min left`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m left`;
  }

  function renderEtaInto(el: HTMLElement, seconds: number | null, kind: DurationKind, speed: number, paused: boolean): void {
    el.textContent = ''; // clear prior children
    if (seconds === null) return;
    if (kind !== 'finite') return;
    if (!Number.isFinite(seconds) || seconds <= 0) return;
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

  let targetSpeed = 1.0;
  let enforceSpeed = false;
  let speedOverlay: HTMLElement | null = null;
  let overlayTimeout: number | null = null;
  let shortcutsEnabled = true;
  let linkedinIconUrl: string | null = null;
  let kofiIconUrl: string | null = null;
  let hideSlowSpeeds = false;
  // Last non-1x applied or observed speed; survives a manual change to 1x (C3, ADR-7).
  let previousStudySpeed: number | null = null;
  // Handle of the current post-setSpeed drift enforcer, so each setSpeed call
  // cancels the previous one instead of stacking overlapping intervals.
  let driftEnforcer: ReturnType<typeof setInterval> | null = null;

  const ETA_DATA_ATTR = 'data-eta-display';
  let etaSpan: HTMLSpanElement | null = null;
  let etaTickHandle: ReturnType<typeof setInterval> | undefined;

  function classifyDuration(d: number): DurationKind {
    if (Number.isNaN(d)) return 'unknown';
    if (!Number.isFinite(d)) return 'live';
    return 'finite';
  }

  function injectEtaSpan(): void {
    const anchor = document.getElementById('player-controls');
    if (!anchor) return; // silent absence (PRD/F1-5)
    if (anchor.parentElement?.querySelector(`[${ETA_DATA_ATTR}]`)) return;

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
      color: #46B864;
      user-select: none;
    `;
    anchor.insertAdjacentElement('afterend', span);
    etaSpan = span;
  }

  function updateEtaSpan(): void {
    if (!etaSpan) return;
    const video = document.querySelector<HTMLVideoElement>('video');
    if (!video) {
      etaSpan.textContent = '';
      return;
    }
    const kind = classifyDuration(video.duration);
    if (kind !== 'finite') {
      renderEtaInto(etaSpan, null, kind, video.playbackRate, video.paused); // PRD/F4-1, F4-2
      return;
    }
    if (video.currentTime >= video.duration) {
      renderEtaInto(etaSpan, null, 'finite', video.playbackRate, video.paused); // PRD/F4-3 (ended)
      return;
    }
    const remaining = (video.duration - video.currentTime) / video.playbackRate;
    renderEtaInto(etaSpan, remaining, 'finite', video.playbackRate, video.paused);
    // Finish clock lives with the injected caller only, never inside the shared
    // helper, so the popup structurally cannot grow one. Recomputed every tick,
    // which keeps it fresh within one tick of any speed change or seek.
    if (!video.paused && Number.isFinite(remaining) && remaining > 0) {
      const finish = new Date(Date.now() + remaining * 1000);
      const clock = finish.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      etaSpan.appendChild(document.createTextNode(` · finishes at ${clock}`));
    }
  }

  function startEtaTicker(): void {
    if (etaTickHandle !== undefined) return;
    etaTickHandle = setInterval(() => {
      if (!etaSpan || !etaSpan.isConnected) {
        etaSpan = null;
        injectEtaSpan();
      }
      updateEtaSpan();
      sampleTimeSaved();
    }, 1000);
  }

  // Time-saved sampler state (F5). Rides the existing 1 s ETA tick above; no new interval.
  const sampler = {
    lastMediaTime: 0,
    lastWallMs: 0,
    batchSaved: 0,
    batchWallMs: 0,
    videoRef: null as HTMLVideoElement | null
  };
  // Display cache for the stat surfaces (C4): survives Echo360 menu rebuilds.
  let timeSavedTotalSeconds = 0;

  function samplerSeekReset(event?: Event): void {
    // Log the discarded jump once per seek: only the 'seeking' arm logs, so the
    // paired 'seeked' event never duplicates the line. Reset behavior unchanged.
    if (event?.type === 'seeking' && sampler.videoRef) {
      const from = sampler.lastMediaTime;
      const to = sampler.videoRef.currentTime;
      if (to !== from) {
        console.warn(`[Echo360 Speed Control] Seek detected: media time ${from.toFixed(2)}s to ${to.toFixed(2)}s; segment discarded and baseline reset.`);
      }
    }
    resetSamplerBaseline(sampler.videoRef, Date.now());
  }

  function resetSamplerBaseline(video: HTMLVideoElement | null, nowMs: number): void {
    if (video !== sampler.videoRef) {
      // This function owns the seek-listener lifecycle: the 'seeking'/'seeked'
      // listeners move with videoRef and are never attached at init time (the
      // video may not exist yet and Echo360 can replace the element).
      if (sampler.videoRef) {
        sampler.videoRef.removeEventListener('seeking', samplerSeekReset);
        sampler.videoRef.removeEventListener('seeked', samplerSeekReset);
      }
      if (video) {
        video.addEventListener('seeking', samplerSeekReset);
        video.addEventListener('seeked', samplerSeekReset);
      }
      sampler.videoRef = video;
    }
    sampler.lastMediaTime = video ? video.currentTime : 0;
    sampler.lastWallMs = nowMs;
  }

  function flushTimeSavedBatch(): void {
    const savedSecondsDelta = sampler.batchSaved;
    const sampledWallSeconds = sampler.batchWallMs / 1000;
    sampler.batchSaved = 0;
    sampler.batchWallMs = 0;
    // Empty and zero batches are never posted (playback at or below 1x saves nothing).
    if (savedSecondsDelta <= 0 || sampledWallSeconds <= 0) return;
    window.postMessage({
      type: 'TIME_SAVED_DELTA',
      savedSecondsDelta,
      sampledWallSeconds
    } as SpeedMessage, '*');
  }

  function maybeFlushBatch(): void {
    if (sampler.batchWallMs >= 10000) flushTimeSavedBatch();
  }

  function sampleTimeSaved(): void {
    const video = document.querySelector<HTMLVideoElement>('video');
    const nowMs = Date.now();
    if (!video || video.paused || video.seeking || video !== sampler.videoRef) {
      resetSamplerBaseline(video, nowMs); // no accrual across any reset condition
      return;
    }
    const mediaDelta = video.currentTime - sampler.lastMediaTime;
    const wallDelta = (nowMs - sampler.lastWallMs) / 1000;
    resetSamplerBaseline(video, nowMs); // baseline always advances, checks or not
    if (mediaDelta < 0 || wallDelta <= 0) {
      console.warn(`[Echo360 Speed Control] Dropped time-saved sample: media delta ${mediaDelta.toFixed(2)}s over ${wallDelta.toFixed(2)}s wall (backward time or clock weirdness).`);
      return;
    }
    if (mediaDelta > wallDelta * 4 * 1.25) {
      // Impossible above the 4x cap even with slack. Long deltas from background
      // throttling pass this check: media and wall time grow together there.
      console.warn(`[Echo360 Speed Control] Dropped implausible media delta ${mediaDelta.toFixed(2)}s over ${wallDelta.toFixed(2)}s wall.`);
      return;
    }
    const saved = Math.max(0, mediaDelta - wallDelta); // (s-1) x wall at constant speed s; 0 at or below 1x
    sampler.batchSaved += saved;
    sampler.batchWallMs += wallDelta * 1000;
    maybeFlushBatch();
  }

  window.addEventListener('pagehide', () => {
    flushTimeSavedBatch(); // best-effort; at most one batch window lost
  });

  function applySlowSpeedFilter(): void {
    const items = document.querySelectorAll<HTMLElement>('#playback-speed-menu li[data-custom-speed]');
    items.forEach(item => {
      const speed = parseFloat(item.getAttribute('data-custom-speed') || '0');
      item.style.display = (hideSlowSpeeds && speed < 1) ? 'none' : '';
    });
  }

  const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate')!;

  Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
    get: function(this: HTMLMediaElement) {
      const actualSpeed = originalDescriptor.get!.call(this);
      if (enforceSpeed && this.tagName === 'VIDEO') {
        return targetSpeed;
      }
      return actualSpeed;
    },
    set: function(this: HTMLMediaElement, value: number) {
      if (enforceSpeed && this.tagName === 'VIDEO' && targetSpeed > 2) {
        if (value === targetSpeed || value > 2) {
          originalDescriptor.set!.call(this, value);
          if (value > 2) {
            console.log(`[Echo360 Speed Control] Property descriptor: accepting speed ${value.toFixed(2)}x (target was ${targetSpeed.toFixed(2)}x)`);
            targetSpeed = value;
            // The only observation hook besides setSpeed. monitorSpeedChanges is
            // deliberately not hooked: it reads the overridden playbackRate getter,
            // which returns targetSpeed while enforcement is on, so the monitor can
            // only ever observe the already enforced value.
            noteAppliedSpeed(value);
          }
        } else {
          console.log(`[Echo360 Speed Control] Property descriptor: Echo360 attempted to set ${value.toFixed(2)}x, enforcing ${targetSpeed.toFixed(2)}x instead`);
          originalDescriptor.set!.call(this, targetSpeed);
        }
      } else {
        originalDescriptor.set!.call(this, value);
        // Page-driven speeds applied without enforcement are still observed speeds
        // (F6 criterion 3, C3): note them so the toggle always has somewhere to go.
        // The tagName guard keeps audio elements out; the finiteness guard keeps a
        // hostile or buggy NaN from being remembered and later fed to setSpeed.
        if (this.tagName === 'VIDEO' && Number.isFinite(value)) {
          noteAppliedSpeed(value);
        }
      }
    },
    configurable: true
  });

  function createOverlayElement(): HTMLElement | null {
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
      color: #46B864;
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

  function showSpeedOverlay(speed: number, phrase?: string, retryCount = 0): void {
    if (!speedOverlay) {
      speedOverlay = createOverlayElement();
      if (!speedOverlay) {
        // Body not ready, retry with exponential backoff (max 5 retries)
        if (retryCount < 5) {
          const delay = 100 * Math.pow(2, retryCount);
          setTimeout(() => showSpeedOverlay(speed, phrase, retryCount + 1), delay);
          return;
        }
        console.error('[Echo360 Speed Control] Could not create overlay after retries, document.body still not available');
        return;
      }
    }

    // One overlay grammar (ADR-9): `<speed phrase>, <remaining at the new speed>`,
    // with the remaining half omitted for no-video, non-finite, or ended cases.
    const head = phrase ?? `${speed.toFixed(2)}x`;
    const video = document.querySelector<HTMLVideoElement>('video');
    let text = head;
    if (video && classifyDuration(video.duration) === 'finite' && !video.ended) {
      const remaining = (video.duration - video.currentTime) / speed;
      if (remaining > 0) text = `${head}, ${etaMainPart(remaining)}`;
    }
    speedOverlay.textContent = text;
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

  function updateSpeedButton(speed: number, retryCount = 0): void {
    // Use stable data-testid selector instead of minified classes
    const speedButton = document.querySelector('[data-testid="playback-speed-button"]') as HTMLElement;
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
        speedSpan.style.color = '#46B864';
        speedSpan.setAttribute('title', 'Speed above Echo360 native cap');
      } else {
        // S1: clear our override so Echo360's default styling shows through.
        speedSpan.style.color = '';
        speedSpan.removeAttribute('title');
      }
    }
  }

  (window as any).setSpeed = function(speed: number): string {
    // One drift enforcer at a time: cancel the previous interval first, so a
    // rapid toggle never leaves an old enforcer pushing the prior speed against
    // the new one for the rest of its 20 ticks.
    if (driftEnforcer !== null) {
      clearInterval(driftEnforcer);
      driftEnforcer = null;
    }
    const requestedSpeed = speed;
    speed = Math.min(4, Math.max(0.25, speed));
    if (requestedSpeed !== speed) {
      console.log(`[Echo360 Speed Control] Clamped requested ${requestedSpeed}x to ${speed}x (allowed range 0.25 to 4).`);
    }
    console.log(`[Echo360 Speed Control] setSpeed called: ${speed.toFixed(2)}x (previous target: ${targetSpeed.toFixed(2)}x)`);

    targetSpeed = speed;
    enforceSpeed = true;
    noteAppliedSpeed(speed);

    showSpeedOverlay(speed);
    updateSpeedButton(speed);

    const videos = document.querySelectorAll<HTMLVideoElement>('video');
    console.log(`[Echo360 Speed Control] Found ${videos.length} video element(s) to update`);

    videos.forEach((video, index) => {
      const currentSpeed = originalDescriptor.get!.call(video);
      console.log(`[Echo360 Speed Control] Video ${index}: current speed ${currentSpeed.toFixed(2)}x → setting to ${speed.toFixed(2)}x`);
      originalDescriptor.set!.call(video, speed);
    });

    // Notify content script about speed change
    window.postMessage({
      type: 'SPEED_CHANGED',
      speed: speed
    } as SpeedMessage, '*');

    let count = 0;
    const enforcer = setInterval(() => {
      document.querySelectorAll<HTMLVideoElement>('video').forEach(video => {
        const current = originalDescriptor.get!.call(video);
        if (current !== speed) {
          console.log(`[Echo360 Speed Control] Speed drift detected: ${current.toFixed(2)}x → re-enforcing ${speed.toFixed(2)}x`);
          originalDescriptor.set!.call(video, speed);
        }
      });
      count++;
      if (count > 20) {
        clearInterval(enforcer);
        // Only release the module handle if it still points at this interval;
        // a newer setSpeed may have replaced it already.
        if (driftEnforcer === enforcer) driftEnforcer = null;
      }
    }, 250);
    driftEnforcer = enforcer;

    console.log(`[Echo360 Speed Control] Speed successfully set to ${speed.toFixed(2)}x`);
    return `Speed set to ${speed}x`;
  };

  (window as any).resetSpeed = function(): string {
    enforceSpeed = false;
    targetSpeed = 1.0;
    return 'Speed control released';
  };

  function noteAppliedSpeed(s: number): void {
    // Only speeds in the applicable range are remembered. Out-of-range values
    // (a page-driven 0 used as an alternate pause, or anything above 4) are
    // rejected rather than clamped, so the last good speed survives and the
    // restore overlay never announces a value setSpeed would not apply.
    if (s !== 1 && s >= 0.25 && s <= 4) previousStudySpeed = s;
  }

  function toggleStudySpeed(): void {
    const video = document.querySelector<HTMLVideoElement>('video');
    if (!video) return;
    const current = video.playbackRate;
    if (current !== 1) {
      // Capture before setSpeed(1) runs; the capture-first ordering is the contract (D6).
      const remembered = current;
      (window as any).setSpeed(1);
      previousStudySpeed = remembered;
      showSpeedOverlay(1, 'Switched to 1x');
    } else if (previousStudySpeed !== null) {
      (window as any).setSpeed(previousStudySpeed);
      showSpeedOverlay(previousStudySpeed, `Returned to ${previousStudySpeed.toFixed(2)}x`);
    }
    // At 1x with nothing remembered: silent no-op by design (D6), deliberately unlogged.
  }

  // Shared format rule (ADR-8): floor-based, Nm from 60 s, Nh Nm from 3600 s.
  // Below 60 s both surfaces are hidden; the function still answers 0m defensively.
  function formatTimeSaved(totalSeconds: number): string {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    if (h >= 1) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function buildTimeSavedStatRow(): HTMLDivElement {
    const row = document.createElement('div');
    row.setAttribute('data-custom-stat', 'true');
    row.style.cssText = `
      align-items: center;
      justify-content: center;
      gap: 4px;
      font-size: 11px;
      color: rgba(255, 255, 255, 0.55);
    `;
    const label = document.createElement('span');
    label.textContent = 'Time saved: ';
    const value = document.createElement('span');
    value.setAttribute('data-custom-stat-value', 'true');
    value.style.cssText = 'color: #46B864; font-weight: 600;';
    row.appendChild(label);
    row.appendChild(value);
    return row;
  }

  function renderTimeSavedStatRow(row: HTMLElement): void {
    const value = row.querySelector<HTMLElement>('[data-custom-stat-value="true"]');
    if (value) value.textContent = formatTimeSaved(timeSavedTotalSeconds);
    // Hidden below the 60 s threshold; display none leaves no phantom grid gap.
    // The hidden property mirrors the state for queries and assistive tech; the
    // display toggle does the layout work since the row's inline flex would
    // otherwise override the UA [hidden] rule.
    row.hidden = timeSavedTotalSeconds < 60;
    row.style.display = timeSavedTotalSeconds >= 60 ? 'flex' : 'none';
  }

  function updateTimeSavedStat(): void {
    const cta = document.querySelector<HTMLElement>('[data-custom-cta="true"]');
    if (!cta) return; // footer not built yet; the builder renders from the retained total
    let row = cta.querySelector<HTMLElement>('[data-custom-stat="true"]');
    if (!row) {
      // A footer built without the row (rebuilt by Echo360 mid-update): create it
      // in place as the middle grid row, between the report and Ko-fi pills.
      row = buildTimeSavedStatRow();
      cta.insertBefore(row, cta.children[1] ?? null);
    }
    renderTimeSavedStatRow(row);
  }

  function addCustomSpeedOptions(retryCount = 0): void {
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

    const video = document.querySelector<HTMLVideoElement>('video');
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
    const makeKey = (text: string): HTMLSpanElement => {
      const el = document.createElement('span');
      el.textContent = text;
      el.style.cssText = KEY_CSS;
      return el;
    };
    const makeRow = (emoji: string, secondKey: string, trailingLabel?: string): HTMLDivElement => {
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
      if (trailingLabel) {
        row.appendChild(document.createTextNode(trailingLabel));
      }
      return row;
    };

    const hintLabel = document.createElement('div');
    hintLabel.textContent = 'Shortcuts';
    hintLabel.style.fontWeight = '600';
    hintItem.appendChild(hintLabel);
    hintItem.appendChild(makeRow('🐌', '<'));
    hintItem.appendChild(makeRow('⚡', '>'));
    hintItem.appendChild(makeRow('🔁', 'R', 'Toggle 1x / previous speed'));

    menu.appendChild(hintItem);

    const allSpeeds = [4, 3.75, 3.5, 3.25, 3, 2.75, 2.5, 2.25, 2, 1.75, 1.5, 1.25, 1, 0.75, 0.5, 0.25];

    allSpeeds.forEach(speed => {
      // Clone the template item to inherit all styles automatically
      const newOption = templateItem.cloneNode(true) as HTMLElement;

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
      } else {
        // Fallback: append new text node
        newOption.appendChild(document.createTextNode(speedText));
      }

      // C2: announce >2x speeds explicitly to AT and as tooltip
      if (speed > 2) {
        newOption.setAttribute('aria-label', `${speed}x, above Echo360's native cap`);
        newOption.setAttribute('title', 'Speed above Echo360 native cap');
      }

      newOption.addEventListener('click', function(e) {
        e.stopPropagation();

        console.log(`[Echo360 Speed Control] Menu item clicked: ${speed.toFixed(2)}x`);
        (window as any).setSpeed(speed);

        window.postMessage({
          type: 'SPEED_CHANGED',
          speed: speed
        } as SpeedMessage, '*');

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
          const menu = document.querySelector('#playback-speed-menu') as HTMLElement;
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
      background: ${hideSlowSpeeds ? '#46B864' : '#8C0047'};
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
      toggleSwitch.style.background = hideSlowSpeeds ? '#46B864' : '#8C0047';
      toggleKnob.style.transform = `translateX(${hideSlowSpeeds ? '14px' : '0'})`;
      applySlowSpeedFilter();
      window.postMessage({
        type: 'HIDE_SLOW_SPEEDS_CHANGED',
        hideSlowSpeeds
      } as SpeedMessage, '*');
    });

    menu.appendChild(toggleItem);

    // Footer CTA: report pill above, support pill below.
    // Single-column grid so both pills take the width of the wider one.
    const ctaItem = document.createElement('li');
    ctaItem.setAttribute('role', 'presentation');
    ctaItem.setAttribute('data-custom-cta', 'true');
    ctaItem.style.cssText = `
      padding: 10px 16px 12px;
      list-style: none;
      display: grid;
      grid-auto-flow: row;
      gap: 8px;
      justify-content: stretch;
    `;

    const PILL_BASE_CSS = `
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 6px 14px;
      border-radius: 16px;
      text-decoration: none;
      font-size: 11px;
      font-weight: 600;
      outline: none;
    `;

    // Report pill: ink green on a tint of itself
    const ctaLink = document.createElement('a');
    ctaLink.href = 'https://www.linkedin.com/in/wei-chong/';
    ctaLink.target = '_blank';
    ctaLink.rel = 'noopener noreferrer';
    ctaLink.style.cssText = PILL_BASE_CSS + `
      background: rgba(70, 184, 100, 0.12);
      border: 1px solid #46B864;
      color: #46B864;
      transition: background-color 0.15s;
    `;
    ctaLink.addEventListener('mouseenter', () => { ctaLink.style.background = 'rgba(70, 184, 100, 0.22)'; });
    ctaLink.addEventListener('mouseleave', () => { ctaLink.style.background = 'rgba(70, 184, 100, 0.12)'; });
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

    // Time-saved stat: middle grid row, ALWAYS created with the footer and
    // hidden below 60 s, so a first-session total can appear without a rebuild.
    const statRow = buildTimeSavedStatRow();
    renderTimeSavedStatRow(statRow);
    ctaItem.appendChild(statRow);

    // Support pill: filled, white label. Hover darkens so contrast rises rather than falls.
    const KOFI_FILL = '#269644';
    const KOFI_FILL_HOVER = '#22853C';
    const kofiLink = document.createElement('a');
    kofiLink.href = 'https://ko-fi.com/D1D31C0IQC';
    kofiLink.target = '_blank';
    kofiLink.rel = 'noopener noreferrer';
    kofiLink.setAttribute('aria-label', 'Support on Ko-fi');
    kofiLink.style.cssText = PILL_BASE_CSS + `
      background: ${KOFI_FILL};
      border: 1px solid ${KOFI_FILL};
      color: #FFFFFF;
      box-shadow: 0 2px 4px rgba(38, 150, 68, 0.35);
      transition: background-color 0.15s, border-color 0.15s, box-shadow 0.2s;
    `;
    kofiLink.addEventListener('mouseenter', () => {
      kofiLink.style.background = KOFI_FILL_HOVER;
      kofiLink.style.borderColor = KOFI_FILL_HOVER;
      kofiLink.style.boxShadow = '0 4px 12px rgba(38, 150, 68, 0.55)';
    });
    kofiLink.addEventListener('mouseleave', () => {
      kofiLink.style.background = KOFI_FILL;
      kofiLink.style.borderColor = KOFI_FILL;
      kofiLink.style.boxShadow = '0 2px 4px rgba(38, 150, 68, 0.35)';
    });
    if (kofiIconUrl) {
      const kofiIcon = document.createElement('img');
      kofiIcon.src = kofiIconUrl;
      kofiIcon.alt = '';
      kofiIcon.width = 14;
      kofiIcon.height = 14;
      kofiIcon.style.display = 'block';
      kofiIcon.addEventListener('error', () => {
        console.error(`[Echo360 Speed Control] Ko-fi icon failed to load from ${kofiIconUrl}. Confirm assets/images/kofi.png is in web_accessible_resources and present in dist/.`);
        kofiIcon.remove();
      });
      kofiLink.appendChild(kofiIcon);
    } else {
      console.warn('[Echo360 Speed Control] Ko-fi pill rendered without an icon: kofiIconUrl was never set by the content script.');
    }
    const kofiText = document.createElement('span');
    kofiText.textContent = 'Buy me a coffee';
    kofiLink.appendChild(kofiText);
    ctaItem.appendChild(kofiLink);

    menu.appendChild(ctaItem);
  }

  const menuObserver = new MutationObserver((mutations) => {
    if (document.querySelector('#playback-speed-menu')) {
      addCustomSpeedOptions();
    }
  });

  function startObserving(): void {
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

  const menuRefresher = setInterval(() => {
    if (document.querySelector('#playback-speed-menu')) {
      addCustomSpeedOptions();
    }

    // Ensure speed button span stays green (fallback) — only at >2x
    const speedButton = document.querySelector('[data-testid="playback-speed-button"]') as HTMLElement;
    if (speedButton) {
      const spans = speedButton.querySelectorAll('span');
      const speedSpan = spans[1];
      if (speedSpan) {
        if (targetSpeed > 2) {
          if (!speedSpan.style.color) {
            speedSpan.style.color = '#46B864';
          }
        } else {
          // S1-4: don't let the fallback loop re-green at ≤2x.
          if (speedSpan.style.color === 'rgb(70, 184, 100)' || speedSpan.style.color === '#46B864') {
            speedSpan.style.color = '';
          }
        }
      }
    }
  }, 1000);

  function isEditableTarget(e: KeyboardEvent): boolean {
    const el = (e.composedPath ? e.composedPath()[0] : e.target) as HTMLElement;
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      const nonTextTypes = ['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image', 'hidden'];
      return !nonTextTypes.includes((el as HTMLInputElement).type);
    }
    return false;
  }

  function handleKeyboardShortcuts(event: KeyboardEvent): void {
    if (isEditableTarget(event)) return;
    if (!shortcutsEnabled) return;

    if (event.shiftKey && (event.key === '<' || event.key === ',')) {
      event.preventDefault();
      const video = document.querySelector<HTMLVideoElement>('video');
      if (video) {
        const currentSpeed = video.playbackRate;
        const newSpeed = Math.max(0.25, currentSpeed - 0.25);
        console.log(`[Echo360 Speed Control] Keyboard shortcut (decrease): ${currentSpeed.toFixed(2)}x → ${newSpeed.toFixed(2)}x`);
        (window as any).setSpeed(newSpeed);
      }
    } else if (event.shiftKey && (event.key === '>' || event.key === '.')) {
      event.preventDefault();
      const video = document.querySelector<HTMLVideoElement>('video');
      if (video) {
        const currentSpeed = video.playbackRate;
        const newSpeed = Math.min(4, currentSpeed + 0.25);
        console.log(`[Echo360 Speed Control] Keyboard shortcut (increase): ${currentSpeed.toFixed(2)}x → ${newSpeed.toFixed(2)}x`);
        (window as any).setSpeed(newSpeed);
      }
    } else if (event.shiftKey && (event.key === 'R' || event.key === 'r')) {
      // Shift+r yields key 'R' with shiftKey true on most layouts; match both cases.
      event.preventDefault();
      toggleStudySpeed();
    }
  }

  document.addEventListener('keydown', handleKeyboardShortcuts);

  let speedMonitor: ReturnType<typeof setInterval> | null = null;
  function monitorSpeedChanges(): void {
    let lastSpeed = 1.0;
    speedMonitor = setInterval(() => {
      const video = document.querySelector<HTMLVideoElement>('video');
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
          } as SpeedMessage, '*');
        }
      }
    }, 500);
  }

  monitorSpeedChanges();

  window.addEventListener('beforeunload', () => {
    clearInterval(menuRefresher);
    if (speedMonitor) clearInterval(speedMonitor);
    menuObserver.disconnect();
    if (etaTickHandle !== undefined) {
      clearInterval(etaTickHandle);
      etaTickHandle = undefined;
    }
  });

  window.addEventListener('message', (event: MessageEvent<SpeedMessage>) => {
    if (event.source !== window) return;

    if (event.data.type === 'SET_ECHO_SPEED') {
      console.log(`[Echo360 Speed Control] Message received SET_ECHO_SPEED: ${event.data.speed?.toFixed(2)}x`);
      (window as any).setSpeed(event.data.speed);
    } else if (event.data.type === 'GET_ECHO_SPEED') {
      const video = document.querySelector<HTMLVideoElement>('video');
      const currentSpeed = video ? video.playbackRate : 1;
      const rawDuration = video ? video.duration : NaN;
      const rawCurrentTime = video ? video.currentTime : 0;
      window.postMessage({
        type: 'CURRENT_ECHO_SPEED',
        speed: currentSpeed,
        duration: rawDuration,
        currentTime: rawCurrentTime,
        paused: video ? video.paused : false,
        seeking: video ? video.seeking : false,
        requestId: event.data.requestId
      } as SpeedMessage, '*');
    } else if (event.data.type === 'SET_SHORTCUTS_ENABLED') {
      console.log(`[Echo360 Speed Control] Message received SET_SHORTCUTS_ENABLED: ${event.data.enabled}`);
      shortcutsEnabled = event.data.enabled!;
    } else if (event.data.type === 'SET_ASSET_URLS') {
      if (typeof event.data.linkedinIcon === 'string') {
        linkedinIconUrl = event.data.linkedinIcon;
      }
      if (typeof event.data.kofiIcon === 'string') {
        kofiIconUrl = event.data.kofiIcon;
      } else {
        console.warn('[Echo360 Speed Control] SET_ASSET_URLS carried no kofiIcon. Check that assets/images/kofi.png is listed in web_accessible_resources; the Ko-fi pill will render without its icon.');
      }
    } else if (event.data.type === 'SET_HIDE_SLOW_SPEEDS') {
      hideSlowSpeeds = event.data.hideSlowSpeeds === true;
      applySlowSpeedFilter();
    } else if (event.data.type === 'TOGGLE_STUDY_SPEED') {
      toggleStudySpeed();
    } else if (event.data.type === 'SET_TIME_SAVED_TOTAL') {
      const total = event.data.totalSeconds;
      if (typeof total !== 'number' || !Number.isFinite(total) || total < 0) {
        console.warn(`[Echo360 Speed Control] Ignored SET_TIME_SAVED_TOTAL with invalid totalSeconds: ${String(total)}.`);
      } else if (total < timeSavedTotalSeconds) {
        // The total is monotonic (business rule 5); a lower value is a stale
        // handshake read arriving after a fresher onChanged delivery.
        console.warn(`[Echo360 Speed Control] Ignored stale SET_TIME_SAVED_TOTAL ${total}s; retaining newer ${timeSavedTotalSeconds}s.`);
      } else {
        timeSavedTotalSeconds = total;
        updateTimeSavedStat();
      }
    }
  });

  injectEtaSpan();
  startEtaTicker();

  console.log('[Echo360 Speed Control] Extension injected and initialized (injector-simple.js)');
})();
