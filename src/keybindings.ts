// Vim-style key binding handler

import { type Keymap, appConfig } from './config';
import { type KeyToken, eventToKeyToken, parseKeySequence } from './key-notation';
import type { KeySequenceEvent } from './plugins/types';
import type { HintMode } from './types';

type NormalizedKeymap = Keymap & { sequence: readonly KeyToken[] };

type CommandExecutor = {
	isRegistered(command: string): boolean;
	execute(command: string, count: number, hasCount: boolean): void | Promise<void>;
};

type KeySequenceListener = (event: KeySequenceEvent) => void;

type EnabledCheck = () => boolean;

// Trie node for efficient prefix matching
interface TrieNode {
	children: Map<string, TrieNode>;
	binding?: NormalizedKeymap;
}

// Build trie from keymaps
function buildTrie(keymaps: readonly NormalizedKeymap[]): TrieNode {
	const root: TrieNode = { children: new Map() };

	for (const keymap of keymaps) {
		let node = root;
		for (const token of keymap.sequence) {
			let child = node.children.get(token);
			if (!child) {
				child = { children: new Map() };
				node.children.set(token, child);
			}
			node = child;
		}
		node.binding = keymap;
	}

	return root;
}

function normalizeKeymaps(keymaps: readonly Keymap[], leader: string): NormalizedKeymap[] {
	return keymaps
		.map((keymap) => ({
			...keymap,
			sequence: parseKeySequence(keymap.lhs, leader),
		}))
		.filter((keymap) => keymap.sequence.length > 0);
}

// Key sequence handler with trie-based matching
class KeySequenceHandler {
	#trie: TrieNode;
	#buffer: KeyToken[] = [];
	#timeoutId: number | null = null;
	#timeout: number;

	constructor(keymaps: readonly NormalizedKeymap[], timeout: number) {
		this.#trie = buildTrie(keymaps);
		this.#timeout = timeout;
	}

	handleKey(token: KeyToken): {
		result: 'match' | 'partial' | 'none';
		binding?: NormalizedKeymap;
		tokens: readonly KeyToken[];
	} {
		this.#clearTimeout();
		this.#buffer.push(token);

		const node = this.#findNode(this.#buffer);

		if (!node) {
			// No match - try with just this key
			this.#buffer = [token];
			const singleNode = this.#findNode(this.#buffer);

			if (!singleNode) {
				this.#buffer = [];
				return { result: 'none', tokens: [] };
			}

			if (singleNode.binding) {
				this.#buffer = [];
				return {
					result: 'match',
					binding: singleNode.binding,
					tokens: singleNode.binding.sequence,
				};
			}

			this.#startTimeout();
			return { result: 'partial', tokens: [...this.#buffer] };
		}

		if (node.binding) {
			this.#buffer = [];
			return { result: 'match', binding: node.binding, tokens: node.binding.sequence };
		}

		// Partial match - wait for more keys
		this.#startTimeout();
		return { result: 'partial', tokens: [...this.#buffer] };
	}

	reset(): void {
		this.#clearTimeout();
		this.#buffer = [];
	}

	isIdle(): boolean {
		return this.#buffer.length === 0;
	}

	#findNode(tokens: readonly KeyToken[]): TrieNode | null {
		let node = this.#trie;
		for (const token of tokens) {
			const child = node.children.get(token);
			if (!child) return null;
			node = child;
		}
		return node;
	}

	#startTimeout(): void {
		this.#timeoutId = window.setTimeout(() => {
			this.#buffer = [];
		}, this.#timeout);
	}

	#clearTimeout(): void {
		if (this.#timeoutId !== null) {
			window.clearTimeout(this.#timeoutId);
			this.#timeoutId = null;
		}
	}
}

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
	toggleLinewise(): void;
	yank(): void;
	moveWord(direction: 'forward' | 'backward', count?: number): void;
	moveWordEnd(count?: number): void;
	moveBigWord(direction: 'forward' | 'backward', count?: number): void;
	moveLine(boundary: 'start' | 'first' | 'end', count?: number): void;
	moveParagraph(direction: 'prev' | 'next', count?: number): void;
	selectTextObject(kind: 'word' | 'paragraph', around: boolean): void;
	moveCaret(direction: 'left' | 'right' | 'up' | 'down', count?: number): void;
	scrollAndFollow(deltaY: number): void;
	swapSelectionEndpoint(): void;
	getWordUnderCaret(): string | null;
}

// Interface for in-page search
interface SearchController {
	open(): void;
	next(count?: number): void;
	prev(count?: number): void;
	searchWord(query: string, direction: 'next' | 'prev', count?: number): void;
	isActive(): boolean;
	close(): void;
	clearHighlights(): void;
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
	#commandExecutor: CommandExecutor | null = null;
	#onKeySequence: KeySequenceListener | null = null;
	#keymaps: Keymap[];
	#lastInputIndex = -1;
	#countBuffer = '';
	#countTimeoutId: number | null = null;
	#isEnabled: EnabledCheck | null = null;

	constructor(
		linkHints: LinkHintsInterface,
		selection: SelectionController,
		search?: SearchController,
		helpOverlay?: HelpOverlayController,
		keymaps: readonly Keymap[] = appConfig.keymaps,
		options?: {
			commandExecutor?: CommandExecutor;
			onKeySequence?: KeySequenceListener;
			isEnabled?: EnabledCheck;
		},
	) {
		this.#linkHints = linkHints;
		this.#selection = selection;
		this.#search = search ?? null;
		this.#helpOverlay = helpOverlay ?? null;
		this.#commandExecutor = options?.commandExecutor ?? null;
		this.#onKeySequence = options?.onKeySequence ?? null;
		this.#isEnabled = options?.isEnabled ?? null;
		this.#keymaps = [...keymaps];
		const normalized = normalizeKeymaps(this.#keymaps, appConfig.options.leader);
		this.#handler = new KeySequenceHandler(normalized, appConfig.options.timeoutlen);
		this.#setupKeyListener();
	}

	registerKeymap(map: Keymap): void {
		this.#keymaps.push(map);
		const normalized = normalizeKeymaps(this.#keymaps, appConfig.options.leader);
		this.#handler = new KeySequenceHandler(normalized, appConfig.options.timeoutlen);
	}

	getBindings(): readonly Keymap[] {
		return this.#keymaps;
	}

	#setupKeyListener(): void {
		document.addEventListener(
			'keydown',
			(e) => {
				if (this.#isEnabled && !this.#isEnabled()) return;
				const token = eventToKeyToken(e);

				if (this.#helpOverlay?.isVisible()) {
					if (token === '<Esc>' || token === '?') {
						this.#helpOverlay.hide();
						this.#onKeySequence?.({ status: 'none' });
						e.preventDefault();
						e.stopPropagation();
						return;
					}

					e.preventDefault();
					e.stopPropagation();
					return;
				}

				if (this.#search?.isActive()) {
					if (token === '<Esc>') {
						this.#search.close();
						this.#onKeySequence?.({ status: 'none' });
						e.preventDefault();
						e.stopPropagation();
					}
					return;
				}

				// Skip if LinkHints is active
				if (this.#linkHints.isActive()) return;

				// Escape should blur focused editable elements
				if (token === '<Esc>' && this.#isEditableActive()) {
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
					this.#onKeySequence?.({ status: 'none' });
					return;
				}

				// Skip if in editable element
				if (this.#isEditableActive()) return;

				if (!token) return;

				const hasPendingInput = this.#countBuffer.length > 0 || !this.#handler.isIdle();

				// Escape only cancels an in-progress key sequence/count.
				if (token === '<Esc>' && hasPendingInput) {
					this.#handler.reset();
					this.#resetCount();
					this.#onKeySequence?.({ status: 'none' });
					e.preventDefault();
					e.stopPropagation();
					return;
				}

				// Escape clears buffer
				if (token === '<Esc>') {
					this.#search?.clearHighlights();
					this.#handler.reset();
					this.#resetCount();
					this.#onKeySequence?.({ status: 'none' });
					return;
				}

				// Handle numeric count prefixes (e.g., 3gi). Allow bare "0" as a command.
				if (/^\d$/.test(token) && this.#handler.isIdle()) {
					if (token === '0' && this.#countBuffer.length === 0) {
						// Let "0" fall through to bindings (Vim-style).
					} else {
						this.#appendCount(token);
						e.preventDefault();
						e.stopPropagation();
						return;
					}
				}

				const result = this.#handler.handleKey(token);

				if (result.result === 'match' && result.binding) {
					const hasCount = this.#countBuffer.length > 0;
					const count = this.#consumeCount();
					const repeatable = result.binding.repeatable === true;
					const effectiveCount = repeatable ? count : 1;
					const effectiveHasCount = repeatable ? hasCount : false;
					e.preventDefault();
					e.stopPropagation();
					this.#onKeySequence?.({
						status: 'match',
						sequence: result.binding.lhs,
						tokens: result.tokens,
					});
					this.#executeOperation(result.binding.rhs, effectiveCount, effectiveHasCount);
				} else if (result.result === 'partial') {
					e.preventDefault();
					e.stopPropagation();
					this.#onKeySequence?.({ status: 'partial', tokens: result.tokens });
				} else {
					// No match; drop any pending count so it doesn't leak to later commands.
					this.#resetCount();
					this.#onKeySequence?.({ status: 'none' });
				}
				// 'none' - let event propagate normally
			},
			true,
		);
	}

	#executeOperation(operation: Keymap['rhs'], count = 1, hasCount = false): void {
		if (operation.startsWith('tab:')) {
			// Send to background script
			chrome.runtime.sendMessage({ type: 'tab-operation', operation, count });
		} else if (operation === 'hints:activate') {
			this.#linkHints.activate('normal');
		} else if (operation === 'hints:newTab') {
			this.#linkHints.activate('newTab');
		} else if (operation === 'hints:backgroundTab') {
			this.#linkHints.activate('backgroundTab');
		} else if (operation === 'hints:search') {
			this.#linkHints.activate('search');
		} else if (operation === 'scroll:top') {
			window.scrollTo({ top: 0, behavior: 'smooth' });
		} else if (operation === 'scroll:bottom') {
			window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
		} else if (operation === 'scroll:center') {
			this.#scrollToCenter();
		} else if (operation === 'scroll:half-down') {
			const steps = Math.max(1, count);
			const baseStep = Math.max(0, appConfig.options.scroll);
			this.#selection.scrollAndFollow(window.innerHeight * baseStep * steps);
		} else if (operation === 'scroll:half-up') {
			const steps = Math.max(1, count);
			const baseStep = Math.max(0, appConfig.options.scroll);
			this.#selection.scrollAndFollow(-window.innerHeight * baseStep * steps);
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
		} else if (operation === 'selection:line-toggle') {
			this.#selection.toggleLinewise();
		} else if (operation === 'selection:swap') {
			this.#selection.swapSelectionEndpoint();
		} else if (operation === 'motion:word-forward') {
			this.#selection.moveWord('forward', count);
		} else if (operation === 'motion:word-back') {
			this.#selection.moveWord('backward', count);
		} else if (operation === 'motion:word-end') {
			this.#selection.moveWordEnd(count);
		} else if (operation === 'motion:WORD-forward') {
			this.#selection.moveBigWord('forward', count);
		} else if (operation === 'motion:WORD-back') {
			this.#selection.moveBigWord('backward', count);
		} else if (operation === 'motion:line-start') {
			this.#selection.moveLine('start', count);
		} else if (operation === 'motion:line-first') {
			this.#selection.moveLine('first', count);
		} else if (operation === 'motion:line-end') {
			this.#selection.moveLine('end', count);
		} else if (operation === 'motion:paragraph-prev') {
			this.#selection.moveParagraph('prev', count);
		} else if (operation === 'motion:paragraph-next') {
			this.#selection.moveParagraph('next', count);
		} else if (operation === 'textobj:word-inner') {
			this.#selection.selectTextObject('word', false);
		} else if (operation === 'textobj:word-around') {
			this.#selection.selectTextObject('word', true);
		} else if (operation === 'textobj:paragraph-inner') {
			this.#selection.selectTextObject('paragraph', false);
		} else if (operation === 'textobj:paragraph-around') {
			this.#selection.selectTextObject('paragraph', true);
		} else if (operation === 'search:word-next') {
			const word = this.#selection.getWordUnderCaret();
			if (word) this.#search?.searchWord(word, 'next', count);
		} else if (operation === 'search:word-prev') {
			const word = this.#selection.getWordUnderCaret();
			if (word) this.#search?.searchWord(word, 'prev', count);
		} else if (operation === 'caret:move-left') {
			this.#selection.moveCaret('left', count);
		} else if (operation === 'caret:move-right') {
			this.#selection.moveCaret('right', count);
		} else if (operation === 'caret:move-up') {
			this.#selection.moveCaret('up', count);
		} else if (operation === 'caret:move-down') {
			this.#selection.moveCaret('down', count);
		} else if (operation === 'find:open') {
			this.#search?.open();
		} else if (operation === 'find:next') {
			const steps = Math.max(1, count);
			this.#search?.next(steps);
		} else if (operation === 'find:prev') {
			const steps = Math.max(1, count);
			this.#search?.prev(steps);
		} else if (operation === 'find:nohl') {
			this.#search?.clearHighlights();
		} else if (operation === 'help:toggle') {
			this.#helpOverlay?.toggle();
		} else if (this.#commandExecutor?.isRegistered(operation)) {
			void this.#commandExecutor.execute(operation, count, hasCount);
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

	#scrollToCenter(): void {
		const selection = window.getSelection();
		let rect: DOMRect | null = null;

		if (selection && selection.rangeCount > 0) {
			const range = selection.getRangeAt(0);
			const clientRects = range.getClientRects();
			rect = clientRects.length > 0 ? clientRects[0] : range.getBoundingClientRect();
		}

		if (!rect || (rect.width === 0 && rect.height === 0)) {
			const highlight = document.querySelector<HTMLElement>(
				'.hint-find-highlight-current, .hint-find-highlight',
			);
			if (highlight) {
				rect = highlight.getBoundingClientRect();
			}
		}

		if (!rect || (rect.width === 0 && rect.height === 0)) {
			const active = document.activeElement as HTMLElement | null;
			if (
				active &&
				active !== document.body &&
				active !== document.documentElement &&
				active.getBoundingClientRect
			) {
				rect = active.getBoundingClientRect();
			}
		}

		if (!rect || (rect.width === 0 && rect.height === 0)) return;

		const targetY = rect.top + window.scrollY + rect.height / 2;
		const targetX = rect.left + window.scrollX + rect.width / 2;

		window.scrollTo({
			top: Math.max(0, targetY - window.innerHeight / 2),
			left: Math.max(0, targetX - window.innerWidth / 2),
			behavior: 'smooth',
		});
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
		}, appConfig.options.timeoutlen);
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
