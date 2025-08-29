// This script runs in the page context and can override native APIs
(function() {
  'use strict';


  let targetSpeed = 1.0;
  let videoElements = new WeakSet();

  // Override the playbackRate property descriptor
  const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
  
  Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
    get: function() {
      return originalDescriptor.get.call(this);
    },
    set: function(value) {
      // If this is a video element and we're trying to set a restricted speed
      if (this.tagName === 'VIDEO') {
        // Allow our custom speeds, ignore Echo360's attempts to reset
        if (videoElements.has(this) && value <= 2 && targetSpeed > 2) {
          return originalDescriptor.set.call(this, targetSpeed);
        }
        // Track this video element
        if (!videoElements.has(this)) {
          videoElements.add(this);
          setupVideoElement(this);
        }
      }
      return originalDescriptor.set.call(this, value);
    },
    configurable: true
  });

  // Setup individual video element
  function setupVideoElement(video) {
    
    // Remove existing ratechange listeners by cloning the element
    // This is aggressive but effective
    const clonedVideo = video.cloneNode(true);
    video.parentNode.replaceChild(clonedVideo, video);
    
    // Prevent new ratechange listeners from being effective
    const originalAddEventListener = clonedVideo.addEventListener;
    clonedVideo.addEventListener = function(type, listener, options) {
      if (type === 'ratechange') {
        return;
      }
      return originalAddEventListener.call(this, type, listener, options);
    };
  }

  // Force set playback speed
  function forceSetSpeed(speed) {
    targetSpeed = speed;
    // Try multiple selectors for Echo360's video elements
    const videos = document.querySelectorAll('video, video.leader, video.sc-bUyWVT, video[data-test="leader"], video[role="region"]');
    
    if (videos.length === 0) {
      // Retry after a delay as video might not be loaded yet
      setTimeout(() => forceSetSpeed(speed), 1000);
      return;
    }
    
    videos.forEach(video => {
      videoElements.add(video);
      
      // Remove any existing speed constraints
      if (video.playbackRate !== speed) {
        // Try multiple approaches to set the speed
        try {
          // Method 1: Direct property access
          video.playbackRate = speed;
        } catch (e) {
        }
        
        try {
          // Method 2: Using original descriptor
          originalDescriptor.set.call(video, speed);
        } catch (e) {
        }
        
        try {
          // Method 3: Using Object.defineProperty directly on the instance
          Object.defineProperty(video, 'playbackRate', {
            value: speed,
            writable: true,
            configurable: true
          });
        } catch (e) {
        }
      }
      
      // Double-check it stuck
      setTimeout(() => {
        if (video.playbackRate !== speed) {
          originalDescriptor.set.call(video, speed);
        }
      }, 100);
    });
  }

  // Listen for messages from content script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    
    if (event.data.type === 'SET_PLAYBACK_SPEED') {
      forceSetSpeed(event.data.speed);
    } else if (event.data.type === 'GET_PLAYBACK_SPEED') {
      const video = document.querySelector('video');
      window.postMessage({ 
        type: 'CURRENT_SPEED', 
        speed: video ? video.playbackRate : 1.0 
      }, '*');
    }
  });

  // Periodically enforce our speed (nuclear option)
  setInterval(() => {
    const videos = document.querySelectorAll('video, video.leader, video.sc-bUyWVT, video[data-test="leader"], video[role="region"]');
    videos.forEach(video => {
      // Always try to enforce our target speed if it's different
      if (targetSpeed !== 1.0 && video.playbackRate !== targetSpeed) {
        try {
          originalDescriptor.set.call(video, targetSpeed);
        } catch (e) {
          // Fallback to direct assignment
          video.playbackRate = targetSpeed;
        }
        videoElements.add(video);
      }
    });
  }, 500);

  // Also override common speed limiting functions if they exist
  if (window.Math) {
    const originalMin = Math.min;
    Math.min = function(...args) {
      // If this looks like a playback rate limit (has 2 or 2.0)
      if (args.length === 2 && (args[1] === 2 || args[1] === 2.0)) {
        const stack = new Error().stack;
        if (stack && stack.includes('playback')) {
          return args[0]; // Return the requested speed, not the limited one
        }
      }
      return originalMin.apply(this, args);
    };

    const originalMax = Math.max;
    Math.max = function(...args) {
      // If this looks like a minimum speed limit
      if (args.length === 2 && (args[1] === 0.25 || args[1] === 0.5)) {
        const stack = new Error().stack;
        if (stack && stack.includes('playback')) {
          return args[0];
        }
      }
      return originalMax.apply(this, args);
    };
  }

  // Add a global function for manual testing in console
  window.setEchoSpeed = function(speed) {
    forceSetSpeed(speed);
    return 'Speed set to ' + speed;
  };

  // Wait for video element and auto-detect Echo360
  function waitForVideo() {
    const checkForVideo = setInterval(() => {
      const videos = document.querySelectorAll('video');
      if (videos.length > 0) {
        videos.forEach(video => {
          // Check if this is an Echo360 video
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