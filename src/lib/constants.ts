/**
 * Constants and configuration values for the Echo360 Speed Control extension
 */

// Message types for communication between components
export const MESSAGE_TYPES = {
  SET_SPEED: 'SET_ECHO_SPEED',
  GET_SPEED: 'GET_ECHO_SPEED',
  CURRENT_SPEED: 'CURRENT_ECHO_SPEED',
  SET_SHORTCUTS: 'SET_SHORTCUTS_ENABLED',
  SET_PLAYBACK: 'SET_PLAYBACK_SPEED',
  GET_PLAYBACK: 'GET_PLAYBACK_SPEED',
  CURRENT_PLAYBACK: 'CURRENT_SPEED'
} as const;

// Chrome runtime message actions
export const ACTIONS = {
  SET_SPEED: 'setSpeed',
  GET_SPEED: 'getSpeed',
  UPDATE_SHORTCUTS: 'updateShortcuts'
} as const;

// Speed control configuration
export const SPEED_CONFIG = {
  MIN: 0.25,
  MAX: 5.0,
  STEP: 0.25,
  DEFAULT: 1.0,
  PRESETS: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3] as const
} as const;

// Storage keys
export const STORAGE_KEYS = {
  THEME: 'theme',
  SHORTCUTS_ENABLED: 'shortcutsEnabled',
  SPEED_PREFIX: 'speed_'
} as const;

// Default values
export const DEFAULTS = {
  THEME: 'dark',
  SHORTCUTS_ENABLED: true,
  SPEED: 1.0
} as const;

// UI configuration
export const UI_CONFIG = {
  OVERLAY_TIMEOUT: 2000,
  OVERLAY_FADE_TIME: 300,
  STATUS_TIMEOUT: 2000,
  RESPONSE_TIMEOUT: 1000,
  ENFORCE_INTERVAL: 250,
  ENFORCE_COUNT: 20,
  VIDEO_CHECK_INTERVAL: 500
} as const;

// Keyboard shortcuts
export const SHORTCUTS = {
  DECREASE: ['<', ','],
  INCREASE: ['>', '.'],
  RESET: ['r', 'R'],
  TOGGLE_THEME: ['t', 'T']
} as const;

// Error types
export const ERROR_TYPES = {
  NO_VIDEO: 'no-video',
  NOT_CONNECTED: 'not-connected',
  INVALID_PAGE: 'invalid-page'
} as const;

// Type exports
export type MessageType = typeof MESSAGE_TYPES[keyof typeof MESSAGE_TYPES];
export type Action = typeof ACTIONS[keyof typeof ACTIONS];
export type ErrorType = typeof ERROR_TYPES[keyof typeof ERROR_TYPES];
export type Theme = 'dark' | 'light';
