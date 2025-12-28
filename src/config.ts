// Application configuration

export type KeyOperation =
  | `tab:${'next' | 'previous' | 'close' | 'new' | 'restore'}`
  | 'hints:activate'
  | 'hints:newTab'
  | 'hints:backgroundTab'
  | 'scroll:top'
  | 'scroll:bottom'
  | 'scroll:half-down'
  | 'scroll:half-up'
  | 'focus:input';

export type KeyBinding = {
  readonly keys: string;
  readonly operation: KeyOperation;
  readonly description: string;
};

export type KeyBindingConfig = {
  readonly timeout: number;
  readonly bindings: readonly KeyBinding[];
};

export type Settings = {
  readonly stealFocusOnLoad: boolean;
};

export type AppConfig = {
  readonly keyBindings: KeyBindingConfig;
  readonly settings: Settings;
};

export const appConfig = {
  keyBindings: {
    timeout: 500, // ms to wait for next key in sequence
    bindings: [
      // Tab operations
      { keys: 'gt', operation: 'tab:next', description: 'Next tab' },
      { keys: 'gT', operation: 'tab:previous', description: 'Previous tab' },
      { keys: 'x', operation: 'tab:close', description: 'Close tab' },
      { keys: 't', operation: 'tab:new', description: 'New tab' },
      { keys: 'X', operation: 'tab:restore', description: 'Restore closed tab' },

      // Scroll operations
      { keys: 'd', operation: 'scroll:half-down', description: 'Scroll half page down' },
      { keys: 'u', operation: 'scroll:half-up', description: 'Scroll half page up' },
      { keys: 'gg', operation: 'scroll:top', description: 'Scroll to top' },
      { keys: 'G', operation: 'scroll:bottom', description: 'Scroll to bottom' },

      // Hints
      { keys: 'f', operation: 'hints:activate', description: 'Activate link hints' },
      { keys: 'F', operation: 'hints:newTab', description: 'Open link in new tab' },
      { keys: 'gF', operation: 'hints:backgroundTab', description: 'Open link in background tab' },
    ],
  },
  settings: {
    // Prevent autofocus from stealing keyboard input on page load.
    stealFocusOnLoad: true,
  },
} as const satisfies AppConfig;
