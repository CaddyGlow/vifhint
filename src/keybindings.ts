// Vim-style key binding handler

import { keyBindingConfig, type KeyBinding } from './config';

// Trie node for efficient prefix matching
interface TrieNode {
  children: Map<string, TrieNode>;
  operation?: string;
}

// Build trie from bindings
function buildTrie(bindings: readonly KeyBinding[]): TrieNode {
  const root: TrieNode = { children: new Map() };

  for (const binding of bindings) {
    let node = root;
    for (const char of binding.keys) {
      if (!node.children.has(char)) {
        node.children.set(char, { children: new Map() });
      }
      node = node.children.get(char)!;
    }
    node.operation = binding.operation;
  }

  return root;
}

// Key sequence handler with trie-based matching
class KeySequenceHandler {
  #trie: TrieNode;
  #buffer = '';
  #timeoutId: number | null = null;
  #timeout: number;

  constructor(bindings: readonly KeyBinding[], timeout: number) {
    this.#trie = buildTrie(bindings);
    this.#timeout = timeout;
  }

  handleKey(key: string): { result: 'match' | 'partial' | 'none'; operation?: string } {
    this.#clearTimeout();
    this.#buffer += key;

    const node = this.#findNode(this.#buffer);

    if (!node) {
      // No match - try with just this key
      this.#buffer = key;
      const singleNode = this.#findNode(this.#buffer);

      if (!singleNode) {
        this.#buffer = '';
        return { result: 'none' };
      }

      if (singleNode.operation) {
        this.#buffer = '';
        return { result: 'match', operation: singleNode.operation };
      }

      this.#startTimeout();
      return { result: 'partial' };
    }

    if (node.operation) {
      this.#buffer = '';
      return { result: 'match', operation: node.operation };
    }

    // Partial match - wait for more keys
    this.#startTimeout();
    return { result: 'partial' };
  }

  reset(): void {
    this.#clearTimeout();
    this.#buffer = '';
  }

  #findNode(keys: string): TrieNode | null {
    let node = this.#trie;
    for (const char of keys) {
      const child = node.children.get(char);
      if (!child) return null;
      node = child;
    }
    return node;
  }

  #startTimeout(): void {
    this.#timeoutId = window.setTimeout(() => {
      this.#buffer = '';
    }, this.#timeout);
  }

  #clearTimeout(): void {
    if (this.#timeoutId !== null) {
      window.clearTimeout(this.#timeoutId);
      this.#timeoutId = null;
    }
  }
}

// Hint modes
type HintMode = 'normal' | 'newTab' | 'backgroundTab';

// Interface for LinkHints integration
interface LinkHintsInterface {
  isActive(): boolean;
  activate(mode?: HintMode): void;
}

// Main key bindings class
export class KeyBindings {
  #handler: KeySequenceHandler;
  #linkHints: LinkHintsInterface;

  constructor(linkHints: LinkHintsInterface) {
    this.#linkHints = linkHints;
    this.#handler = new KeySequenceHandler(
      keyBindingConfig.bindings,
      keyBindingConfig.timeout
    );
    this.#setupKeyListener();
  }

  #setupKeyListener(): void {
    document.addEventListener('keydown', (e) => {
      // Skip if LinkHints is active
      if (this.#linkHints.isActive()) return;

      // Escape should blur focused editable elements
      if (e.key === 'Escape' && this.#isEditableActive()) {
        const active = document.activeElement as HTMLElement | null;
        active?.blur();
        this.#handler.reset();
        return;
      }

      // Skip if in editable element
      if (this.#isEditableActive()) return;

      // Skip if modifier keys (except Shift for case sensitivity)
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      // Skip special keys
      if (e.key.length > 1 && e.key !== 'Escape') return;

      // Escape clears buffer
      if (e.key === 'Escape') {
        this.#handler.reset();
        return;
      }

      const result = this.#handler.handleKey(e.key);

      if (result.result === 'match' && result.operation) {
        e.preventDefault();
        e.stopPropagation();
        this.#executeOperation(result.operation);
      } else if (result.result === 'partial') {
        e.preventDefault();
        e.stopPropagation();
      }
      // 'none' - let event propagate normally
    }, true);
  }

  #executeOperation(operation: string): void {
    if (operation.startsWith('tab:')) {
      // Send to background script
      chrome.runtime.sendMessage({ type: 'tab-operation', operation });
    } else if (operation === 'hints:activate') {
      this.#linkHints.activate('normal');
    } else if (operation === 'hints:newTab') {
      this.#linkHints.activate('newTab');
    } else if (operation === 'hints:backgroundTab') {
      this.#linkHints.activate('backgroundTab');
    } else if (operation === 'scroll:top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (operation === 'scroll:bottom') {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    } else if (operation === 'scroll:half-down') {
      window.scrollBy({ top: window.innerHeight / 2, behavior: 'smooth' });
    } else if (operation === 'scroll:half-up') {
      window.scrollBy({ top: -window.innerHeight / 2, behavior: 'smooth' });
    }
  }

  #isEditableActive(): boolean {
    const active = document.activeElement;
    if (!active || active === document.body) return false;

    const tag = active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if ((active as HTMLElement).isContentEditable) return true;

    return false;
  }
}
