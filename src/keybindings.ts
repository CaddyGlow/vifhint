// Vim-style key binding handler

import { appConfig } from './config';

type KeyBinding = (typeof appConfig.keyBindings.bindings)[number];

// Trie node for efficient prefix matching
interface TrieNode {
	children: Map<string, TrieNode>;
	binding?: KeyBinding;
}

// Build trie from bindings
function buildTrie(bindings: readonly KeyBinding[]): TrieNode {
	const root: TrieNode = { children: new Map() };

	for (const binding of bindings) {
		let node = root;
		for (const char of binding.keys) {
			let child = node.children.get(char);
			if (!child) {
				child = { children: new Map() };
				node.children.set(char, child);
			}
			node = child;
		}
		node.binding = binding;
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

	handleKey(key: string): { result: 'match' | 'partial' | 'none'; binding?: KeyBinding } {
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

			if (singleNode.binding) {
				this.#buffer = '';
				return { result: 'match', binding: singleNode.binding };
			}

			this.#startTimeout();
			return { result: 'partial' };
		}

		if (node.binding) {
			this.#buffer = '';
			return { result: 'match', binding: node.binding };
		}

		// Partial match - wait for more keys
		this.#startTimeout();
		return { result: 'partial' };
	}

	reset(): void {
		this.#clearTimeout();
		this.#buffer = '';
	}

	isIdle(): boolean {
		return this.#buffer.length === 0;
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

// Interface for incremental selection integration
interface SelectionController {
	expand(): void;
	shrink(): void;
	toggle(): void;
	yank(): void;
}

// Interface for in-page search
interface SearchController {
	open(): void;
	next(count?: number): void;
	prev(count?: number): void;
	isActive(): boolean;
	close(): void;
}

// Interface for key bindings overlay
interface HelpOverlayController {
	toggle(): void;
	hide(): void;
	isVisible(): boolean;
}

// Main key bindings class
export class KeyBindings {
	#handler: KeySequenceHandler;
	#linkHints: LinkHintsInterface;
	#selection: SelectionController;
	#search: SearchController | null;
	#helpOverlay: HelpOverlayController | null;
	#lastInputIndex = -1;
	#countBuffer = '';
	#countTimeoutId: number | null = null;

	constructor(
		linkHints: LinkHintsInterface,
		selection: SelectionController,
		search?: SearchController,
		helpOverlay?: HelpOverlayController,
		bindings: readonly KeyBinding[] = appConfig.keyBindings.bindings,
	) {
		this.#linkHints = linkHints;
		this.#selection = selection;
		this.#search = search ?? null;
		this.#helpOverlay = helpOverlay ?? null;
		this.#handler = new KeySequenceHandler(bindings, appConfig.keyBindings.timeout);
		this.#setupKeyListener();
	}

	#setupKeyListener(): void {
		document.addEventListener(
			'keydown',
			(e) => {
				const key = e.key === '/' && e.shiftKey ? '?' : e.key;

				if (this.#helpOverlay?.isVisible()) {
					if (key === 'Escape' || key === '?') {
						this.#helpOverlay.hide();
						e.preventDefault();
						e.stopPropagation();
						return;
					}

					e.preventDefault();
					e.stopPropagation();
					return;
				}

				if (this.#search?.isActive()) {
					if (key === 'Escape') {
						this.#search.close();
						e.preventDefault();
						e.stopPropagation();
					}
					return;
				}

				// Skip if LinkHints is active
				if (this.#linkHints.isActive()) return;

				// Escape should blur focused editable elements
				if (key === 'Escape' && this.#isEditableActive()) {
					const active = document.activeElement as HTMLElement | null;
					if (active) {
						// Delay blur so page handlers see Escape on the focused element first.
						window.setTimeout(() => {
							if (document.activeElement === active) {
								active.blur();
							}
						}, 0);
					}
					this.#handler.reset();
					this.#resetCount();
					return;
				}

				// Skip if in editable element
				if (this.#isEditableActive()) return;

				// Skip if modifier keys (except Shift for case sensitivity)
				if (e.ctrlKey || e.altKey || e.metaKey) return;

				// Skip special keys
				if (key.length > 1 && key !== 'Escape') return;

				// Escape clears buffer
				if (key === 'Escape') {
					this.#handler.reset();
					this.#resetCount();
					return;
				}

				// Handle numeric count prefixes (e.g., 3gi)
				if (/^\d$/.test(key) && this.#handler.isIdle()) {
					this.#appendCount(key);
					e.preventDefault();
					e.stopPropagation();
					return;
				}

				const result = this.#handler.handleKey(key);

				if (result.result === 'match' && result.binding) {
					const hasCount = this.#countBuffer.length > 0;
					const count = this.#consumeCount();
					const repeatable = result.binding.repeatable === true;
					const effectiveCount = repeatable ? count : 1;
					const effectiveHasCount = repeatable ? hasCount : false;
					e.preventDefault();
					e.stopPropagation();
					this.#executeOperation(result.binding.operation, effectiveCount, effectiveHasCount);
				} else if (result.result === 'partial') {
					e.preventDefault();
					e.stopPropagation();
				} else {
					// No match; drop any pending count so it doesn't leak to later commands.
					this.#resetCount();
				}
				// 'none' - let event propagate normally
			},
			true,
		);
	}

	#executeOperation(operation: KeyBinding['operation'], count = 1, hasCount = false): void {
		if (operation.startsWith('tab:')) {
			// Send to background script
			chrome.runtime.sendMessage({ type: 'tab-operation', operation, count });
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
			const steps = Math.max(1, count);
			window.scrollBy({ top: (window.innerHeight / 2) * steps, behavior: 'smooth' });
		} else if (operation === 'scroll:half-up') {
			const steps = Math.max(1, count);
			window.scrollBy({ top: (-window.innerHeight / 2) * steps, behavior: 'smooth' });
		} else if (operation === 'focus:input') {
			this.#focusNextInput(count, hasCount);
		} else if (operation === 'selection:expand') {
			const steps = Math.max(1, count);
			for (let i = 0; i < steps; i += 1) {
				this.#selection.expand();
			}
		} else if (operation === 'selection:shrink') {
			const steps = Math.max(1, count);
			for (let i = 0; i < steps; i += 1) {
				this.#selection.shrink();
			}
		} else if (operation === 'selection:yank') {
			this.#selection.yank();
		} else if (operation === 'selection:toggle') {
			this.#selection.toggle();
		} else if (operation === 'find:open') {
			this.#search?.open();
		} else if (operation === 'find:next') {
			const steps = Math.max(1, count);
			this.#search?.next(steps);
		} else if (operation === 'find:prev') {
			const steps = Math.max(1, count);
			this.#search?.prev(steps);
		} else if (operation === 'help:toggle') {
			this.#helpOverlay?.toggle();
		}
	}

	#focusNextInput(count = 1, hasCount = false): void {
		const inputs = this.#getTextInputs();
		if (inputs.length === 0) return;

		let nextIndex = 0;
		if (hasCount) {
			const normalized = Math.max(1, count);
			nextIndex = (normalized - 1) % inputs.length;
		} else {
			const active = document.activeElement as HTMLElement | null;
			const activeIndex = active ? inputs.indexOf(active) : -1;

			if (activeIndex >= 0) {
				nextIndex = activeIndex + 1;
			} else if (this.#lastInputIndex >= 0 && this.#lastInputIndex < inputs.length) {
				nextIndex = this.#lastInputIndex + 1;
			}

			if (nextIndex >= inputs.length) nextIndex = 0;
		}
		const target = inputs[nextIndex];

		try {
			target.focus();
			target.scrollIntoView({ block: 'center', inline: 'center' });
			if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
				const valueLength = target.value?.length ?? 0;
				target.setSelectionRange(valueLength, valueLength);
			}
		} catch {
			// Ignore focus errors on protected inputs
		}

		this.#lastInputIndex = inputs.indexOf(target);
	}

	#appendCount(digit: string): void {
		this.#countBuffer += digit;
		this.#startCountTimeout();
	}

	#consumeCount(): number {
		const count = Number.parseInt(this.#countBuffer, 10);
		this.#resetCount();
		return Number.isNaN(count) ? 1 : count;
	}

	#resetCount(): void {
		if (this.#countTimeoutId !== null) {
			window.clearTimeout(this.#countTimeoutId);
			this.#countTimeoutId = null;
		}
		this.#countBuffer = '';
	}

	#startCountTimeout(): void {
		if (this.#countTimeoutId !== null) {
			window.clearTimeout(this.#countTimeoutId);
		}
		this.#countTimeoutId = window.setTimeout(() => {
			this.#countBuffer = '';
			this.#countTimeoutId = null;
		}, appConfig.keyBindings.timeout);
	}

	#getTextInputs(): HTMLElement[] {
		const nodes = Array.from(
			document.querySelectorAll<HTMLElement>(
				'input, textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"]',
			),
		);

		return nodes.filter((el) => this.#isFocusableInput(el));
	}

	#isFocusableInput(el: HTMLElement): boolean {
		if (!el.isConnected) return false;
		if (el instanceof HTMLInputElement && el.disabled) return false;

		const tag = el.tagName;
		if (tag === 'INPUT') {
			const type = (el as HTMLInputElement).type;
			if (/^(button|checkbox|file|hidden|image|radio|reset|submit)$/i.test(type)) {
				return false;
			}
		} else if (
			tag !== 'TEXTAREA' &&
			!el.isContentEditable &&
			el.getAttribute('role') !== 'textbox'
		) {
			return false;
		}

		const rect = el.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return false;
		if (rect.bottom <= 0 || rect.top >= window.innerHeight) return false;
		if (rect.right <= 0 || rect.left >= window.innerWidth) return false;

		const style = window.getComputedStyle(el);
		if (style.display === 'none' || style.visibility === 'hidden') return false;
		const opacity = Number.parseFloat(style.opacity);
		if (!Number.isNaN(opacity) && opacity <= 0.1) return false;

		return true;
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
