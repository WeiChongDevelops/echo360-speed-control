/**
 * Service worker for handling communication between popup and content scripts
 */

interface RuntimeMessage {
  action: string;
  speed?: number;
  tabId?: number;
}

// M6: Migrate legacy speed_<hostname> keys to canonical speed_echo360.
// Runs on both 'install' and 'update' to be idempotent.
chrome.runtime.onInstalled.addListener(async (_details: chrome.runtime.InstalledDetails) => {
  try {
    const all = await chrome.storage.sync.get(null);

    const legacyKeys = Object.keys(all).filter(
      k => k.startsWith('speed_') && k !== 'speed_echo360'
    );

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
      .map(k => ({ key: k, value: typeof all[k] === 'number' ? (all[k] as number) : Number(all[k]) }))
      .filter(c => Number.isFinite(c.value))
      .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));

    if (candidates.length === 0) {
      console.warn('[Echo360 Speed Control] Found legacy speed keys but none parseable. Skipping migration.');
      return;
    }

    const winner = candidates[0];
    console.log(
      `[Echo360 Speed Control] Migrating ${legacyKeys.length} legacy speed key(s); ` +
      `selected ${winner.value} from ${winner.key}.`
    );

    await chrome.storage.sync.set({ 'speed_echo360': winner.value });
    await chrome.storage.sync.remove(legacyKeys);
  } catch (err) {
    console.warn('[Echo360 Speed Control] Migration failed:', err);
  }
});

// Relay speed change messages to all connected popups
chrome.runtime.onMessage.addListener((request: RuntimeMessage, sender, sendResponse) => {
  if (request.action === 'speedChanged') {
    // Broadcast to all extension views (including popup)
    chrome.runtime.sendMessage({
      action: 'updateSpeed',
      speed: request.speed,
      tabId: sender.tab?.id
    });
  }
});
