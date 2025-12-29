// Optimized link hints implementation

import { appConfig } from './config';
import { formatKeySequenceForDisplay } from './key-notation';
import { KeyBindings } from './keybindings';

// ============================================================================
// Types
// ============================================================================

interface ElementData {
	readonly element: HTMLElement;
	readonly rect: DOMRect;
	readonly style: CSSStyleDeclaration;
}

interface HintElement {
	readonly element: HTMLElement;
	readonly hint: string;
	readonly label: HTMLElement;
}

type HintAlign = 'left' | 'center' | 'right';

type HintMode = 'normal' | 'newTab' | 'backgroundTab';

interface HintConfig {
	readonly hintChars: string;
	readonly hintAlign: HintAlign;
	readonly hintOffset: { readonly x: number; readonly y: number };
	readonly clickableSelector: string;
	readonly showElementBorder: boolean;
	readonly debugTimings: boolean;
}

type Keymap = (typeof appConfig.keymaps)[number];

interface FindOptions {
	readonly caseSensitive?: boolean;
	readonly wholeWord?: boolean;
	readonly useRegex?: boolean;
}

interface FindMatch {
	readonly index: number;
	readonly textNode: Text;
	readonly startOffset: number;
	readonly endOffset: number;
}

// ============================================================================
// Configuration
// ============================================================================

const config: HintConfig = {
	hintChars: 'asdfghjkl',
	hintAlign: 'left',
	hintOffset: { x: -8, y: -10 },
	clickableSelector: '',
	showElementBorder: true,
	debugTimings: true,
};

// ============================================================================
// Constants
// ============================================================================

// Clickable tag names
const CLICKABLE_TAGS = new Set(['A', 'BUTTON', 'SELECT', 'INPUT', 'TEXTAREA', 'SUMMARY']);

// Clickable roles
const CLICKABLE_ROLES = new Set([
	'button',
	'link',
	'menuitem',
	'option',
	'switch',
	'tab',
	'checkbox',
	'combobox',
	'menuitemcheckbox',
	'menuitemradio',
]);

// ============================================================================
// Help Overlay
// ============================================================================

const HELP_GROUP_ORDER = [
	'Help',
	'Find',
	'Tabs',
	'Scroll',
	'Hints',
	'Focus',
	'Motion',
	'Caret',
	'Selection',
	'Other',
] as const;

function groupForBinding(binding: Keymap): string {
	if (binding.rhs.startsWith('tab:')) return 'Tabs';
	if (binding.rhs.startsWith('scroll:')) return 'Scroll';
	if (binding.rhs.startsWith('hints:')) return 'Hints';
	if (binding.rhs.startsWith('focus:')) return 'Focus';
	if (binding.rhs.startsWith('motion:')) return 'Motion';
	if (binding.rhs.startsWith('textobj:')) return 'Motion';
	if (binding.rhs.startsWith('caret:')) return 'Caret';
	if (binding.rhs.startsWith('selection:')) return 'Selection';
	if (binding.rhs.startsWith('find:')) return 'Find';
	if (binding.rhs.startsWith('search:')) return 'Find';
	if (binding.rhs.startsWith('help:')) return 'Help';
	return 'Other';
}

function createKeyCaps(lhs: string): HTMLElement {
	const container = document.createElement('span');
	container.className = 'hint-help-keys';
	const tokens = formatKeySequenceForDisplay(lhs, appConfig.options.leader);
	for (const token of tokens) {
		const key = document.createElement('kbd');
		key.textContent = token;
		container.appendChild(key);
	}
	return container;
}

class HelpOverlay {
	#overlay: HTMLDivElement;
	#bindings: readonly Keymap[];

	constructor(bindings: readonly Keymap[]) {
		this.#bindings = bindings;
		this.#overlay = this.#buildOverlay();
	}

	toggle(): void {
		if (this.isVisible()) {
			this.hide();
		} else {
			this.show();
		}
	}

	show(): void {
		this.#ensureAttached();
		this.#overlay.classList.add('is-visible');
	}

	hide(): void {
		this.#overlay.classList.remove('is-visible');
	}

	isVisible(): boolean {
		return this.#overlay.classList.contains('is-visible');
	}

	#ensureAttached(): void {
		if (this.#overlay.isConnected) return;
		const host = document.body ?? document.documentElement;
		host.appendChild(this.#overlay);
	}

	#buildOverlay(): HTMLDivElement {
		const overlay = document.createElement('div');
		overlay.className = 'hint-help-overlay';
		overlay.setAttribute('role', 'dialog');
		overlay.setAttribute('aria-modal', 'true');
		overlay.setAttribute('aria-label', 'Keymaps');

		const card = document.createElement('div');
		card.className = 'hint-help-card';

		const header = document.createElement('div');
		header.className = 'hint-help-header';

		const title = document.createElement('div');
		title.className = 'hint-help-title';
		title.textContent = 'Keymaps';

		const subtitle = document.createElement('div');
		subtitle.className = 'hint-help-subtitle';
		subtitle.textContent = 'Press ? or <Esc> to close';

		header.appendChild(title);
		header.appendChild(subtitle);
		card.appendChild(header);

		const sectionsContainer = document.createElement('div');
		sectionsContainer.className = 'hint-help-sections';

		const grouped = new Map<string, Keymap[]>();
		for (const binding of this.#bindings) {
			const group = groupForBinding(binding);
			const list = grouped.get(group);
			if (list) {
				list.push(binding);
			} else {
				grouped.set(group, [binding]);
			}
		}

		for (const group of HELP_GROUP_ORDER) {
			const bindings = grouped.get(group);
			if (!bindings || bindings.length === 0) continue;

			const section = document.createElement('section');
			section.className = 'hint-help-section';

			const heading = document.createElement('h2');
			heading.className = 'hint-help-section-title';
			heading.textContent = group;

			const list = document.createElement('div');
			list.className = 'hint-help-list';

			for (const binding of bindings) {
				const row = document.createElement('div');
				row.className = 'hint-help-row';

				const desc = document.createElement('div');
				desc.className = 'hint-help-desc';
				desc.textContent = binding.desc;

				row.appendChild(createKeyCaps(binding.lhs));
				row.appendChild(desc);
				list.appendChild(row);
			}

			section.appendChild(heading);
			section.appendChild(list);
			sectionsContainer.appendChild(section);
		}

		card.appendChild(sectionsContainer);

		if (this.#bindings.some((binding) => binding.repeatable)) {
			const footer = document.createElement('div');
			footer.className = 'hint-help-footer';
			footer.textContent = 'Repeatable commands accept counts (e.g., 3d).';
			card.appendChild(footer);
		}

		overlay.addEventListener('click', (event) => {
			if (event.target === overlay) {
				this.hide();
			}
		});

		overlay.appendChild(card);
		return overlay;
	}
}

let bottomBar: HTMLDivElement | null = null;

function getBottomBar(): HTMLDivElement {
	if (!bottomBar) {
		const bar = document.createElement('div');
		bar.className = 'hint-bottom-bar';
		const host = document.body ?? document.documentElement;
		host.appendChild(bar);
		bottomBar = bar;
	}
	return bottomBar;
}

class FindHighlighter {
	#results: FindMatch[] = [];
	#currentIndex = -1;
	#highlightClass = 'hint-find-highlight';
	#currentHighlightClass = 'hint-find-highlight-current';
	#searchAbortController: AbortController | null = null;

	async find(query: string, options: FindOptions = {}): Promise<number> {
		this.#cancelSearch();
		this.#clearHighlights();
		this.#results = [];
		this.#currentIndex = -1;

		if (!query) return 0;

		this.#searchAbortController = new AbortController();

		try {
			const pattern = this.#createPattern(query, options);
			await this.#searchDocument(pattern, this.#searchAbortController.signal);

			if (this.#results.length > 0) {
				this.#highlightAll();
				this.#setCurrent(0);
			}

			return this.#results.length;
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				return 0;
			}
			console.warn('[hint] Find error:', error);
			return 0;
		}
	}

	next(): boolean {
		if (this.#results.length === 0) return false;
		const nextIndex = (this.#currentIndex + 1) % this.#results.length;
		this.#setCurrent(nextIndex);
		return true;
	}

	prev(): boolean {
		if (this.#results.length === 0) return false;
		const nextIndex = this.#currentIndex <= 0 ? this.#results.length - 1 : this.#currentIndex - 1;
		this.#setCurrent(nextIndex);
		return true;
	}

	setCurrentIndex(index: number): void {
		if (this.#results.length === 0) return;
		const total = this.#results.length;
		const normalized = ((index % total) + total) % total;
		this.#setCurrent(normalized);
	}

	clear(): void {
		this.#cancelSearch();
		this.#clearHighlights();
		this.#results = [];
		this.#currentIndex = -1;
	}

	getCurrentMatch(): { current: number; total: number } {
		return {
			current: this.#currentIndex + 1,
			total: this.#results.length,
		};
	}

	#createPattern(query: string, options: FindOptions): RegExp {
		let pattern: string;

		if (options.useRegex) {
			pattern = query;
		} else {
			pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			if (options.wholeWord) {
				pattern = `\\b${pattern}\\b`;
			}
		}

		const flags = options.caseSensitive ? 'g' : 'gi';
		return new RegExp(pattern, flags);
	}

	async #searchDocument(pattern: RegExp, signal: AbortSignal): Promise<void> {
		const root = document.body ?? document.documentElement;
		if (!root) return;

		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
			acceptNode: (node: Node) => {
				const parent = node.parentElement;
				if (!parent) return NodeFilter.FILTER_REJECT;

				if (
					parent.closest?.(
						'.hint-find-bar, .hint-help-overlay, .link-hint-input, .visual-mode-indicator, .hint-caret',
					)
				) {
					return NodeFilter.FILTER_REJECT;
				}

				if (
					parent.classList.contains(this.#highlightClass) ||
					parent.classList.contains(this.#currentHighlightClass)
				) {
					return NodeFilter.FILTER_REJECT;
				}

				const tag = parent.tagName;
				if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
					return NodeFilter.FILTER_REJECT;
				}

				const style = window.getComputedStyle(parent);
				if (style.display === 'none' || style.visibility === 'hidden') {
					return NodeFilter.FILTER_REJECT;
				}

				if (!node.textContent?.trim()) {
					return NodeFilter.FILTER_REJECT;
				}

				return NodeFilter.FILTER_ACCEPT;
			},
		});

		let node: Node | null;
		let processedCount = 0;
		const batchSize = 100;

		node = walker.nextNode();
		while (node) {
			if (signal.aborted) throw new DOMException('Search aborted', 'AbortError');

			if (node.nodeType === Node.TEXT_NODE) {
				const textNode = node as Text;
				const text = textNode.textContent ?? '';
				const matches = Array.from(text.matchAll(pattern));
				for (const match of matches) {
					if (match.index === undefined) continue;
					this.#results.push({
						index: this.#results.length,
						textNode,
						startOffset: match.index,
						endOffset: match.index + match[0].length,
					});
				}
			}

			if (++processedCount % batchSize === 0) {
				await this.#delay(0);
			}

			node = walker.nextNode();
		}
	}

	#delay(ms: number): Promise<void> {
		return new Promise((resolve) => window.setTimeout(resolve, ms));
	}

	#highlightAll(): void {
		const nodeGroups = new Map<Text, FindMatch[]>();
		for (const result of this.#results) {
			const group = nodeGroups.get(result.textNode);
			if (group) {
				group.push(result);
			} else {
				nodeGroups.set(result.textNode, [result]);
			}
		}

		for (const [textNode, results] of nodeGroups) {
			results.sort((a, b) => b.startOffset - a.startOffset);
			for (const result of results) {
				this.#wrapMatch(textNode, result);
			}
		}
	}

	#wrapMatch(textNode: Text, result: FindMatch): void {
		try {
			const range = document.createRange();
			range.setStart(textNode, result.startOffset);
			range.setEnd(textNode, result.endOffset);

			const span = document.createElement('span');
			span.className = this.#highlightClass;
			span.dataset.hintFindIndex = result.index.toString();
			range.surroundContents(span);
		} catch (error) {
			console.warn('[hint] Failed to highlight match:', error);
		}
	}

	#setCurrent(index: number): void {
		const currentHighlights = document.querySelectorAll(`.${this.#currentHighlightClass}`);
		for (const el of currentHighlights) {
			el.classList.remove(this.#currentHighlightClass);
			el.classList.add(this.#highlightClass);
		}

		this.#currentIndex = index;
		const newCurrent = document.querySelector(`[data-hint-find-index="${index}"]`);
		if (newCurrent) {
			newCurrent.classList.remove(this.#highlightClass);
			newCurrent.classList.add(this.#currentHighlightClass);
			this.#scrollToCurrent(newCurrent);
		}
	}

	#scrollToCurrent(element: Element): void {
		element.scrollIntoView({
			behavior: 'smooth',
			block: 'center',
			inline: 'center',
		});
	}

	#clearHighlights(): void {
		const highlights = document.querySelectorAll(
			`.${this.#highlightClass}, .${this.#currentHighlightClass}`,
		);

		for (const highlight of highlights) {
			const parent = highlight.parentNode;
			if (!parent) return;

			while (highlight.firstChild) {
				parent.insertBefore(highlight.firstChild, highlight);
			}
			parent.removeChild(highlight);
			parent.normalize();
		}
	}

	#cancelSearch(): void {
		if (this.#searchAbortController) {
			this.#searchAbortController.abort();
			this.#searchAbortController = null;
		}
	}
}

class NativeFindController {
	open(): void {
		try {
			if (document.queryCommandSupported?.('find')) {
				document.execCommand('find');
			} else {
				console.warn('[hint] Native find is not supported on this page.');
			}
		} catch {
			console.warn('[hint] Native find is not supported on this page.');
		}
	}

	close(): void {}

	isActive(): boolean {
		return false;
	}

	next(_count = 1): void {}

	prev(_count = 1): void {}

	searchWord(_query: string, _direction: 'next' | 'prev', _count = 1): void {
		console.warn('[hint] Word search is not supported in native find mode.');
	}

	clearHighlights(): void {}
}

class CustomFindController {
	#finder = new FindHighlighter();
	#active = false;
	#bar: HTMLDivElement | null = null;
	#input: HTMLInputElement | null = null;
	#count: HTMLSpanElement | null = null;
	#lastQuery = '';
	#lastActiveElement: HTMLElement | null = null;
	#searchToken = 0;
	#lastMatchIndex: number | null = null;

	open(): void {
		this.#ensureBar();
		this.#active = true;
		this.#lastActiveElement = document.activeElement as HTMLElement | null;

		if (this.#bar && !this.#bar.isConnected) {
			getBottomBar().appendChild(this.#bar);
		}

		this.#bar?.classList.add('is-visible');

		if (this.#input) {
			this.#input.value = this.#lastQuery;
			this.#input.tabIndex = 0;
			this.#input.focus();
			this.#input.setSelectionRange(this.#input.value.length, this.#input.value.length);
		}

		if (this.#lastQuery) {
			const restoreIndex = this.#lastMatchIndex;
			void this.#runSearch(this.#lastQuery).then(() => {
				this.#restoreIndex(restoreIndex);
				this.#syncLastMatchIndex();
				this.#updateCount();
			});
		} else {
			this.#updateCount();
		}
	}

	close(): void {
		if (!this.#active) return;
		this.#active = false;

		this.#bar?.classList.remove('is-visible');
		if (this.#input) {
			this.#input.tabIndex = -1;
			this.#input.blur();
		}

		if (this.#lastActiveElement?.isConnected) {
			try {
				this.#lastActiveElement.focus();
			} catch {
				// Ignore focus errors on protected inputs
			}
		}
	}

	isActive(): boolean {
		return this.#active;
	}

	next(count = 1): void {
		const steps = Math.max(1, count);
		if (this.#shouldRestoreHighlights()) {
			const restoreIndex = this.#lastMatchIndex;
			void this.#runSearch(this.#lastQuery).then(() => {
				this.#restoreIndex(restoreIndex);
				this.#stepNext(steps);
			});
			return;
		}
		this.#stepNext(steps);
	}

	prev(count = 1): void {
		const steps = Math.max(1, count);
		if (this.#shouldRestoreHighlights()) {
			const restoreIndex = this.#lastMatchIndex;
			void this.#runSearch(this.#lastQuery).then(() => {
				this.#restoreIndex(restoreIndex);
				this.#stepPrev(steps);
			});
			return;
		}
		this.#stepPrev(steps);
	}

	searchWord(query: string, direction: 'next' | 'prev', count = 1): void {
		if (!query) return;
		const steps = Math.max(1, count);
		this.#lastQuery = query;
		if (this.#input) {
			this.#input.value = query;
		}

		const token = this.#searchToken + 1;
		void this.#runSearch(query, { caseSensitive: false, wholeWord: true }).then(() => {
			if (token !== this.#searchToken) return;
			this.#setCurrentFromSelection(direction);
			if (steps > 1) {
				if (direction === 'next') {
					this.#stepNext(steps - 1);
				} else {
					this.#stepPrev(steps - 1);
				}
			} else {
				this.#updateCount();
				this.#syncLastMatchIndex();
				this.#moveCaretToCurrentMatch();
			}
		});
	}

	clearHighlights(): void {
		this.#searchToken += 1;
		const { current, total } = this.#finder.getCurrentMatch();
		if (total > 0) {
			this.#lastMatchIndex = current - 1;
		}
		this.#finder.clear();
		this.#updateCount();
	}

	#shouldRestoreHighlights(): boolean {
		if (!this.#lastQuery) return false;
		const { total } = this.#finder.getCurrentMatch();
		return total === 0;
	}

	#restoreIndex(index: number | null): void {
		if (index === null) return;
		this.#finder.setCurrentIndex(index);
	}

	#stepNext(steps: number): void {
		for (let i = 0; i < steps; i += 1) {
			if (!this.#finder.next()) break;
		}
		this.#updateCount();
		this.#syncLastMatchIndex();
		this.#moveCaretToCurrentMatch();
	}

	#stepPrev(steps: number): void {
		for (let i = 0; i < steps; i += 1) {
			if (!this.#finder.prev()) break;
		}
		this.#updateCount();
		this.#syncLastMatchIndex();
		this.#moveCaretToCurrentMatch();
	}

	#syncLastMatchIndex(): void {
		const { current, total } = this.#finder.getCurrentMatch();
		this.#lastMatchIndex = total > 0 ? current - 1 : null;
	}

	#ensureBar(): void {
		if (this.#bar) return;

		const bar = document.createElement('div');
		bar.className = 'hint-find-bar';

		const label = document.createElement('span');
		label.className = 'hint-find-label';
		label.textContent = '/';

		const input = document.createElement('input');
		input.className = 'hint-find-input';
		input.type = 'text';
		input.placeholder = 'Find in page';
		input.autocomplete = 'off';
		input.spellcheck = false;
		input.tabIndex = -1;

		const count = document.createElement('span');
		count.className = 'hint-find-count';

		bar.appendChild(label);
		bar.appendChild(input);
		bar.appendChild(count);

		input.addEventListener('input', () => {
			this.#lastQuery = input.value;
			void this.#runSearch(this.#lastQuery);
		});

		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				event.stopPropagation();
				this.close();
			}
		});

		this.#bar = bar;
		this.#input = input;
		this.#count = count;
	}

	async #runSearch(query: string, options: FindOptions = {}): Promise<void> {
		this.#searchToken += 1;
		const token = this.#searchToken;
		if (!query) {
			this.#finder.clear();
			this.#updateCount();
			this.#syncLastMatchIndex();
			return;
		}

		const total = await this.#finder.find(query, { caseSensitive: false, ...options });
		if (token !== this.#searchToken) return;
		if (total === 0) {
			this.#updateCount();
			this.#syncLastMatchIndex();
			return;
		}
		this.#updateCount();
		this.#syncLastMatchIndex();
		this.#moveCaretToCurrentMatch();
	}

	#updateCount(): void {
		if (!this.#count) return;
		const { current, total } = this.#finder.getCurrentMatch();
		if (total === 0) {
			this.#count.textContent = '0/0';
			return;
		}
		this.#count.textContent = `${current}/${total}`;
	}

	#setCurrentFromSelection(direction: 'next' | 'prev'): void {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return;

		const caretRange = document.createRange();
		const focusNode = selection.focusNode;
		if (focusNode) {
			try {
				caretRange.setStart(focusNode, selection.focusOffset);
				caretRange.collapse(true);
			} catch {
				caretRange.selectNodeContents(selection.getRangeAt(0).commonAncestorContainer);
				caretRange.collapse(true);
			}
		} else {
			caretRange.setStart(
				selection.getRangeAt(0).startContainer,
				selection.getRangeAt(0).startOffset,
			);
			caretRange.collapse(true);
		}

		const highlights = Array.from(
			document.querySelectorAll<HTMLElement>('.hint-find-highlight, .hint-find-highlight-current'),
		);
		if (highlights.length === 0) return;

		const ranges = highlights.map((el) => {
			const range = document.createRange();
			range.selectNodeContents(el);
			range.collapse(direction === 'next');
			return { el, range };
		});

		let target: HTMLElement | null = null;
		if (direction === 'next') {
			for (const { el, range } of ranges) {
				if (range.compareBoundaryPoints(Range.START_TO_START, caretRange) === 1) {
					target = el;
					break;
				}
			}
			if (!target) target = ranges[0]?.el ?? null;
		} else {
			for (let i = ranges.length - 1; i >= 0; i -= 1) {
				const { el, range } = ranges[i];
				if (range.compareBoundaryPoints(Range.START_TO_START, caretRange) === -1) {
					target = el;
					break;
				}
			}
			if (!target) target = ranges[ranges.length - 1]?.el ?? null;
		}

		if (!target) return;
		const indexValue = target.dataset.hintFindIndex;
		if (!indexValue) return;
		const index = Number.parseInt(indexValue, 10);
		if (Number.isNaN(index)) return;
		this.#finder.setCurrentIndex(index);
	}

	#moveCaretToCurrentMatch(): void {
		const selection = window.getSelection();
		if (!selection) return;

		const current = document.querySelector<HTMLElement>('.hint-find-highlight-current');
		if (!current) return;

		const range = document.createRange();
		try {
			range.selectNodeContents(current);
			range.collapse(true);
		} catch {
			return;
		}

		if (selection.rangeCount > 0 && !selection.isCollapsed) {
			const anchorNode = selection.anchorNode;
			const anchorOffset = selection.anchorOffset;
			if (!anchorNode) return;

			const withSetBase = selection as Selection & {
				setBaseAndExtent?: (
					anchorNode: Node,
					anchorOffset: number,
					focusNode: Node,
					focusOffset: number,
				) => void;
			};

			if (withSetBase.setBaseAndExtent) {
				withSetBase.setBaseAndExtent(
					anchorNode,
					anchorOffset,
					range.startContainer,
					range.startOffset,
				);
			} else {
				const extender = (
					selection as Selection & {
						extend?: (node: Node, offset: number) => void;
					}
				).extend;
				selection.removeAllRanges();
				const anchorRange = document.createRange();
				anchorRange.setStart(anchorNode, anchorOffset);
				anchorRange.collapse(true);
				selection.addRange(anchorRange);
				if (extender) {
					extender.call(selection, range.startContainer, range.startOffset);
				} else {
					anchorRange.setEnd(range.startContainer, range.startOffset);
					selection.removeAllRanges();
					selection.addRange(anchorRange);
				}
			}
		} else {
			selection.removeAllRanges();
			selection.addRange(range);
		}
	}
}

// ============================================================================
// Helper Functions
// ============================================================================

function isEditable(el: HTMLElement): boolean {
	const tag = el.tagName;
	if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
	if (el.isContentEditable) return true;
	if (tag === 'INPUT') {
		const type = (el as HTMLInputElement).type;
		return !/^(button|checkbox|file|hidden|image|radio|reset|submit)$/i.test(type);
	}
	return false;
}

function shouldBlockAutofocusFrom(el: HTMLElement): boolean {
	if (el === document.body || el === document.documentElement) return false;
	return isEditable(el);
}

function setupNoAutofocus(): void {
	if (!appConfig.options.noautofocus) return;

	const blurActive = (): void => {
		const active = document.activeElement as HTMLElement | null;
		if (active && shouldBlockAutofocusFrom(active)) {
			try {
				active.blur();
			} catch {
				// Ignore blur errors on protected inputs
			}
		}
	};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', blurActive, { once: true });
	} else {
		blurActive();
	}

	const focusHandler = (event: FocusEvent): void => {
		if (event.isTrusted) return;
		const target = event.target as HTMLElement | null;
		if (target && shouldBlockAutofocusFrom(target)) {
			try {
				target.blur();
			} catch {
				// Ignore blur errors on protected inputs
			}
		}
	};

	document.addEventListener('focusin', focusHandler, true);
	window.setTimeout(() => {
		document.removeEventListener('focusin', focusHandler, true);
	}, 1000);
}

function findHoverElements(): Set<Element> {
	const selectors = new Set<string>();

	for (const sheet of document.styleSheets) {
		try {
			for (const rule of sheet.cssRules) {
				if (
					rule instanceof CSSStyleRule &&
					rule.style.cursor === 'pointer' &&
					rule.selectorText?.includes(':hover')
				) {
					const baseSelector = rule.selectorText.replace(/:hover/g, '').trim();
					if (baseSelector) selectors.add(baseSelector);
				}
			}
		} catch {
			// Cross-origin stylesheets throw SecurityError
		}
	}

	if (selectors.size === 0) return new Set();

	try {
		return new Set(document.querySelectorAll(Array.from(selectors).join(',')));
	} catch {
		return new Set();
	}
}

// Check if element is clickable (like BrowseCut's isClickable)
function isClickable(
	el: HTMLElement,
	hoverElements: Set<Element>,
): 'tag' | 'handler' | 'cursor' | 'hover' | null {
	// Check tag
	if (CLICKABLE_TAGS.has(el.tagName)) {
		if (el.tagName === 'A' && !(el as HTMLAnchorElement).href && !el.onclick) return null;
		return 'tag';
	}

	// Check role
	const role = el.getAttribute('role');
	if (role && CLICKABLE_ROLES.has(role)) return 'tag';

	// Check onclick
	if (el.onclick || el.getAttribute('onclick')) return 'handler';

	// Check contenteditable
	if (el.contentEditable === 'true') return 'tag';

	// Check hover elements (from CSS :hover rules)
	if (hoverElements.has(el)) return 'hover';

	// Check cursor style
	const cursor = getComputedStyle(el).cursor;
	if (cursor === 'pointer' || cursor.startsWith('url(')) return 'cursor';

	return null;
}

function isHardClickable(el: HTMLElement): boolean {
	if (CLICKABLE_TAGS.has(el.tagName)) {
		if (el.tagName === 'A') {
			const anchor = el as HTMLAnchorElement;
			if (!anchor.href && !el.onclick && !el.getAttribute('onclick')) return false;
		}
		if (el.tagName === 'INPUT') {
			const type = (el as HTMLInputElement).type;
			if (/^(hidden)$/i.test(type)) return false;
		}
		return true;
	}

	const role = el.getAttribute('role');
	if (role && CLICKABLE_ROLES.has(role)) return true;

	if (el.onclick || el.getAttribute('onclick')) return true;

	if (el.contentEditable === 'true') return true;

	return false;
}

function hasHardClickableAncestor(el: HTMLElement): boolean {
	let parent = el.parentElement;
	while (parent && parent !== document.body && parent !== document.documentElement) {
		if (isHardClickable(parent)) return true;
		parent = parent.parentElement;
	}
	return false;
}

// Check visibility and get element data
function getElementData(
	el: HTMLElement,
	viewportWidth: number,
	viewportHeight: number,
): ElementData | null {
	if (!el.offsetWidth || !el.offsetHeight) return null;

	const rect = el.getBoundingClientRect();

	// In viewport?
	if (
		rect.bottom <= 0 ||
		rect.top >= viewportHeight ||
		rect.right <= 0 ||
		rect.left >= viewportWidth
	)
		return null;

	// Min size
	const minSize = isEditable(el) ? 1 : 4;
	if (rect.width <= minSize || rect.height <= minSize) return null;

	const style = getComputedStyle(el);

	// Visibility checks
	if (style.visibility === 'hidden' || style.display === 'none') return null;

	const opacity = Number.parseFloat(style.opacity);
	if (opacity <= 0.1 && !(el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'text')) {
		return null;
	}

	return { element: el, rect, style };
}

function hasSimilarBounds(a: DOMRect, b: DOMRect, threshold = 30): boolean {
	return (
		Math.abs(a.left - b.left) < threshold &&
		Math.abs(a.top - b.top) < threshold &&
		Math.abs(a.right - b.right) < threshold &&
		Math.abs(a.bottom - b.bottom) < threshold
	);
}

function getElementHref(el: HTMLElement): string | null {
	if (el.tagName === 'A') return (el as HTMLAnchorElement).href || null;
	return el.closest('a')?.href || null;
}

// BrowseCut-style: check if we should dedupe (replace parent with child)
function shouldDedupeInline(lastData: ElementData, newData: ElementData): boolean {
	// Similar bounds = dedupe
	if (hasSimilarBounds(lastData.rect, newData.rect)) return true;

	// Same URL = dedupe
	const lastHref = getElementHref(lastData.element);
	const newHref = getElementHref(newData.element);
	if (!lastHref || !newHref || lastHref === newHref) return true;

	return false;
}

// BrowseCut-style: check if element is accessible at multiple points
function isAccessible(element: HTMLElement, rect: DOMRect): boolean {
	const centerX = rect.left + rect.width / 2;
	const centerY = rect.top + rect.height / 2;

	// Test 4 points like BrowseCut: top-right, top-left, center, bottom-center
	const testPoints = [
		{ x: rect.right - 8, y: rect.top + 8 },
		{ x: rect.left + 8, y: rect.top + 8 },
		{ x: centerX, y: centerY },
		{ x: centerX, y: rect.bottom - 8 },
	];

	return testPoints.some(({ x, y }) => {
		const topEl = document.elementFromPoint(x, y);
		if (!topEl) return false;
		return topEl === element || element.contains(topEl);
	});
}

function filterOverlaps(elements: ElementData[]): ElementData[] {
	return elements.filter(({ element, rect }) => {
		return isAccessible(element, rect);
	});
}

function collectClickableElements(): ElementData[] {
	const results: ElementData[] = [];
	const viewportWidth = window.innerWidth;
	const viewportHeight = window.innerHeight;
	const hoverElements = findHoverElements();
	const shadowRoots: ShadowRoot[] = [];

	// TreeWalker traversal with inline deduplication (like BrowseCut)
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
		acceptNode(node) {
			const el = node as HTMLElement;
			if (!el.offsetWidth || !el.offsetHeight) return NodeFilter.FILTER_SKIP;
			return NodeFilter.FILTER_ACCEPT;
		},
	});

	let node = walker.nextNode();
	while (node) {
		const el = node as HTMLElement;
		const nextNode = walker.nextNode();

		// Collect shadow roots for later
		if (el.shadowRoot) shadowRoots.push(el.shadowRoot);

		// Check if clickable
		const clickType = isClickable(el, hoverElements);
		if (clickType) {
			const hasClickableAncestor =
				(clickType === 'cursor' || clickType === 'hover') && hasHardClickableAncestor(el);
			if (!hasClickableAncestor) {
				// Get visibility data
				const data = getElementData(el, viewportWidth, viewportHeight);
				if (data) {
					// BrowseCut-style inline deduplication:
					// If last element contains this one and should dedupe, replace it
					const last = results.at(-1);
					if (last) {
						if (last.element.contains(el) && shouldDedupeInline(last, data)) {
							// Keep <a> with href, otherwise replace with inner element
							if (last.element.tagName !== 'A' || !(last.element as HTMLAnchorElement).href) {
								results[results.length - 1] = data;
							}
						} else {
							results.push(data);
						}
					} else {
						results.push(data);
					}
				}
			}
		}

		node = nextNode;
	}

	// Handle shadow DOM elements
	for (const shadowRoot of shadowRoots) {
		const shadowWalker = document.createTreeWalker(shadowRoot, NodeFilter.SHOW_ELEMENT, {
			acceptNode(node) {
				const el = node as HTMLElement;
				if (!el.offsetWidth || !el.offsetHeight) return NodeFilter.FILTER_SKIP;
				return NodeFilter.FILTER_ACCEPT;
			},
		});

		let shadowNode = shadowWalker.nextNode();
		while (shadowNode) {
			const el = shadowNode as HTMLElement;
			const nextShadowNode = shadowWalker.nextNode();
			const clickType = isClickable(el, hoverElements);
			if (clickType) {
				const hasClickableAncestor =
					(clickType === 'cursor' || clickType === 'hover') && hasHardClickableAncestor(el);
				if (!hasClickableAncestor) {
					const data = getElementData(el, viewportWidth, viewportHeight);
					if (data) {
						const last = results.at(-1);
						if (last) {
							if (last.element.contains(el) && shouldDedupeInline(last, data)) {
								if (last.element.tagName !== 'A' || !(last.element as HTMLAnchorElement).href) {
									results[results.length - 1] = data;
								}
							} else {
								results.push(data);
							}
						} else {
							results.push(data);
						}
					}
				}
			}

			shadowNode = nextShadowNode;
		}
	}

	// Filter overlaps (elements hidden behind others)
	return filterOverlaps(results);
}

function sortElementsForHints(elements: ElementData[]): ElementData[] {
	const rowTolerance = 8;
	return elements
		.map((data, index) => ({ data, index }))
		.sort((a, b) => {
			const topDiff = a.data.rect.top - b.data.rect.top;
			if (Math.abs(topDiff) > rowTolerance) return topDiff;
			const leftDiff = a.data.rect.left - b.data.rect.left;
			if (Math.abs(leftDiff) > 1) return leftDiff;
			return a.index - b.index;
		})
		.map(({ data }) => data);
}

// ============================================================================
// LinkHints Class
// ============================================================================

class LinkHints {
	#hints: HintElement[] = [];
	#active = false;
	#currentInput = '';
	#inputDisplay: HTMLElement | null = null;
	#mode: HintMode = 'normal';
	#resizeTimeoutId: number | null = null;

	constructor() {
		this.#setupKeyListener();
		this.#setupCommandListener();
	}

	// Public API for KeyBindings integration
	isActive(): boolean {
		return this.#active;
	}

	activate(mode: HintMode = 'normal'): void {
		if (!this.#active) {
			this.#mode = mode;
			this.#activate();
		}
	}

	#setupCommandListener(): void {
		chrome.runtime.onMessage.addListener((message) => {
			if (message.command === 'activate-hints') {
				this.#toggle();
			}
		});
	}

	#setupKeyListener(): void {
		// Use capture phase to intercept before other listeners
		document.addEventListener(
			'keydown',
			(e) => {
				if (!this.#active) return;

				// Stop event from reaching page or other extensions
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();

				if (e.key === 'Escape') {
					this.#deactivate();
					return;
				}

				if (e.key === 'Backspace') {
					this.#currentInput = this.#currentInput.slice(0, -1);
					this.#updateInputDisplay();
					this.#filterHints();
					return;
				}

				const key = e.key.toLowerCase();
				if (config.hintChars.includes(key)) {
					this.#currentInput += key;
					this.#updateInputDisplay();
					this.#filterHints();

					// Check for exact match (uniform-length hints = no prefix conflicts)
					const match = this.#hints.find((h) => h.hint === this.#currentInput);
					if (match) {
						this.#clickElement(match.element);
						this.#deactivate();
					} else {
						// Check if any hints still match
						const hasMatches = this.#hints.some((h) => h.hint.startsWith(this.#currentInput));
						if (!hasMatches) {
							// No matches - revert last key
							this.#currentInput = this.#currentInput.slice(0, -1);
							this.#updateInputDisplay();
							this.#filterHints();
						}
					}
				}
			},
			true,
		); // capture phase
	}

	#toggle(): void {
		if (this.#active) {
			this.#deactivate();
		} else {
			this.#activate();
		}
	}

	#activate(): void {
		this.#active = true;
		this.#currentInput = '';

		// Create input display
		this.#createInputDisplay();
		this.#attachResizeListener();

		const timings: Record<string, number> = {};
		const mark = (label: string): void => {
			if (config.debugTimings) timings[label] = performance.now();
		};
		const fmt = (value: number): string => value.toFixed(1);

		mark('start');

		// Collect elements using optimized pipeline
		const elements = sortElementsForHints(collectClickableElements());
		mark('collected');

		// Generate hint strings
		const hintStrings = this.#generateHints(elements.length);
		mark('generated');

		// Create hints
		this.#hints = elements.map((data, i) => ({
			element: data.element,
			hint: hintStrings[i],
			label: this.#createLabel(hintStrings[i]),
		}));
		mark('created');

		// Add border to hinted elements
		if (config.showElementBorder) {
			for (const hint of this.#hints) {
				if (isEditable(hint.element)) {
					hint.element.classList.add('link-hint-target-input');
				} else {
					hint.element.classList.add('link-hint-target');
				}
			}
		}
		mark('bordered');

		// Show hints using cached rects
		this.#showHints(elements);
		mark('shown');

		if (config.debugTimings) {
			const collectMs = timings.collected - timings.start;
			const generateMs = timings.generated - timings.collected;
			const createMs = timings.created - timings.generated;
			const borderMs = timings.bordered - timings.created;
			const showMs = timings.shown - timings.bordered;
			const totalMs = timings.shown - timings.start;

			// eslint-disable-next-line no-console
			console.debug(
				`[link-hints] elements=${elements.length} ` +
					`collect=${fmt(collectMs)}ms generate=${fmt(generateMs)}ms ` +
					`create=${fmt(createMs)}ms border=${fmt(borderMs)}ms ` +
					`show=${fmt(showMs)}ms total=${fmt(totalMs)}ms`,
			);
		}
	}

	#createInputDisplay(): void {
		this.#inputDisplay = document.createElement('div');
		this.#inputDisplay.className = 'link-hint-input';
		document.body.appendChild(this.#inputDisplay);
	}

	#updateInputDisplay(): void {
		if (this.#inputDisplay) {
			this.#inputDisplay.textContent = this.#currentInput.toUpperCase();
			this.#inputDisplay.style.display = this.#currentInput ? 'block' : 'none';
		}
	}

	#deactivate(): void {
		this.#active = false;
		this.#currentInput = '';
		this.#detachResizeListener();
		for (const hint of this.#hints) {
			hint.label.remove();
			hint.element.classList.remove('link-hint-target');
			hint.element.classList.remove('link-hint-target-input');
		}
		this.#hints = [];
		if (this.#inputDisplay) {
			this.#inputDisplay.remove();
			this.#inputDisplay = null;
		}
	}

	#attachResizeListener(): void {
		window.addEventListener('resize', this.#onResize);
	}

	#detachResizeListener(): void {
		window.removeEventListener('resize', this.#onResize);
		if (this.#resizeTimeoutId !== null) {
			window.clearTimeout(this.#resizeTimeoutId);
			this.#resizeTimeoutId = null;
		}
	}

	#onResize = (): void => {
		if (!this.#active) return;
		if (this.#resizeTimeoutId !== null) {
			window.clearTimeout(this.#resizeTimeoutId);
		}
		this.#resizeTimeoutId = window.setTimeout(() => {
			this.#resizeTimeoutId = null;
			this.#deactivate();
			this.#activate();
		}, 120);
	};

	#generateHints(count: number): string[] {
		if (count <= 0) return [];
		const chars = config.hintChars.toUpperCase();
		const base = chars.length;

		let length = 1;
		let capacity = base;
		while (capacity < count) {
			length += 1;
			capacity *= base;
		}

		const hints: string[] = [];
		for (let i = 0; i < count; i++) {
			let n = i;
			const digits = new Array<number>(length).fill(0);
			for (let pos = length - 1; pos >= 0; pos -= 1) {
				digits[pos] = n % base;
				n = Math.floor(n / base);
			}
			hints.push(
				digits
					.map((d) => chars[d])
					.join('')
					.toLowerCase(),
			);
		}

		return hints;
	}

	#createLabel(text: string): HTMLElement {
		const label = document.createElement('div');
		label.className = 'link-hint-label';
		label.textContent = text.toUpperCase();
		return label;
	}

	#showHints(elements: ElementData[]): void {
		const positions: Array<{ top: number; left: number }> = [];
		const fragment = document.createDocumentFragment();
		const scrollX = window.scrollX;
		const scrollY = window.scrollY;
		const minLeft = scrollX + 2;
		const maxLeft = scrollX + window.innerWidth - 30;
		const minTop = scrollY + 2;
		const offsetX = config.hintOffset.x;
		const offsetY = config.hintOffset.y;

		this.#hints.forEach((hint, i) => {
			const { rect } = elements[i];

			// Calculate horizontal position based on alignment
			let left =
				config.hintAlign === 'right'
					? rect.right + scrollX + offsetX
					: config.hintAlign === 'center'
						? rect.left + rect.width / 2 + scrollX + offsetX
						: rect.left + scrollX + offsetX;

			let top = rect.top + scrollY + offsetY;

			// Keep within viewport
			left = Math.max(minLeft, Math.min(maxLeft, left));
			top = Math.max(minTop, top);

			// Avoid overlapping with previous hints
			for (const pos of positions) {
				if (Math.abs(top - pos.top) < 16 && Math.abs(left - pos.left) < 24) {
					left = pos.left + 24;
					if (left > maxLeft) {
						left = minLeft;
						top = pos.top + 16;
					}
				}
			}

			positions.push({ top, left });

			hint.label.style.left = `${left}px`;
			hint.label.style.top = `${top}px`;
			fragment.appendChild(hint.label);
		});

		document.body.appendChild(fragment);
	}

	#filterHints(): void {
		for (const { hint, label } of this.#hints) {
			if (hint.startsWith(this.#currentInput)) {
				label.style.display = 'block';
				const matched = this.#currentInput.toUpperCase();
				const remaining = hint.slice(this.#currentInput.length).toUpperCase();
				label.innerHTML = `<span class="matched">${matched}</span>${remaining}`;
			} else {
				label.style.display = 'none';
			}
		}
	}

	#isEditableElement(element: HTMLElement): boolean {
		if ((element as HTMLInputElement).disabled) return false;
		const { localName, isContentEditable } = element;
		if (localName === 'textarea' || localName === 'select') return true;
		if (isContentEditable) return true;
		if (localName === 'input') {
			const { type } = element as HTMLInputElement;
			return !/^(button|checkbox|file|hidden|image|radio|reset|submit)$/i.test(type);
		}
		return false;
	}

	#dispatchMouseEvents(element: HTMLElement): void {
		// Get element center for realistic mouse coordinates
		const rect = element.getBoundingClientRect();
		const x = rect.left + rect.width / 2;
		const y = rect.top + rect.height / 2;

		const eventOptions = {
			bubbles: true,
			cancelable: true,
			composed: true,
			view: window,
			clientX: x,
			clientY: y,
			screenX: x + window.screenX,
			screenY: y + window.screenY,
		};

		// Dispatch full sequence of mouse events
		element.dispatchEvent(new MouseEvent('mouseenter', { ...eventOptions, bubbles: false }));
		element.dispatchEvent(new MouseEvent('mouseover', eventOptions));
		element.dispatchEvent(new MouseEvent('mousemove', eventOptions));
		element.dispatchEvent(
			new PointerEvent('pointerdown', { ...eventOptions, button: 0, buttons: 1 }),
		);
		element.dispatchEvent(new MouseEvent('mousedown', { ...eventOptions, button: 0, buttons: 1 }));
		element.dispatchEvent(new PointerEvent('pointerup', { ...eventOptions, button: 0 }));
		element.dispatchEvent(new MouseEvent('mouseup', { ...eventOptions, button: 0 }));
		element.dispatchEvent(new MouseEvent('click', { ...eventOptions, button: 0 }));
	}

	#getAnchorHref(anchor: HTMLAnchorElement): string | null {
		const rawHref = anchor.getAttribute('href');
		return rawHref ? rawHref.trim() : null;
	}

	#isJavascriptLink(anchor: HTMLAnchorElement): boolean {
		const rawHref = this.#getAnchorHref(anchor);
		return !!rawHref && /^\s*javascript:/i.test(rawHref);
	}

	#clickElement(element: HTMLElement): void {
		// Handle new tab modes
		if (this.#mode !== 'normal') {
			const url = this.#getElementUrl(element);
			if (url) {
				chrome.runtime.sendMessage({
					type: 'open-url',
					url,
					background: this.#mode === 'backgroundTab',
				});
				return;
			}
			// Fall through to normal click if no URL
		}

		if (this.#isEditableElement(element)) {
			// Click to potentially close any overlays/modals blocking focus
			element.click();
			element.focus();
			if (element.localName === 'input' || element.localName === 'textarea') {
				try {
					const input = element as HTMLInputElement | HTMLTextAreaElement;
					input.setSelectionRange(input.value.length, input.value.length);
				} catch {
					// Some input types don't support setSelectionRange
				}
			}
		} else {
			// Focus first for elements that need it
			if (element.tabIndex >= 0) {
				element.focus();
			}
			// Dispatch full mouse event sequence (BrowseCut/Surfingkeys-style)
			const anchor = element.tagName === 'A' ? (element as HTMLAnchorElement) : null;
			if (anchor && this.#isJavascriptLink(anchor)) {
				// Prevent default javascript: navigation while still allowing handlers
				element.addEventListener('click', (event) => event.preventDefault(), {
					capture: true,
					once: true,
				});
			}
			this.#dispatchMouseEvents(element);
		}
	}

	#getElementUrl(element: HTMLElement): string | null {
		// Check if element is an anchor
		if (element.tagName === 'A') {
			const anchor = element as HTMLAnchorElement;
			if (this.#isJavascriptLink(anchor)) return null;
			const rawHref = this.#getAnchorHref(anchor);
			if (!rawHref) return null;
			try {
				return new URL(rawHref, window.location.href).href;
			} catch {
				return null;
			}
		}
		// Check for closest anchor parent
		const anchor = element.closest('a');
		if (anchor) {
			if (this.#isJavascriptLink(anchor)) return null;
			const rawHref = this.#getAnchorHref(anchor);
			if (!rawHref) return null;
			try {
				return new URL(rawHref, window.location.href).href;
			} catch {
				return null;
			}
		}
		return null;
	}
}

// ============================================================================
// Incremental Selection
// ============================================================================

class IncrementalSelection {
	#rangeStack: Range[] = [];
	#caretMode = false;
	#linewiseMode = false;
	#indicator: HTMLDivElement | null = null;
	#caret: HTMLDivElement | null = null;
	#caretUpdateId: number | null = null;
	#preferredCaretX: number | null = null;

	constructor() {
		document.addEventListener('keydown', (event) => {
			if (event.key === 'Escape' && this.#caretMode) {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
				this.#exitCaretMode();
			}
		});

		document.addEventListener('selectionchange', this.#scheduleCaretUpdate);
		window.addEventListener('scroll', this.#scheduleCaretUpdate, { passive: true });
		window.addEventListener('resize', this.#scheduleCaretUpdate);
		document.addEventListener('focusin', this.#scheduleCaretUpdate);
		document.addEventListener('focusout', this.#scheduleCaretUpdate);

		const init = (): void => {
			this.#ensureCaret();
			this.#scheduleCaretUpdate();
		};

		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', init, { once: true });
		} else {
			window.setTimeout(init, 0);
		}
	}

	toggle(): void {
		if (this.#caretMode) {
			this.#exitCaretMode();
		} else {
			this.#enterCaretMode();
		}
		this.#scheduleCaretUpdate();
	}

	toggleLinewise(): void {
		if (this.#caretMode && this.#linewiseMode) {
			this.#exitCaretMode();
		} else {
			this.#enterLinewiseMode();
		}
		this.#scheduleCaretUpdate();
	}

	expand(): void {
		const selection = window.getSelection();
		if (!selection) return;

		if (selection.rangeCount === 0 || selection.toString() === '') {
			if (this.#seedSelectionFromFindHighlight(selection)) return;
		}

		if (selection.rangeCount === 0) return;

		const currentRange = selection.getRangeAt(0).cloneRange();
		this.#syncStack(currentRange);

		const container = this.#getContainingElement(currentRange);
		if (!container) return;

		const containerRange = this.#rangeForElement(container);
		let nextRange: Range | null = null;

		if (!this.#isSameRange(currentRange, containerRange)) {
			nextRange = containerRange;
		} else {
			const parent = container.parentElement;
			if (!parent) return;
			nextRange = this.#rangeForElement(parent);
		}

		this.#applyRange(selection, nextRange);
		this.#rangeStack.push(nextRange.cloneRange());
		this.#caretMode = true;
		this.#showIndicator('VISUAL');
		this.#scheduleCaretUpdate();
	}

	shrink(): void {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return;

		const currentRange = selection.getRangeAt(0).cloneRange();
		if (this.#rangeStack.length === 0) {
			this.#rangeStack = [currentRange];
			return;
		}

		const lastRange = this.#rangeStack[this.#rangeStack.length - 1];
		if (!this.#isSameRange(currentRange, lastRange)) {
			this.#rangeStack = [currentRange];
			return;
		}

		if (this.#rangeStack.length <= 1) return;

		this.#rangeStack.pop();
		const previousRange = this.#rangeStack[this.#rangeStack.length - 1];
		this.#applyRange(selection, previousRange);
		this.#caretMode = true;
		this.#showIndicator('VISUAL');
		this.#scheduleCaretUpdate();
	}

	yank(): void {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return;

		const text = selection.toString();
		if (!text) return;

		void this.#copyText(text);
	}

	moveWord(direction: 'forward' | 'backward', count = 1): void {
		const selection = this.#ensureCaret();
		if (!selection) return;

		const steps = Math.max(1, count);
		const alter = this.#caretMode ? 'extend' : 'move';
		const withModify = selection as Selection & {
			modify?: (alter: string, direction: string, granularity: string) => void;
		};
		if (!withModify.modify) return;

		for (let i = 0; i < steps; i += 1) {
			withModify.modify(alter, direction, 'word');
		}

		if (this.#linewiseMode) {
			this.#normalizeLinewiseSelection(selection);
		}
		this.#preferredCaretX = null;
		this.#scheduleCaretUpdate();
	}

	moveWordEnd(count = 1): void {
		const selection = this.#ensureCaret();
		if (!selection) return;

		const steps = Math.max(1, count);
		const alter = this.#caretMode ? 'extend' : 'move';
		const withModify = selection as Selection & {
			modify?: (alter: string, direction: string, granularity: string) => void;
		};
		if (!withModify.modify) return;

		for (let i = 0; i < steps; i += 1) {
			withModify.modify(alter, 'forward', 'word');
			if (!this.#caretMode) {
				withModify.modify('move', 'backward', 'character');
			}
		}

		if (this.#linewiseMode) {
			this.#normalizeLinewiseSelection(selection);
		}
		this.#preferredCaretX = null;
		this.#scheduleCaretUpdate();
	}

	moveBigWord(direction: 'forward' | 'backward', count = 1): void {
		const selection = this.#ensureCaret();
		if (!selection) return;

		const steps = Math.max(1, count);
		for (let i = 0; i < steps; i += 1) {
			const moved = this.#moveWhitespaceWordOnce(selection, direction, this.#caretMode);
			if (!moved) break;
		}

		if (this.#linewiseMode) {
			this.#normalizeLinewiseSelection(selection);
		}
		this.#preferredCaretX = null;
		this.#scheduleCaretUpdate();
	}

	moveLine(boundary: 'start' | 'first' | 'end', count = 1): void {
		const selection = this.#ensureCaret();
		if (!selection) return;

		const steps = Math.max(1, count);
		const alter = this.#caretMode ? 'extend' : 'move';
		const withModify = selection as Selection & {
			modify?: (alter: string, direction: string, granularity: string) => void;
		};
		if (!withModify.modify) return;

		for (let i = 1; i < steps; i += 1) {
			withModify.modify(alter, 'forward', 'line');
		}

		if (boundary === 'end') {
			withModify.modify(alter, 'forward', 'lineboundary');
		} else {
			withModify.modify(alter, 'backward', 'lineboundary');
			if (boundary === 'first') {
				// Best-effort: step to first word on the line.
				withModify.modify(alter, 'forward', 'word');
			}
		}

		if (this.#linewiseMode) {
			this.#normalizeLinewiseSelection(selection);
		}
		this.#preferredCaretX = null;
		this.#scheduleCaretUpdate();
	}

	moveParagraph(direction: 'prev' | 'next', count = 1): void {
		const selection = this.#ensureCaret();
		if (!selection) return;

		const steps = Math.max(1, count);
		const alter = this.#caretMode ? 'extend' : 'move';
		const withModify = selection as Selection & {
			modify?: (alter: string, direction: string, granularity: string) => void;
		};
		if (!withModify.modify) return;

		for (let i = 0; i < steps; i += 1) {
			withModify.modify(alter, direction === 'next' ? 'forward' : 'backward', 'paragraph');
		}

		if (this.#linewiseMode) {
			this.#normalizeLinewiseSelection(selection);
		}
		this.#preferredCaretX = null;
		this.#scheduleCaretUpdate();
	}

	selectTextObject(kind: 'word' | 'paragraph', around: boolean): void {
		const selection = window.getSelection();
		if (!selection) return;

		let range: Range | null = null;
		if (selection.rangeCount > 0) {
			range = this.#rangeFromSelectionFocus(selection) ?? selection.getRangeAt(0).cloneRange();
		} else {
			range = this.#findInitialRange();
		}
		if (!range) return;

		selection.removeAllRanges();
		selection.addRange(range);

		const applied =
			kind === 'word'
				? this.#selectWordObject(selection, around)
				: this.#selectParagraphObject(selection, around);
		if (!applied) return;

		this.#rangeStack = [selection.getRangeAt(0).cloneRange()];
		this.#caretMode = true;
		this.#linewiseMode = false;
		this.#showIndicator('VISUAL');
		this.#preferredCaretX = null;
		this.#scheduleCaretUpdate();
	}

	getWordUnderCaret(): string | null {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return null;

		const range = this.#rangeFromSelectionFocus(selection) ?? selection.getRangeAt(0).cloneRange();
		let node: Node = range.startContainer;
		let offset = range.startOffset;

		if (node.nodeType === Node.ELEMENT_NODE) {
			const element = node as Element;
			const childAt = element.childNodes[offset];
			const childBefore = element.childNodes[offset - 1];
			const child = childAt ?? childBefore;
			if (child) {
				node = child;
				if (child.nodeType === Node.TEXT_NODE) {
					offset = child === childAt ? 0 : (child as Text).data.length;
				} else {
					offset = 0;
				}
			}
		}

		if (node.nodeType !== Node.TEXT_NODE) return null;
		const textNode = node as Text;
		const text = textNode.data;
		if (!text) return null;

		let index = Math.min(Math.max(offset, 0), text.length);
		if (index === text.length && index > 0) index -= 1;

		const isWordChar = (char: string): boolean => /[A-Za-z0-9_]/.test(char);

		if (!isWordChar(text[index])) {
			if (index > 0 && isWordChar(text[index - 1])) {
				index -= 1;
			} else {
				return null;
			}
		}

		let start = index;
		let end = index + 1;
		while (start > 0 && isWordChar(text[start - 1])) start -= 1;
		while (end < text.length && isWordChar(text[end])) end += 1;
		const word = text.slice(start, end);
		return word || null;
	}

	#moveWhitespaceWordOnce(
		selection: Selection,
		direction: 'forward' | 'backward',
		extend: boolean,
	): boolean {
		const range = this.#rangeFromSelectionFocus(selection);
		const position = range ? this.#getTextPositionFromRange(range) : null;
		if (!position) return false;

		const nodes = this.#collectVisibleTextNodes();
		if (nodes.length === 0) return false;

		const startIndex = nodes.indexOf(position.node);
		if (startIndex === -1) return false;

		const isSpace = (char: string): boolean => /\s/.test(char);

		if (direction === 'forward') {
			let idx = startIndex;
			let offset = position.offset;
			let inWord = false;
			const startText = nodes[startIndex].data;
			if (
				(offset > 0 && !isSpace(startText[offset - 1])) ||
				(offset < startText.length && !isSpace(startText[offset]))
			) {
				inWord = true;
			}

			for (; idx < nodes.length; idx += 1) {
				const text = nodes[idx].data;
				let j = idx === startIndex ? offset : 0;
				for (; j < text.length; j += 1) {
					const ch = text[j];
					if (inWord) {
						if (isSpace(ch)) inWord = false;
					} else if (!isSpace(ch)) {
						return this.#applyCaretPosition(selection, nodes[idx], j, extend);
					}
				}
				offset = 0;
			}
			return false;
		}

		// backward
		let idx = startIndex;
		let offset = position.offset;
		for (; idx >= 0; idx -= 1) {
			const text = nodes[idx].data;
			let j = idx === startIndex ? offset - 1 : text.length - 1;
			for (; j >= 0; j -= 1) {
				if (!isSpace(text[j])) {
					while (j >= 0 && !isSpace(text[j])) j -= 1;
					const target = j + 1;
					return this.#applyCaretPosition(selection, nodes[idx], target, extend);
				}
			}
			offset = 0;
		}
		return false;
	}

	#applyCaretPosition(selection: Selection, node: Text, offset: number, extend: boolean): boolean {
		const clamped = Math.max(0, Math.min(offset, node.data.length));
		if (extend) {
			const extender = (
				selection as Selection & {
					extend?: (node: Node, offset: number) => void;
				}
			).extend;
			if (extender) {
				extender.call(selection, node, clamped);
				return true;
			}
			const anchorNode = selection.anchorNode;
			if (anchorNode) {
				const withSetBase = selection as Selection & {
					setBaseAndExtent?: (
						anchorNode: Node,
						anchorOffset: number,
						focusNode: Node,
						focusOffset: number,
					) => void;
				};
				if (withSetBase.setBaseAndExtent) {
					withSetBase.setBaseAndExtent(anchorNode, selection.anchorOffset, node, clamped);
					return true;
				}
			}
		}

		const range = document.createRange();
		range.setStart(node, clamped);
		range.collapse(true);
		selection.removeAllRanges();
		selection.addRange(range);
		return true;
	}

	#getTextPositionFromRange(range: Range): { node: Text; offset: number } | null {
		const node = range.startContainer;
		const offset = range.startOffset;

		if (node.nodeType === Node.TEXT_NODE) {
			return { node: node as Text, offset };
		}

		if (node.nodeType === Node.ELEMENT_NODE) {
			const element = node as Element;
			const childAt = element.childNodes[offset];
			const childBefore = element.childNodes[offset - 1];
			const child = childAt ?? childBefore;
			if (child) {
				const textNode = this.#findTextNodeInSubtree(
					child,
					child === childAt ? 'forward' : 'backward',
				);
				if (textNode) {
					return {
						node: textNode,
						offset: child === childAt ? 0 : textNode.data.length,
					};
				}
			}
		}

		return null;
	}

	#findTextNodeInSubtree(node: Node, direction: 'forward' | 'backward'): Text | null {
		const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
		if (direction === 'forward') {
			for (let current = walker.nextNode(); current; current = walker.nextNode()) {
				const textNode = current as Text;
				if (this.#isTextNodeVisible(textNode)) return textNode;
			}
			return null;
		}

		const nodes: Text[] = [];
		for (let current = walker.nextNode(); current; current = walker.nextNode()) {
			const textNode = current as Text;
			if (this.#isTextNodeVisible(textNode)) nodes.push(textNode);
		}
		return nodes.length > 0 ? nodes[nodes.length - 1] : null;
	}

	#collectVisibleTextNodes(): Text[] {
		const nodes: Text[] = [];
		const root = document.body ?? document.documentElement;
		if (!root) return nodes;
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		for (let current = walker.nextNode(); current; current = walker.nextNode()) {
			const textNode = current as Text;
			if (this.#isTextNodeVisible(textNode)) nodes.push(textNode);
		}
		return nodes;
	}

	#selectWordObject(selection: Selection, around: boolean): boolean {
		if (selection.rangeCount === 0) return false;
		const range = selection.getRangeAt(0).cloneRange();
		const position = this.#getTextPositionFromRange(range);
		if (!position) return false;

		const text = position.node.data;
		if (!text) return false;

		let index = Math.min(Math.max(position.offset, 0), text.length);
		if (index === text.length && index > 0) index -= 1;

		const isWordChar = (char: string): boolean => /[A-Za-z0-9_]/.test(char);

		if (!isWordChar(text[index])) {
			if (index > 0 && isWordChar(text[index - 1])) {
				index -= 1;
			} else {
				const match = text.slice(index).match(/[A-Za-z0-9_]+/);
				if (!match || match.index === undefined) return false;
				index = index + match.index;
			}
		}

		let start = index;
		let end = index + 1;
		while (start > 0 && isWordChar(text[start - 1])) start -= 1;
		while (end < text.length && isWordChar(text[end])) end += 1;

		let start2 = start;
		let end2 = end;
		if (around) {
			let trailing = end;
			while (trailing < text.length && /\s/.test(text[trailing])) trailing += 1;
			let leading = start;
			while (leading > 0 && /\s/.test(text[leading - 1])) leading -= 1;
			if (trailing > end) {
				end2 = trailing;
			} else if (leading < start) {
				start2 = leading;
			}
		}

		const wordRange = document.createRange();
		wordRange.setStart(position.node, start2);
		wordRange.setEnd(position.node, end2);
		selection.removeAllRanges();
		selection.addRange(wordRange);
		return true;
	}

	#selectParagraphObject(selection: Selection, around: boolean): boolean {
		if (selection.rangeCount === 0) return false;
		const baseRange = selection.getRangeAt(0).cloneRange();
		const container = this.#findParagraphContainer(baseRange);
		if (!container) return false;

		const paragraphRange = document.createRange();
		if (around) {
			paragraphRange.setStartBefore(container);
			paragraphRange.setEndAfter(container);
			const prev = container.previousSibling;
			if (prev && prev.nodeType === Node.TEXT_NODE && /\s+/.test(prev.textContent ?? '')) {
				paragraphRange.setStartBefore(prev);
			}
			const next = container.nextSibling;
			if (next && next.nodeType === Node.TEXT_NODE && /\s+/.test(next.textContent ?? '')) {
				paragraphRange.setEndAfter(next);
			}
		} else {
			paragraphRange.selectNodeContents(container);
		}

		selection.removeAllRanges();
		selection.addRange(paragraphRange);
		return true;
	}

	#findParagraphContainer(range: Range): HTMLElement | null {
		let container = this.#getContainingElement(range) as HTMLElement | null;
		while (container && container !== document.body && container !== document.documentElement) {
			const style = getComputedStyle(container);
			const display = style.display;
			if (
				display === 'block' ||
				display === 'list-item' ||
				display === 'table' ||
				display === 'table-row' ||
				display === 'table-cell' ||
				display === 'flex' ||
				display === 'grid'
			) {
				return container;
			}
			container = container.parentElement;
		}
		return this.#getContainingElement(range) as HTMLElement | null;
	}

	swapSelectionEndpoint(): void {
		if (!this.#caretMode) return;
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

		const anchorNode = selection.anchorNode;
		const focusNode = selection.focusNode;
		if (!anchorNode || !focusNode) return;

		const anchorOffset = selection.anchorOffset;
		const focusOffset = selection.focusOffset;

		const withSetBase = selection as Selection & {
			setBaseAndExtent?: (
				anchorNode: Node,
				anchorOffset: number,
				focusNode: Node,
				focusOffset: number,
			) => void;
		};

		if (withSetBase.setBaseAndExtent) {
			withSetBase.setBaseAndExtent(focusNode, focusOffset, anchorNode, anchorOffset);
		} else {
			const extender = (
				selection as Selection & {
					extend?: (node: Node, offset: number) => void;
				}
			).extend;
			selection.removeAllRanges();
			const range = document.createRange();
			range.setStart(focusNode, focusOffset);
			range.collapse(true);
			selection.addRange(range);
			if (extender) {
				extender.call(selection, anchorNode, anchorOffset);
			} else {
				range.setEnd(anchorNode, anchorOffset);
				selection.removeAllRanges();
				selection.addRange(range);
			}
		}

		this.#preferredCaretX = null;
		if (this.#linewiseMode) {
			this.#normalizeLinewiseSelection(selection);
		}
		this.#scheduleCaretUpdate();
	}

	moveCaret(direction: 'left' | 'right' | 'up' | 'down', count = 1): void {
		const selection = this.#ensureCaret();
		if (!selection) return;

		const steps = Math.max(1, count);
		const extend = this.#caretMode;

		if (!extend && selection.rangeCount > 0 && !selection.isCollapsed) {
			const range = this.#rangeFromSelectionFocus(selection);
			if (range) {
				selection.removeAllRanges();
				selection.addRange(range);
			}
		}

		if (direction === 'left' || direction === 'right') {
			this.#moveCaretHorizontal(selection, direction, steps, extend);
		} else {
			this.#moveCaretVertical(selection, direction, steps, extend);
		}

		if (this.#linewiseMode) {
			this.#normalizeLinewiseSelection(selection);
		}
		this.#scheduleCaretUpdate();
	}

	#syncStack(currentRange: Range): void {
		if (this.#rangeStack.length === 0) {
			this.#rangeStack = [currentRange.cloneRange()];
			return;
		}

		const lastRange = this.#rangeStack[this.#rangeStack.length - 1];
		if (!this.#isSameRange(currentRange, lastRange)) {
			this.#rangeStack = [currentRange.cloneRange()];
		}
	}

	#enterCaretMode(): void {
		const selection = window.getSelection();
		if (!selection) return;

		let range: Range | null = this.#rangeFromSelectionFocus(selection);
		if (!range) range = this.#findInitialRange();

		if (!range) return;

		selection.removeAllRanges();
		selection.addRange(range);
		this.#rangeStack = [range.cloneRange()];
		this.#caretMode = true;
		this.#linewiseMode = false;
		this.#showIndicator('VISUAL');
		this.#selectCharacterAtCaret(selection);
		this.#scheduleCaretUpdate();
	}

	#enterLinewiseMode(): void {
		const selection = window.getSelection();
		if (!selection) return;

		let range: Range | null = null;
		if (selection.rangeCount > 0) {
			range = selection.getRangeAt(0).cloneRange();
		} else {
			range = this.#rangeFromSelectionFocus(selection);
			if (!range) range = this.#findInitialRange();
			if (!range) return;
			selection.removeAllRanges();
			selection.addRange(range);
		}

		this.#rangeStack = [range.cloneRange()];
		this.#caretMode = true;
		this.#linewiseMode = true;
		this.#showIndicator('VISUAL LINE');
		this.#normalizeLinewiseSelection(selection);
		this.#scheduleCaretUpdate();
	}

	#exitCaretMode(): void {
		const selection = window.getSelection();
		if (selection && selection.rangeCount > 0) {
			const range = this.#rangeFromSelectionFocus(selection);
			if (range) {
				selection.removeAllRanges();
				selection.addRange(range);
			}
		} else {
			this.#ensureCaret();
		}
		this.#rangeStack = [];
		this.#caretMode = false;
		this.#linewiseMode = false;
		this.#hideIndicator();
		this.#scheduleCaretUpdate();
	}

	#findInitialRange(): Range | null {
		const active = document.activeElement as HTMLElement | null;
		if (active?.isContentEditable) {
			const range = document.createRange();
			range.selectNodeContents(active);
			range.collapse(true);
			return range;
		}

		return this.#findFirstVisibleTextRange();
	}

	#findFirstVisibleTextRange(): Range | null {
		if (!document.body) return null;
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const text = node.textContent?.trim();
			if (!text) continue;
			const textNode = node as Text;
			if (!this.#isTextNodeVisible(textNode)) continue;
			const range = document.createRange();
			range.setStart(textNode, 0);
			range.setEnd(textNode, 0);
			return range;
		}
		return null;
	}

	#normalizeLinewiseSelection(selection: Selection): void {
		if (!this.#linewiseMode) return;
		if (selection.rangeCount === 0) return;
		const anchorNode = selection.anchorNode;
		const focusNode = selection.focusNode;
		if (!anchorNode || !focusNode) return;

		const anchorRange = this.#collapsedRange(anchorNode, selection.anchorOffset);
		const focusRange = this.#collapsedRange(focusNode, selection.focusOffset);
		if (!anchorRange || !focusRange) return;

		const order = anchorRange.compareBoundaryPoints(Range.START_TO_START, focusRange);
		const anchorBoundary =
			order <= 0
				? this.#lineBoundaryFromRange(anchorRange, 'start')
				: this.#lineBoundaryFromRange(anchorRange, 'end');
		const focusBoundary =
			order <= 0
				? this.#lineBoundaryFromRange(focusRange, 'end')
				: this.#lineBoundaryFromRange(focusRange, 'start');
		if (!anchorBoundary || !focusBoundary) return;

		this.#setSelectionWithDirection(
			selection,
			anchorBoundary.node,
			anchorBoundary.offset,
			focusBoundary.node,
			focusBoundary.offset,
		);
	}

	#collapsedRange(node: Node, offset: number): Range | null {
		const range = document.createRange();
		try {
			range.setStart(node, offset);
			range.collapse(true);
			return range;
		} catch {
			return null;
		}
	}

	#lineBoundaryFromRange(
		range: Range,
		edge: 'start' | 'end',
	): { node: Node; offset: number } | null {
		const selection = window.getSelection();
		if (selection) {
			const withModify = selection as Selection & {
				modify?: (alter: string, direction: string, granularity: string) => void;
			};
			if (withModify.modify) {
				selection.removeAllRanges();
				selection.addRange(range);
				withModify.modify('move', edge === 'start' ? 'backward' : 'forward', 'lineboundary');
				if (selection.focusNode) {
					return { node: selection.focusNode, offset: selection.focusOffset };
				}
			}
		}

		const rect = this.#getCaretRect(range);
		if (!rect) return { node: range.startContainer, offset: range.startOffset };
		const y = rect.top + rect.height / 2;
		const x = edge === 'start' ? 1 : window.innerWidth - 2;
		const boundaryRange = this.#rangeFromPoint(x, y);
		if (!boundaryRange) return { node: range.startContainer, offset: range.startOffset };
		return { node: boundaryRange.startContainer, offset: boundaryRange.startOffset };
	}

	#setSelectionWithDirection(
		selection: Selection,
		anchorNode: Node,
		anchorOffset: number,
		focusNode: Node,
		focusOffset: number,
	): void {
		const withSetBase = selection as Selection & {
			setBaseAndExtent?: (
				anchorNode: Node,
				anchorOffset: number,
				focusNode: Node,
				focusOffset: number,
			) => void;
		};

		if (withSetBase.setBaseAndExtent) {
			withSetBase.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
			return;
		}

		selection.removeAllRanges();
		const range = document.createRange();
		range.setStart(anchorNode, anchorOffset);
		range.collapse(true);
		selection.addRange(range);

		const extender = (
			selection as Selection & {
				extend?: (node: Node, offset: number) => void;
			}
		).extend;
		if (extender) {
			extender.call(selection, focusNode, focusOffset);
		} else {
			range.setEnd(focusNode, focusOffset);
			selection.removeAllRanges();
			selection.addRange(range);
		}
	}

	#selectCharacterAtCaret(selection: Selection): void {
		if (selection.rangeCount === 0 || !selection.isCollapsed) return;

		const withModify = selection as Selection & {
			modify?: (alter: string, direction: string, granularity: string) => void;
		};

		if (withModify.modify) {
			withModify.modify('extend', 'forward', 'character');
			if (selection.isCollapsed) {
				withModify.modify('extend', 'backward', 'character');
			}
			return;
		}

		const range = selection.getRangeAt(0).cloneRange();
		const node = range.startContainer;
		if (node.nodeType === Node.TEXT_NODE) {
			const text = node as Text;
			const length = text.data.length;
			if (range.startOffset < length) {
				range.setEnd(node, range.startOffset + 1);
			} else if (range.startOffset > 0) {
				range.setStart(node, range.startOffset - 1);
			} else {
				return;
			}
			selection.removeAllRanges();
			selection.addRange(range);
		}
	}

	#rangeFromSelectionFocus(selection: Selection): Range | null {
		const focusNode = selection.focusNode;
		if (focusNode) {
			const range = document.createRange();
			try {
				range.setStart(focusNode, selection.focusOffset);
				range.collapse(true);
				return range;
			} catch {
				// Fall back to existing range
			}
		}

		if (selection.rangeCount > 0) {
			const range = selection.getRangeAt(0).cloneRange();
			range.collapse(false);
			return range;
		}

		return null;
	}

	#showIndicator(label: string): void {
		if (!this.#indicator) {
			const indicator = document.createElement('div');
			indicator.className = 'visual-mode-indicator';
			this.#indicator = indicator;
		}

		if (!this.#indicator.isConnected) {
			getBottomBar().appendChild(this.#indicator);
		}

		this.#indicator.textContent = label;
		this.#indicator.classList.add('is-visible');
	}

	#hideIndicator(): void {
		if (!this.#indicator) return;
		this.#indicator.classList.remove('is-visible');
	}

	#isTextNodeVisible(node: Text): boolean {
		const parent = node.parentElement;
		if (!parent) return false;
		const style = getComputedStyle(parent);
		if (style.display === 'none' || style.visibility === 'hidden') return false;
		const range = document.createRange();
		range.selectNodeContents(node);
		const rect = range.getBoundingClientRect();
		if (rect.width === 0 && rect.height === 0) return false;
		if (rect.bottom <= 0 || rect.top >= window.innerHeight) return false;
		if (rect.right <= 0 || rect.left >= window.innerWidth) return false;
		return true;
	}

	#getContainingElement(range: Range): Element | null {
		let node: Node | null = range.commonAncestorContainer;
		if (node.nodeType === Node.TEXT_NODE) {
			node = node.parentElement;
		}
		if (node && node.nodeType === Node.ELEMENT_NODE) {
			return node as Element;
		}
		return null;
	}

	#rangeForElement(element: Element): Range {
		const range = document.createRange();
		range.selectNodeContents(element);
		return range;
	}

	#seedSelectionFromFindHighlight(selection: Selection): boolean {
		const highlight =
			document.querySelector<HTMLElement>('.hint-find-highlight-current') ??
			document.querySelector<HTMLElement>('.hint-find-highlight');
		if (!highlight) return false;

		const range = document.createRange();
		range.selectNodeContents(highlight);
		selection.removeAllRanges();
		selection.addRange(range);
		this.#rangeStack = [range.cloneRange()];
		this.#caretMode = true;
		this.#showIndicator('VISUAL');
		this.#scheduleCaretUpdate();
		return true;
	}

	#applyRange(selection: Selection, range: Range): void {
		selection.removeAllRanges();
		selection.addRange(range);
	}

	#isSameRange(a: Range, b: Range): boolean {
		return (
			a.startContainer === b.startContainer &&
			a.startOffset === b.startOffset &&
			a.endContainer === b.endContainer &&
			a.endOffset === b.endOffset
		);
	}

	#scheduleCaretUpdate = (): void => {
		if (this.#caretUpdateId !== null) return;
		this.#caretUpdateId = window.requestAnimationFrame(() => {
			this.#caretUpdateId = null;
			this.#updateCaret();
		});
	};

	#ensureCaret(): Selection | null {
		if (this.#isEditableActive()) {
			this.#hideCaret();
			return null;
		}

		const selection = window.getSelection();
		if (!selection) return null;

		if (selection.rangeCount > 0) return selection;

		const range = this.#findInitialRange();
		if (!range) return null;

		selection.removeAllRanges();
		selection.addRange(range);
		return selection;
	}

	#moveCaretHorizontal(
		selection: Selection,
		direction: 'left' | 'right',
		steps: number,
		extend: boolean,
	): void {
		const withModify = selection as Selection & {
			modify?: (alter: string, direction: string, granularity: string) => void;
		};
		const modify = withModify.modify?.bind(selection);
		if (modify) {
			const alter = extend ? 'extend' : 'move';
			const dir = direction === 'left' ? 'backward' : 'forward';
			for (let i = 0; i < steps; i += 1) {
				modify(alter, dir, 'character');
			}
			this.#preferredCaretX = null;
			return;
		}

		this.#moveCaretByPoint(selection, direction, steps, extend);
		this.#preferredCaretX = null;
	}

	#moveCaretVertical(
		selection: Selection,
		direction: 'up' | 'down',
		steps: number,
		extend: boolean,
	): void {
		const startRange = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
		if (!startRange) return;

		const startRect = this.#getCaretRect(startRange);
		if (!startRect) return;

		const preferredX = this.#preferredCaretX ?? startRect.left;
		let currentRange = startRange;
		let currentRect = startRect;

		for (let i = 0; i < steps; i += 1) {
			const step = Math.max(4, currentRect.height || 16);
			const targetY = direction === 'up' ? currentRect.top - step : currentRect.bottom + step;
			const nextRange = this.#rangeFromPoint(preferredX, targetY);
			if (!nextRange) break;
			if (this.#isSameRange(currentRange, nextRange)) break;

			nextRange.collapse(true);
			const extender = (
				selection as Selection & {
					extend?: (node: Node, offset: number) => void;
				}
			).extend;
			if (extend && extender) {
				extender.call(selection, nextRange.startContainer, nextRange.startOffset);
			} else {
				selection.removeAllRanges();
				selection.addRange(nextRange);
			}

			currentRange = nextRange;
			currentRect = this.#getCaretRect(currentRange) ?? currentRect;
		}

		this.#preferredCaretX = preferredX;
	}

	#moveCaretByPoint(
		selection: Selection,
		direction: 'left' | 'right',
		steps: number,
		extend: boolean,
	): void {
		let currentRange = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
		if (!currentRange) return;

		let currentRect = this.#getCaretRect(currentRange);
		if (!currentRect) return;

		for (let i = 0; i < steps; i += 1) {
			const delta = direction === 'left' ? -1 : 1;
			const xBase = direction === 'left' ? currentRect.left : currentRect.right;
			const targetX = xBase + delta * 8;
			const targetY = currentRect.top + currentRect.height / 2;
			const nextRange = this.#rangeFromPoint(targetX, targetY);
			if (!nextRange) break;
			if (this.#isSameRange(currentRange, nextRange)) break;

			nextRange.collapse(true);
			const extender = (
				selection as Selection & {
					extend?: (node: Node, offset: number) => void;
				}
			).extend;
			if (extend && extender) {
				extender.call(selection, nextRange.startContainer, nextRange.startOffset);
			} else {
				selection.removeAllRanges();
				selection.addRange(nextRange);
			}

			currentRange = nextRange;
			currentRect = this.#getCaretRect(currentRange) ?? currentRect;
		}
	}

	#updateCaret(): void {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) {
			this.#hideCaret();
			return;
		}

		if (this.#isEditableActive()) {
			this.#hideCaret();
			return;
		}

		if (!this.#caretMode && !selection.isCollapsed) {
			this.#hideCaret();
			return;
		}

		const range =
			selection.isCollapsed || !this.#caretMode
				? selection.getRangeAt(0)
				: this.#rangeFromSelectionFocus(selection);
		if (!range) {
			this.#hideCaret();
			return;
		}
		const rect = this.#getCaretRect(range);
		if (!rect) {
			this.#hideCaret();
			return;
		}

		const caret = this.#getCaretElement();
		caret.classList.toggle('is-visual', this.#caretMode);
		caret.classList.toggle('is-normal', !this.#caretMode);

		const blockRect = this.#getBlockCaretRect(range, rect);
		if (!blockRect) {
			this.#hideCaret();
			return;
		}
		const height = this.#getCaretHeight(range, rect);
		const blockHeight = Math.max(12, blockRect.height || height);
		const blockWidth = Math.max(8, blockRect.width || 8);
		caret.style.left = `${blockRect.left + window.scrollX}px`;
		caret.style.top = `${blockRect.top + window.scrollY}px`;
		caret.style.height = `${blockHeight}px`;
		caret.style.width = `${blockWidth}px`;

		caret.style.display = 'block';
	}

	#getCaretHeight(range: Range, rect: DOMRect): number {
		if (rect.height > 0) return Math.max(12, rect.height);
		const container =
			range.startContainer.nodeType === Node.TEXT_NODE
				? range.startContainer.parentElement
				: (range.startContainer as HTMLElement | null);
		if (container) {
			const style = getComputedStyle(container);
			const lineHeight = Number.parseFloat(style.lineHeight);
			if (!Number.isNaN(lineHeight)) return Math.max(12, lineHeight);
			const fontSize = Number.parseFloat(style.fontSize);
			if (!Number.isNaN(fontSize)) return Math.max(12, fontSize * 1.2);
		}
		return 16;
	}

	#getCaretRect(range: Range): DOMRect | null {
		const rects = range.getClientRects();
		if (rects.length > 0) return rects[0];
		const rect = range.getBoundingClientRect();
		if (rect.height > 0 || rect.width > 0) return rect;
		return null;
	}

	#getBlockCaretRect(
		range: Range,
		fallbackRect: DOMRect,
	): { left: number; top: number; width: number; height: number } | null {
		const node = range.startContainer;
		if (node.nodeType === Node.TEXT_NODE) {
			const textNode = node as Text;
			const length = textNode.data.length;
			if (length > 0) {
				let start = range.startOffset;
				if (start >= length) start = length - 1;
				if (start < 0) start = 0;
				const charRange = document.createRange();
				try {
					charRange.setStart(textNode, start);
					charRange.setEnd(textNode, Math.min(length, start + 1));
					const rects = charRange.getClientRects();
					if (rects.length > 0) {
						const rect = rects[0];
						if (rect.width > 0 || rect.height > 0) {
							return {
								left: rect.left,
								top: rect.top,
								width: rect.width,
								height: rect.height,
							};
						}
					}
					const rect = charRange.getBoundingClientRect();
					if (rect.width > 0 || rect.height > 0) {
						return {
							left: rect.left,
							top: rect.top,
							width: rect.width,
							height: rect.height,
						};
					}
				} catch {
					// Ignore range errors, fall back
				}
			}
		}

		if (fallbackRect.height > 0 || fallbackRect.width > 0) {
			return {
				left: fallbackRect.left,
				top: fallbackRect.top,
				width: fallbackRect.width,
				height: fallbackRect.height,
			};
		}

		return null;
	}

	#rangeFromPoint(x: number, y: number): Range | null {
		const clampedX = Math.max(0, Math.min(window.innerWidth - 1, x));
		const clampedY = Math.max(0, Math.min(window.innerHeight - 1, y));
		const withCaretRange = document as Document & {
			caretRangeFromPoint?: (x: number, y: number) => Range | null;
		};
		const range = withCaretRange.caretRangeFromPoint?.(clampedX, clampedY);
		if (range) return range;

		const withCaretPosition = document as Document & {
			caretPositionFromPoint?: (
				x: number,
				y: number,
			) => { offsetNode: Node; offset: number } | null;
		};
		const position = withCaretPosition.caretPositionFromPoint?.(clampedX, clampedY);
		if (!position) return null;

		const nextRange = document.createRange();
		nextRange.setStart(position.offsetNode, position.offset);
		nextRange.collapse(true);
		return nextRange;
	}

	#getCaretElement(): HTMLDivElement {
		if (!this.#caret) {
			const caret = document.createElement('div');
			caret.className = 'hint-caret';
			caret.setAttribute('aria-hidden', 'true');
			const host = document.body ?? document.documentElement;
			host.appendChild(caret);
			this.#caret = caret;
		}
		return this.#caret;
	}

	#hideCaret(): void {
		if (!this.#caret) return;
		this.#caret.style.display = 'none';
	}

	#isEditableActive(): boolean {
		const active = document.activeElement as HTMLElement | null;
		if (!active || active === document.body) return false;
		return isEditable(active);
	}

	async #copyText(text: string): Promise<void> {
		if (navigator.clipboard?.writeText) {
			try {
				await navigator.clipboard.writeText(text);
				return;
			} catch {
				// Fall back to execCommand copy
			}
		}

		try {
			document.execCommand('copy');
		} catch {
			// Ignore copy failures
		}
	}
}

// Initialize
function getActiveBindings(useNativeFind: boolean): readonly Keymap[] {
	return appConfig.keymaps.filter((binding) => {
		if (useNativeFind && (binding.rhs === 'find:next' || binding.rhs === 'find:prev')) {
			return false;
		}
		return true;
	});
}

setupNoAutofocus();
const linkHints = new LinkHints();
const incrementalSelection = new IncrementalSelection();
const useNativeFind = appConfig.options.findmode === 'native';
const searchController = useNativeFind ? new NativeFindController() : new CustomFindController();
const activeBindings = getActiveBindings(useNativeFind);
const helpOverlay = new HelpOverlay(activeBindings);
new KeyBindings(linkHints, incrementalSelection, searchController, helpOverlay, activeBindings);
