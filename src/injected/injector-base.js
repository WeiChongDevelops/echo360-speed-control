/**
 * Base functionality shared between injector scripts
 */

class SpeedController {
  constructor() {
    this.targetSpeed = 1.0;
    this.shortcutsEnabled = true;
    this.speedOverlay = null;
    this.overlayTimeout = null;
    
    // Configuration
    this.config = {
      MIN_SPEED: 0.25,
      MAX_SPEED: 5.0,
      SPEED_STEP: 0.25,
      OVERLAY_TIMEOUT: 2000,
      OVERLAY_FADE_TIME: 300
    };
    
    this.messageTypes = {
      SET_SPEED: 'SET_ECHO_SPEED',
      GET_SPEED: 'GET_ECHO_SPEED',
      RESPONSE_SPEED: 'CURRENT_ECHO_SPEED',
      SET_SHORTCUTS: 'SET_SHORTCUTS_ENABLED'
    };
  }

  /**
   * Initialize the speed controller
   */
  init() {
    this.setupMessageListener();
    this.setupKeyboardShortcuts();
  }

  /**
   * Create speed overlay element
   */
  createOverlayElement() {
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

  /**
   * Show speed overlay with current speed
   */
  showSpeedOverlay(speed) {
    if (!this.speedOverlay) {
      this.speedOverlay = this.createOverlayElement();
    }
    
    this.speedOverlay.textContent = `${speed.toFixed(2)}x`;
    this.speedOverlay.style.opacity = '1';
    
    if (this.overlayTimeout) {
      clearTimeout(this.overlayTimeout);
    }
    
    this.overlayTimeout = setTimeout(() => {
      if (this.speedOverlay) {
        this.speedOverlay.style.opacity = '0';
        setTimeout(() => {
          if (this.speedOverlay && this.speedOverlay.style.opacity === '0') {
            this.speedOverlay.remove();
            this.speedOverlay = null;
          }
        }, this.config.OVERLAY_FADE_TIME);
      }
    }, this.config.OVERLAY_TIMEOUT);
  }

  /**
   * Get current video element
   */
  getCurrentVideo() {
    return document.querySelector('video');
  }

  /**
   * Get all video elements with Echo360 selectors
   */
  getAllVideos() {
    return document.querySelectorAll('video, video.leader, video.sc-bUyWVT, video[data-test="leader"], video[role="region"]');
  }

  /**
   * Set speed on video element(s)
   * @param {number} speed - Speed to set
   */
  setSpeed(speed) {
    this.targetSpeed = speed;
    this.showSpeedOverlay(speed);
    // Implementation specific to each injector type
  }

  /**
   * Handle keyboard shortcuts
   */
  handleKeyboardShortcuts(event) {
    if (!this.shortcutsEnabled) return;
    
    // Shift+< to decrease speed
    if (event.shiftKey && (event.key === '<' || event.key === ',')) {
      event.preventDefault();
      const video = this.getCurrentVideo();
      if (video) {
        const currentSpeed = video.playbackRate;
        const newSpeed = Math.max(this.config.MIN_SPEED, currentSpeed - this.config.SPEED_STEP);
        this.setSpeed(newSpeed);
      }
    }
    // Shift+> to increase speed
    else if (event.shiftKey && (event.key === '>' || event.key === '.')) {
      event.preventDefault();
      const video = this.getCurrentVideo();
      if (video) {
        const currentSpeed = video.playbackRate;
        const newSpeed = Math.min(this.config.MAX_SPEED, currentSpeed + this.config.SPEED_STEP);
        this.setSpeed(newSpeed);
      }
    }
  }

  /**
   * Setup keyboard shortcut listener
   */
  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => this.handleKeyboardShortcuts(e));
  }

  /**
   * Setup message listener for communication with content script
   */
  setupMessageListener() {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      
      const { type, speed, enabled } = event.data;
      
      switch (type) {
        case this.messageTypes.SET_SPEED:
          this.setSpeed(speed);
          break;
          
        case this.messageTypes.GET_SPEED:
          const video = this.getCurrentVideo();
          window.postMessage({
            type: this.messageTypes.RESPONSE_SPEED,
            speed: video ? video.playbackRate : 1.0
          }, '*');
          break;
          
        case this.messageTypes.SET_SHORTCUTS:
          this.shortcutsEnabled = enabled;
          break;
      }
    });
  }

  /**
   * Clamp value between min and max
   */
  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
}