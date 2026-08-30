"use strict";
/**
 * Service worker for handling communication between popup and content scripts
 */
// Serializes time-saved aggregation so interleaved read-modify-writes never
// lose an update (ADR-4). Reset on SW restart is harmless: a fresh instance
// simply starts an empty chain.
let aggregationChain = Promise.resolve();
// M6: Migrate legacy speed_<hostname> keys to canonical speed_echo360.
// Runs on both 'install' and 'update' to be idempotent.
chrome.runtime.onInstalled.addListener(async (_details) => {
    try {
        const all = await chrome.storage.sync.get(null);
        const legacyKeys = Object.keys(all).filter(k => k.startsWith('speed_') && k !== 'speed_echo360');
        const canonicalAlreadyPresent = typeof all['speed_echo360'] === 'number';
        if (canonicalAlreadyPresent) {
            if (legacyKeys.length > 0) {
                console.log(`[Echo360 Speed Control] Removing ${legacyKeys.length} stale legacy speed key(s).`);
                await chrome.storage.sync.remove(legacyKeys);
            }
            return;
        }
        if (legacyKeys.length === 0) {
            return;
        }
        const candidates = legacyKeys
            .map(k => ({ key: k, value: typeof all[k] === 'number' ? all[k] : Number(all[k]) }))
            .filter(c => Number.isFinite(c.value))
            .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
        if (candidates.length === 0) {
            console.warn('[Echo360 Speed Control] Found legacy speed keys but none parseable. Skipping migration.');
            return;
        }
        const winner = candidates[0];
        console.log(`[Echo360 Speed Control] Migrating ${legacyKeys.length} legacy speed key(s); ` +
            `selected ${winner.value} from ${winner.key}.`);
        await chrome.storage.sync.set({ 'speed_echo360': winner.value });
        await chrome.storage.sync.remove(legacyKeys);
    }
    catch (err) {
        console.warn('[Echo360 Speed Control] Migration failed:', err);
    }
});
// Relay speed change messages to all connected popups
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'speedChanged') {
        // Broadcast to all extension views (including popup)
        chrome.runtime.sendMessage({
            action: 'updateSpeed',
            speed: request.speed,
            tabId: sender.tab?.id
        });
    }
    if (request.action === 'timeSavedDelta') {
        const tabId = sender.tab?.id;
        const frameId = sender.frameId;
        aggregationChain = aggregationChain.then(async () => {
            if (tabId === undefined || frameId === undefined) {
                console.warn('[Echo360 Speed Control] Dropped time-saved delta without tab or frame metadata; sender is not a content script.');
                return;
            }
            const delta = request.savedSecondsDelta;
            if (typeof delta !== 'number' || !Number.isFinite(delta) || delta <= 0) {
                // The SW is the sole writer of totalTimeSavedSeconds; a NaN write would
                // poison the total permanently (there is no reset UI).
                console.warn(`[Echo360 Speed Control] Dropped time-saved delta with invalid savedSecondsDelta: ${String(delta)}.`);
                return;
            }
            const key = `timeSavedSource_${tabId}`;
            const sess = await chrome.storage.session.get(key);
            const src = sess[key];
            const now = Date.now();
            if (src && src.frameId !== frameId && now - src.lastAcceptedAt < 30000) {
                // D4: one accepted producer per tab; takeover only after 30 s of silence.
                console.warn(`[Echo360 Speed Control] Rejected time-saved delta from tab ${tabId} frame ${frameId}: frame ${src.frameId} is the active source.`);
                return;
            }
            const cur = await chrome.storage.local.get('totalTimeSavedSeconds');
            const total = (typeof cur.totalTimeSavedSeconds === 'number' ? cur.totalTimeSavedSeconds : 0)
                + delta;
            await chrome.storage.local.set({ totalTimeSavedSeconds: total });
            // Arbitration commits only AFTER the total write succeeds, so a failed
            // aggregation never locks a healthy frame out for 30 s.
            await chrome.storage.session.set({ [key]: { frameId, lastAcceptedAt: now } });
        }).catch(err => {
            // Catch keeps the chain alive for the next delta.
            console.warn('[Echo360 Speed Control] Time-saved aggregation failed:', err);
        });
        aggregationChain.finally(() => sendResponse({ ok: true }));
        return true; // async sendResponse (QUAL-001)
    }
});
