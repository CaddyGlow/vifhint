import { type HintConfig, defaultHintConfig } from './config';
import { isEditable } from './content-dom';
import type { HintMode } from './types';

interface ElementData {
	readonly element: HTMLElement;
	readonly rect: DOMRect;
	readonly style: CSSStyleDeclaration;
}

type HintKind = 'button' | 'input' | 'frame' | 'text';

interface HintElement {
	readonly element: HTMLElement;
	readonly hint: string;
	readonly hintUpper: string;
	readonly kind: HintKind;
	readonly rect: DOMRect;
	readonly isTextMatch: boolean;
	shortcut: string | null;
	shortcutKey: string | null;
	readonly label: HTMLElement;
	readonly matchedSpan: HTMLSpanElement;
	readonly remainingSpan: HTMLSpanElement;
	readonly searchTokens: readonly string[];
	readonly isEditable: boolean;
}

interface SearchCandidate {
	readonly element: HTMLElement;
	readonly rect: DOMRect;
	readonly searchTokens: readonly string[];
	readonly isEditable: boolean;
	readonly kind: HintKind;
}

interface SearchMatch extends SearchCandidate {
	readonly isTextMatch: boolean;
}

type LinkHintsOptions = {
	readonly config?: HintConfig;
	readonly onActivate?: (mode: HintMode) => void;
	readonly onDeactivate?: () => void;
	readonly isEnabled?: () => boolean;
};

const CLICKABLE_TAGS = new Set(['A', 'BUTTON', 'SELECT', 'INPUT', 'TEXTAREA', 'SUMMARY']);

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

const SHORTCUT_ALPHABET = 'asdfjklghvnbcmrutyeiwoqpxz';
const SHORTCUT_ALPHABET_SET = new Set(SHORTCUT_ALPHABET.split(''));
const MAX_SEARCH_RESULTS = 200;
const MAX_TEXT_MATCHES = 200;

const MNEMONIC_SHORTCUTS: Array<{ key: string; type?: HintKind; words?: string[] }> = [
	{ key: 'i', type: 'input' },
	{ key: 'f', type: 'frame' },
	{
		key: 's',
		words: ['search', 'save', 'start', 'stop', 'share', 'select', 'submit', 'settings'],
	},
	{
		key: 'c',
		words: [
			'close',
			'cancel',
			'confirm',
			'continue',
			'connect',
			'check',
			'capture',
			'collapse',
			'clear',
			'create',
			'copy',
		],
	},
	{
		key: 'n',
		words: [
			'next',
			'new',
			'news',
			'navigate',
			'name',
			'note',
			'notes',
			'notify',
			'notification',
			'notifications',
		],
	},
	{
		key: 'p',
		words: ['password', 'prev', 'previous', 'play', 'post', 'pause', 'print', 'pin', 'publish'],
	},
	{ key: 'e', words: ['edit', 'expand', 'enable', 'export', 'execute', 'expose', 'explain'] },
	{
		key: 'd',
		words: [
			'dislike',
			'delete',
			'disable',
			'discard',
			'dismiss',
			'download',
			'drop',
			'destroy',
			'detach',
			'demote',
			'deactivate',
		],
	},
	{
		key: 'a',
		words: [
			'add',
			'accept',
			'apply',
			'agree',
			'approve',
			'attach',
			'assign',
			'activate',
			'allow',
			'authorize',
			'analyze',
			'archive',
			'acknowledge',
			'account',
			'abort',
		],
	},
	{
		key: 'r',
		words: [
			'remove',
			'reject',
			'reset',
			'replace',
			'revert',
			'revoke',
			'refresh',
			'report',
			'reply',
			'review',
			'restore',
			'rerun',
			'regenerate',
			'reorganize',
			'rename',
		],
	},
	{
		key: 'm',
		words: [
			'menu',
			'manage',
			'message',
			'messages',
			'more',
			'modify',
			'move',
			'merge',
			'mark',
			'monitor',
			'mute',
			'mail',
			'map',
			'maximize',
			'minimize',
			'migrate',
		],
	},
	{
		key: 'b',
		words: ['back', 'browse', 'build', 'batch', 'buy', 'bookmark', 'bookmarks', 'book', 'books'],
	},
	{
		key: 'f',
		words: [
			'find',
			'filter',
			'flag',
			'favorite',
			'forward',
			'follow',
			'following',
			'fork',
			'fix',
			'finance',
		],
	},
	{ key: 'g', words: ['go', 'generate', 'get', 'grab', 'group', 'guide'] },
	{ key: 'h', words: ['help', 'hide', 'hold', 'home', 'halt'] },
	{ key: 'i', words: ['info', 'inspect', 'invite', 'insert', 'import', 'ignore', 'init'] },
	{
		key: 'l',
		words: ['like', 'login', 'logout', 'leave', 'list', 'lists', 'load', 'lock'],
	},
	{ key: 'o', words: ['open', 'order', 'options', 'okay', 'override', 'organize', 'opt-in'] },
	{ key: 'q', words: ['quit', 'queue', 'question'] },
	{
		key: 't',
		words: ['toggle', 'translate', 'transfer', 'track', 'throw', 'theme', 'test', 'truncate'],
	},
	{
		key: 'u',
		words: ['update', 'upgrade', 'upload', 'undo', 'unhide', 'unblock', 'uninstall', 'unlike'],
	},
	{
		key: 'v',
		words: ['view', 'verify', 'verified', 'validate', 'visualize', 'vote'],
	},
	{ key: 'z', words: ['zoom', 'zero'] },
	{ key: 'x', words: ['exit', 'expand', 'explore', 'extract'] },
];

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

function isClickable(
	el: HTMLElement,
	hoverElements: Set<Element>,
): 'tag' | 'handler' | 'cursor' | 'hover' | null {
	if (CLICKABLE_TAGS.has(el.tagName)) {
		if (el.tagName === 'A' && !(el as HTMLAnchorElement).href && !el.onclick) return null;
		return 'tag';
	}

	const role = el.getAttribute('role');
	if (role && CLICKABLE_ROLES.has(role)) return 'tag';

	if (el.onclick || el.getAttribute('onclick')) return 'handler';

	if (el.contentEditable === 'true') return 'tag';

	if (hoverElements.has(el)) return 'hover';

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

function resolveHintKind(element: HTMLElement, isTextMatch = false): HintKind {
	if (isTextMatch) return 'text';
	if (element.tagName === 'IFRAME') return 'frame';
	if (isEditable(element)) return 'input';
	return 'button';
}

function getElementData(
	el: HTMLElement,
	viewportWidth: number,
	viewportHeight: number,
): ElementData | null {
	if (!el.offsetWidth || !el.offsetHeight) return null;

	const rect = el.getBoundingClientRect();

	if (
		rect.bottom <= 0 ||
		rect.top >= viewportHeight ||
		rect.right <= 0 ||
		rect.left >= viewportWidth
	)
		return null;

	const minSize = isEditable(el) ? 1 : 4;
	if (rect.width <= minSize || rect.height <= minSize) return null;

	const style = getComputedStyle(el);

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

function shouldDedupeInline(lastData: ElementData, newData: ElementData): boolean {
	if (hasSimilarBounds(lastData.rect, newData.rect)) return true;

	const lastHref = getElementHref(lastData.element);
	const newHref = getElementHref(newData.element);
	if (!lastHref || !newHref || lastHref === newHref) return true;

	return false;
}

function normalizeSearchToken(token: string | null | undefined): string | null {
	if (!token) return null;
	const trimmed = token.trim();
	return trimmed ? trimmed.toLowerCase() : null;
}

function normalizeMnemonicToken(token: string | null | undefined): string | null {
	if (!token) return null;
	const trimmed = token.trim();
	if (!trimmed) return null;
	return trimmed.split(/[\s\n\t]+/)[0]?.toLowerCase() ?? null;
}

function collectSearchTokens(element: HTMLElement): string[] {
	const tokens: string[] = [];
	const push = (value: string | null | undefined): void => {
		const normalized = normalizeSearchToken(value);
		if (normalized) tokens.push(normalized);
	};

	const isInput =
		element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable;

	if (isInput) {
		const input = element as HTMLInputElement | HTMLTextAreaElement;
		push('placeholder' in input ? input.placeholder : null);
		push(element.getAttribute('aria-label'));
		push(element.getAttribute('title'));
		if (element.isContentEditable) {
			push(element.innerText);
		} else {
			push(input.value);
		}
	} else {
		push(element.innerText);
		push(element.getAttribute('aria-label'));
		push(element.getAttribute('title'));
	}

	return tokens;
}

function collectMnemonicTokens(element: HTMLElement, kind: HintKind): Set<string> {
	const tokens: string[] = [];
	const push = (value: string | null | undefined): void => {
		const normalized = normalizeMnemonicToken(value);
		if (normalized) tokens.push(normalized);
	};

	if (kind === 'input') {
		const input = element as HTMLInputElement;
		push(input.type);
		push(input.placeholder);
		push(input.id);
		push(input.name);
		push(input.className);
		push(input.title);
		push(input.getAttribute('aria-label'));
	} else {
		push(element.id);
		push((element as HTMLInputElement).name);
		push(element.className);
		push(element.title);
		push(element.innerText);
		push(element.getAttribute('aria-label'));
	}

	return new Set(tokens.filter(Boolean));
}

function isAccessible(element: HTMLElement, rect: DOMRect): boolean {
	const centerX = rect.left + rect.width / 2;
	const centerY = rect.top + rect.height / 2;

	const testPoints = [
		{ x: rect.right - 8, y: rect.top + 8 },
		{ x: rect.left + 8, y: rect.top + 8 },
		{ x: centerX, y: centerY },
		{ x: centerX, y: rect.bottom - 8 },
	];

	return testPoints.some(({ x, y }) => {
		const topEl = document.elementFromPoint(x, y);
		if (!topEl) return false;
		if (topEl === element || element.contains(topEl)) return true;
		const root = element.getRootNode();
		if (root instanceof ShadowRoot && root.host === topEl) return true;
		return false;
	});
}

function filterOverlaps(elements: ElementData[]): ElementData[] {
	if (elements.length <= 1) return elements;
	return elements.filter(({ element, rect }) => {
		return isAccessible(element, rect);
	});
}

function collectClickableElements(): ElementData[] {
	const root = document.body ?? document.documentElement;
	if (!root) return [];

	const results: ElementData[] = [];
	const viewportWidth = window.innerWidth;
	const viewportHeight = window.innerHeight;
	const hoverElements = findHoverElements();
	const shadowRoots: ShadowRoot[] = [];

	const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
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

		if (el.shadowRoot) shadowRoots.push(el.shadowRoot);

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

		node = nextNode;
	}

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

	return filterOverlaps(results);
}

function collectSearchCandidates(): SearchCandidate[] {
	const candidates: SearchCandidate[] = [];
	const elements = sortElementsForHints(collectClickableElements());

	for (const data of elements) {
		candidates.push({
			element: data.element,
			rect: data.rect,
			searchTokens: collectSearchTokens(data.element),
			isEditable: isEditable(data.element),
			kind: resolveHintKind(data.element),
		});
	}

	const viewportWidth = window.innerWidth;
	const viewportHeight = window.innerHeight;
	for (const frame of document.querySelectorAll('iframe')) {
		const el = frame as HTMLElement;
		if (candidates.some((candidate) => candidate.element === el)) continue;
		const data = getElementData(el, viewportWidth, viewportHeight);
		if (!data) continue;
		candidates.push({
			element: el,
			rect: data.rect,
			searchTokens: collectSearchTokens(el),
			isEditable: false,
			kind: 'frame',
		});
	}

	return candidates;
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

export class LinkHints {
	#hints: HintElement[] = [];
	#active = false;
	#currentInput = '';
	#lastInput = '';
	#inputDisplay: HTMLElement | null = null;
	#mode: HintMode = 'normal';
	#resizeTimeoutId: number | null = null;
	#activeHintIndices: number[] = [];
	#hintMap = new Map<string, number>();
	#hintLength = 0;
	#searchCandidates: SearchCandidate[] = [];
	#shortcutMap = new Map<string, number>();
	#shortcutSequence = '';
	#shortcutModeActive = false;
	#topHintIndex: number | null = null;
	#textMatchMarks: HTMLElement[] = [];
	#previousShortcutMap = new WeakMap<HTMLElement, string>();
	#onActivate?: (mode: HintMode) => void;
	#onDeactivate?: () => void;
	#isEnabled: () => boolean;
	#config: HintConfig;
	#onKeyDown?: (event: KeyboardEvent) => void;
	#onKeyUp?: (event: KeyboardEvent) => void;
	#onRuntimeMessage?: (message: unknown) => void;

	constructor(options: LinkHintsOptions = {}) {
		this.#onActivate = options.onActivate;
		this.#onDeactivate = options.onDeactivate;
		this.#isEnabled = options.isEnabled ?? (() => true);
		this.#config = options.config ?? defaultHintConfig;
		this.#setupKeyListener();
		this.#setupCommandListener();
	}

	isActive(): boolean {
		return this.#active;
	}

	deactivate(): void {
		if (this.#active) {
			this.#deactivate();
		}
	}

	activate(mode: HintMode = 'normal'): void {
		if (!this.#isEnabled()) return;
		if (!this.#active) {
			this.#mode = mode;
			this.#activate();
		}
	}

	dispose(): void {
		this.deactivate();
		this.#detachResizeListener();
		if (this.#onKeyDown) {
			document.removeEventListener('keydown', this.#onKeyDown, true);
			this.#onKeyDown = undefined;
		}
		if (this.#onKeyUp) {
			document.removeEventListener('keyup', this.#onKeyUp, true);
			this.#onKeyUp = undefined;
		}
		if (this.#onRuntimeMessage) {
			chrome.runtime.onMessage.removeListener(this.#onRuntimeMessage);
			this.#onRuntimeMessage = undefined;
		}
	}

	#setupCommandListener(): void {
		this.#onRuntimeMessage = (message) => {
			const payload = message as { command?: string } | null;
			if (payload?.command === 'activate-hints') {
				if (!this.#isEnabled()) return;
				this.#toggle();
			}
		};
		chrome.runtime.onMessage.addListener(this.#onRuntimeMessage);
	}

	#setupKeyListener(): void {
		this.#onKeyDown = (e) => {
			if (!this.#active) return;
			if (!this.#isEnabled()) {
				this.#deactivate();
				return;
			}

			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();

			if (e.key === 'Escape') {
				this.#deactivate();
				return;
			}

			if (this.#mode === 'search') {
				if (e.key === 'Shift') {
					this.#shortcutModeActive = true;
					return;
				}

				if (e.key === 'Backspace') {
					this.#handleSearchBackspace();
					return;
				}

				const key = this.#getEventKey(e);
				if (this.#handleSearchNavigation(key, e)) return;
				this.#handleSearchKey(key, e);
				return;
			}

			if (e.key === 'Backspace') {
				this.#currentInput = this.#currentInput.slice(0, -1);
				this.#updateInputDisplay();
				this.#filterHints();
				return;
			}

			const key = this.#getEventKey(e);
			const lowered = key.toLowerCase();
			if (this.#config.hintChars.includes(lowered)) {
				this.#currentInput += lowered;
				this.#updateInputDisplay();
				this.#filterHints();

				if (this.#hintLength > 0 && this.#currentInput.length === this.#hintLength) {
					const matchIndex = this.#hintMap.get(this.#currentInput);
					if (matchIndex !== undefined) {
						this.#clickElement(this.#hints[matchIndex].element);
						this.#deactivate();
						return;
					}
				}

				if (this.#activeHintIndices.length === 0) {
					this.#currentInput = this.#currentInput.slice(0, -1);
					this.#updateInputDisplay();
					this.#filterHints();
				}
			}
		};
		document.addEventListener('keydown', this.#onKeyDown, true);

		this.#onKeyUp = (e) => {
			if (!this.#active) return;
			if (this.#mode !== 'search') return;
			if (e.key === 'Shift') {
				this.#shortcutModeActive = false;
				if (this.#shortcutSequence) {
					this.#shortcutSequence = '';
					this.#applyShortcutFilter('');
				}
			}
		};
		document.addEventListener('keyup', this.#onKeyUp, true);
	}

	#getEventKey(event: KeyboardEvent): string {
		if (
			event.shiftKey &&
			(event.code.startsWith('Digit') ||
				event.code.startsWith('Numpad') ||
				event.code.startsWith('Key'))
		) {
			return event.code.slice(-1);
		}
		return event.key;
	}

	#handleSearchKey(key: string, event: KeyboardEvent): void {
		if (key.length !== 1) return;

		const lowered = key.toLowerCase();
		const isDigit = /^\d$/.test(lowered);
		if (isDigit && this.#currentInput.length > 0) {
			const matchIndex = this.#shortcutMap.get(lowered);
			if (matchIndex !== undefined) {
				this.#activateHint(matchIndex);
			}
			return;
		}

		if (this.#shortcutModeActive || event.shiftKey) {
			this.#handleShortcutInput(lowered);
			return;
		}

		const previousInput = this.#currentInput;
		this.#currentInput += lowered;
		this.#shortcutSequence = '';
		this.#updateInputDisplay();
		this.#updateSearchResults();

		if (this.#activeHintIndices.length === 0) {
			this.#currentInput = previousInput;
			this.#updateInputDisplay();
			this.#updateSearchResults();
		}
	}

	#toggle(): void {
		if (!this.#isEnabled()) return;
		if (this.#active) {
			this.#deactivate();
		} else {
			this.#activate();
		}
	}

	#activate(): void {
		this.#active = true;
		this.#onActivate?.(this.#mode);
		this.#currentInput = '';
		this.#lastInput = '';
		this.#activeHintIndices = [];
		this.#hintMap.clear();
		this.#hintLength = 0;
		this.#searchCandidates = [];
		this.#shortcutMap.clear();
		this.#shortcutSequence = '';
		this.#shortcutModeActive = false;
		this.#topHintIndex = null;
		this.#clearTextMatches();

		this.#createInputDisplay();
		this.#updateInputDisplay();
		this.#attachResizeListener();

		const timings: Record<string, number> = {};
		const mark = (label: string): void => {
			if (this.#config.debugTimings) timings[label] = performance.now();
		};
		const fmt = (value: number): string => value.toFixed(1);

		mark('start');

		const isSearchMode = this.#mode === 'search';
		if (isSearchMode) {
			this.#hints = [];
			mark('collected');
			this.#updateSearchResults();
			mark('shown');
		} else {
			const elements = sortElementsForHints(collectClickableElements());
			mark('collected');

			const hintStrings = this.#generateHints(elements.length);
			mark('generated');

			this.#hints = elements.map((data, i) => {
				const hint = hintStrings[i] ?? '';
				const { label, matchedSpan, remainingSpan } = this.#createLabel(hint);
				return {
					element: data.element,
					hint,
					hintUpper: hint.toUpperCase(),
					label,
					matchedSpan,
					remainingSpan,
					searchTokens: [],
					isEditable: isEditable(data.element),
					kind: resolveHintKind(data.element),
					rect: data.rect,
					isTextMatch: false,
					shortcut: null,
					shortcutKey: null,
				};
			});
			this.#hintMap.clear();
			for (let i = 0; i < hintStrings.length; i += 1) {
				this.#hintMap.set(hintStrings[i], i);
			}
			this.#hintLength = hintStrings[0]?.length ?? 0;
			mark('created');

			if (this.#config.showElementBorder) {
				for (const hint of this.#hints) {
					if (hint.isEditable) {
						hint.element.classList.add('link-hint-target-input');
					} else {
						hint.element.classList.add('link-hint-target');
					}
				}
			}
			mark('bordered');

			this.#showHints();
			mark('shown');
		}

		if (this.#config.debugTimings) {
			if (isSearchMode) {
				const collectMs = timings.collected - timings.start;
				const showMs = timings.shown - timings.collected;
				const totalMs = timings.shown - timings.start;

				// eslint-disable-next-line no-console
				console.debug(
					`[link-hints] search-candidates=${this.#searchCandidates.length} ` +
						`collect=${fmt(collectMs)}ms show=${fmt(showMs)}ms total=${fmt(totalMs)}ms`,
				);
			} else {
				const collectMs = timings.collected - timings.start;
				const generateMs = timings.generated - timings.collected;
				const createMs = timings.created - timings.generated;
				const borderMs = timings.bordered - timings.created;
				const showMs = timings.shown - timings.bordered;
				const totalMs = timings.shown - timings.start;

				// eslint-disable-next-line no-console
				console.debug(
					`[link-hints] elements=${this.#hints.length} ` +
						`collect=${fmt(collectMs)}ms generate=${fmt(generateMs)}ms ` +
						`create=${fmt(createMs)}ms border=${fmt(borderMs)}ms ` +
						`show=${fmt(showMs)}ms total=${fmt(totalMs)}ms`,
				);
			}
		}
	}

	#createInputDisplay(): void {
		this.#inputDisplay = document.createElement('div');
		this.#inputDisplay.className = 'link-hint-input';
		this.#inputDisplay.dataset.hintUi = 'true';
		document.body.appendChild(this.#inputDisplay);
	}

	#updateInputDisplay(): void {
		if (this.#inputDisplay) {
			if (this.#mode === 'search' && this.#currentInput.length === 0) {
				this.#inputDisplay.textContent = 'HINT MODE';
				this.#inputDisplay.classList.add('is-placeholder');
				this.#inputDisplay.style.display = 'block';
				return;
			}

			this.#inputDisplay.classList.remove('is-placeholder');
			this.#inputDisplay.textContent = this.#currentInput.toUpperCase();
			this.#inputDisplay.style.display = this.#currentInput ? 'block' : 'none';
		}
	}

	#deactivate(): void {
		this.#active = false;
		this.#onDeactivate?.();
		this.#currentInput = '';
		this.#lastInput = '';
		this.#activeHintIndices = [];
		this.#hintMap.clear();
		this.#hintLength = 0;
		this.#searchCandidates = [];
		this.#shortcutMap.clear();
		this.#shortcutSequence = '';
		this.#shortcutModeActive = false;
		this.#topHintIndex = null;
		this.#clearTextMatches();
		this.#detachResizeListener();
		this.#clearHintOverlays();
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
		const chars = this.#config.hintChars.toUpperCase();
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

	#createLabel(text: string): {
		label: HTMLElement;
		matchedSpan: HTMLSpanElement;
		remainingSpan: HTMLSpanElement;
	} {
		const label = document.createElement('div');
		label.className = 'link-hint-label';
		label.dataset.hintUi = 'true';
		const matchedSpan = document.createElement('span');
		matchedSpan.className = 'matched';
		const remainingSpan = document.createElement('span');
		remainingSpan.textContent = text.toUpperCase();
		label.appendChild(matchedSpan);
		label.appendChild(remainingSpan);
		return { label, matchedSpan, remainingSpan };
	}

	#showHints(): void {
		const positions: Array<{ top: number; left: number }> = [];
		const fragment = document.createDocumentFragment();
		const scrollX = window.scrollX;
		const scrollY = window.scrollY;
		const minLeft = scrollX + 2;
		const maxLeft = scrollX + window.innerWidth - 30;
		const minTop = scrollY + 2;
		const offsetX = this.#config.hintOffset.x;
		const offsetY = this.#config.hintOffset.y;

		for (const hint of this.#hints) {
			if (hint.label.style.display === 'none') {
				fragment.appendChild(hint.label);
				continue;
			}

			const rect = this.#getHintRect(hint);

			let left =
				this.#config.hintAlign === 'right'
					? rect.right + scrollX + offsetX
					: this.#config.hintAlign === 'center'
						? rect.left + rect.width / 2 + scrollX + offsetX
						: rect.left + scrollX + offsetX;

			let top = rect.top + scrollY + offsetY;

			left = Math.max(minLeft, Math.min(maxLeft, left));
			top = Math.max(minTop, top);

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
		}

		document.body.appendChild(fragment);
	}

	#filterHints(): void {
		if (this.#mode === 'search') {
			this.#updateSearchResults();
			return;
		}

		const input = this.#currentInput;
		const inputUpper = input.toUpperCase();
		const inputLength = input.length;
		const isIncremental = this.#lastInput !== '' && input.startsWith(this.#lastInput);
		const nextActive: number[] = [];

		if (isIncremental) {
			for (const index of this.#activeHintIndices) {
				const hint = this.#hints[index];
				if (hint.hint.startsWith(input)) {
					hint.label.style.display = 'block';
					hint.matchedSpan.textContent = inputUpper;
					hint.remainingSpan.textContent = hint.hintUpper.slice(inputLength);
					nextActive.push(index);
				} else {
					hint.label.style.display = 'none';
				}
			}
		} else {
			for (let i = 0; i < this.#hints.length; i += 1) {
				const hint = this.#hints[i];
				if (hint.hint.startsWith(input)) {
					hint.label.style.display = 'block';
					hint.matchedSpan.textContent = inputUpper;
					hint.remainingSpan.textContent = hint.hintUpper.slice(inputLength);
					nextActive.push(i);
				} else {
					hint.label.style.display = 'none';
				}
			}
		}

		this.#activeHintIndices = nextActive;
		this.#lastInput = input;
	}

	#handleSearchBackspace(): void {
		if (this.#shortcutSequence) {
			this.#shortcutSequence = '';
			this.#applyShortcutFilter('');
			return;
		}

		if (!this.#currentInput) return;
		this.#currentInput = this.#currentInput.slice(0, -1);
		this.#updateInputDisplay();
		this.#updateSearchResults();
	}

	#handleSearchNavigation(key: string, event: KeyboardEvent): boolean {
		if (key === 'Enter' && this.#topHintIndex !== null) {
			this.#activateHint(this.#topHintIndex);
			return true;
		}

		if (key === 'Tab' && this.#activeHintIndices.length > 1) {
			this.#rotateTopHint(event.shiftKey);
			return true;
		}

		if (key.startsWith('Arrow')) {
			return this.#navigateSearch(key);
		}

		return false;
	}

	#handleShortcutInput(key: string): void {
		const nextSequence = `${this.#shortcutSequence}${key}`.toLowerCase();
		const matches = this.#getShortcutMatches(nextSequence);

		if (matches.length === 0) {
			return;
		}

		if (matches.length === 1) {
			this.#activateHint(matches[0]);
			return;
		}

		this.#shortcutSequence = nextSequence;
		this.#applyShortcutFilter(nextSequence);
	}

	#getShortcutMatches(prefix: string): number[] {
		if (!prefix) {
			return this.#hints.map((_, index) => index);
		}

		const matches: number[] = [];
		for (let i = 0; i < this.#hints.length; i += 1) {
			const hint = this.#hints[i];
			if (hint.shortcutKey?.startsWith(prefix)) {
				matches.push(i);
			}
		}

		return matches;
	}

	#applyShortcutFilter(prefix: string): void {
		const matchingIndices = prefix ? new Set(this.#getShortcutMatches(prefix)) : null;
		const nextActive: number[] = [];

		for (let i = 0; i < this.#hints.length; i += 1) {
			const hint = this.#hints[i];
			const isActive = matchingIndices ? matchingIndices.has(i) : true;
			const showLabel = isActive && Boolean(hint.shortcutKey);
			hint.label.style.display = showLabel ? 'block' : 'none';

			if (this.#config.showElementBorder && !hint.isTextMatch) {
				if (isActive) {
					if (hint.isEditable) {
						hint.element.classList.add('link-hint-target-input');
						hint.element.classList.remove('link-hint-target');
					} else {
						hint.element.classList.add('link-hint-target');
						hint.element.classList.remove('link-hint-target-input');
					}
				} else {
					hint.element.classList.remove('link-hint-target');
					hint.element.classList.remove('link-hint-target-input');
				}
			}

			if (isActive) nextActive.push(i);
		}

		this.#activeHintIndices = nextActive;
		this.#setTopHint(this.#findTopHintIndex(nextActive));
		this.#showHints();
	}

	#updateSearchResults(): void {
		const input = this.#currentInput.toLowerCase();
		this.#lastInput = input;

		this.#shortcutMap.clear();
		this.#shortcutSequence = '';
		this.#clearHintOverlays();
		this.#clearTextMatches();

		if (!input) {
			this.#searchCandidates = [];
			this.#activeHintIndices = [];
			return;
		}

		this.#searchCandidates = collectSearchCandidates();

		const textMatches = this.#collectTextMatches(input);
		const remainingSlots = Math.max(0, MAX_SEARCH_RESULTS - textMatches.length);
		const elementMatches = this.#collectElementMatches(input, remainingSlots);
		const matches = [...textMatches, ...elementMatches];

		this.#hints = matches.map((match) => {
			const { label, matchedSpan, remainingSpan } = this.#createLabel('');
			return {
				element: match.element,
				hint: '',
				hintUpper: '',
				label,
				matchedSpan,
				remainingSpan,
				searchTokens: match.searchTokens,
				isEditable: match.isEditable,
				kind: match.kind,
				rect: match.rect,
				isTextMatch: match.isTextMatch,
				shortcut: null,
				shortcutKey: null,
			};
		});

		this.#assignSearchShortcuts();
		this.#renderSearchLabels();

		this.#activeHintIndices = this.#hints.map((_, index) => index);
		this.#setTopHint(this.#findTopHintIndex(this.#activeHintIndices));
		this.#showHints();
	}

	#collectElementMatches(query: string, limit: number): SearchMatch[] {
		const matches: SearchMatch[] = [];
		if (limit <= 0) return matches;

		for (const candidate of this.#searchCandidates) {
			if (matches.length >= limit) break;
			if (!this.#matchesSearchCandidate(candidate, query)) continue;
			matches.push({ ...candidate, isTextMatch: false });
		}

		return matches;
	}

	#matchesSearchCandidate(candidate: SearchCandidate, query: string): boolean {
		if (!candidate.element.isConnected) return false;
		if (candidate.searchTokens.some((token) => token.includes(query))) return true;
		if (candidate.kind !== 'frame') return false;

		try {
			const frame = candidate.element as HTMLIFrameElement;
			const bodyText = frame.contentDocument?.body?.textContent ?? '';
			return bodyText.toLowerCase().includes(query);
		} catch {
			return false;
		}
	}

	#collectTextMatches(query: string): SearchMatch[] {
		const matches: SearchMatch[] = [];
		const root = document.body ?? document.documentElement;
		if (!root) return matches;

		const queryLower = query.toLowerCase();
		const nodeMatches = new Map<Text, Array<{ start: number; end: number }>>();
		let matchCount = 0;

		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
			acceptNode: (node: Node) => {
				if (matchCount >= MAX_TEXT_MATCHES) return NodeFilter.FILTER_REJECT;
				if (node.nodeType !== Node.TEXT_NODE) return NodeFilter.FILTER_REJECT;

				const textNode = node as Text;
				const parent = textNode.parentElement;
				if (!parent) return NodeFilter.FILTER_REJECT;

				if (
					parent.closest?.(
						'[data-hint-ui], .hint-find-bar, .hint-help-overlay, .hint-whichkey, ' +
							'.visual-mode-indicator, .hint-caret, .hint-find-highlight, ' +
							'.hint-find-highlight-current',
					)
				) {
					return NodeFilter.FILTER_REJECT;
				}

				if (parent.classList.contains('link-hint-text-match')) {
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

				if (!textNode.textContent?.trim()) {
					return NodeFilter.FILTER_REJECT;
				}

				const textLower = textNode.textContent.toLowerCase();
				if (!textLower.includes(queryLower)) {
					return NodeFilter.FILTER_REJECT;
				}

				const rect = parent.getBoundingClientRect();
				if (!this.#isRectInViewport(rect)) {
					return NodeFilter.FILTER_REJECT;
				}

				return NodeFilter.FILTER_ACCEPT;
			},
		});

		let node: Node | null = walker.nextNode();
		while (node && matchCount < MAX_TEXT_MATCHES) {
			const textNode = node as Text;
			const text = textNode.textContent ?? '';
			const textLower = text.toLowerCase();
			let index = textLower.indexOf(queryLower);

			while (index !== -1 && matchCount < MAX_TEXT_MATCHES) {
				const group = nodeMatches.get(textNode) ?? [];
				group.push({ start: index, end: index + queryLower.length });
				nodeMatches.set(textNode, group);
				matchCount += 1;
				index = textLower.indexOf(queryLower, index + queryLower.length);
			}

			node = walker.nextNode();
		}

		for (const [textNode, ranges] of nodeMatches) {
			ranges.sort((a, b) => b.start - a.start);
			for (const rangeInfo of ranges) {
				try {
					const range = document.createRange();
					range.setStart(textNode, rangeInfo.start);
					range.setEnd(textNode, rangeInfo.end);
					const rect = range.getBoundingClientRect();
					if (!this.#isRectInViewport(rect) || rect.width <= 0 || rect.height <= 0) {
						continue;
					}

					const mark = document.createElement('mark');
					mark.className = 'link-hint-text-match';
					mark.dataset.hintUi = 'true';
					range.surroundContents(mark);

					this.#textMatchMarks.push(mark);
					matches.push({
						element: mark,
						rect: mark.getBoundingClientRect(),
						searchTokens: [],
						isEditable: false,
						kind: 'text',
						isTextMatch: true,
					});
				} catch {}
			}
		}

		return matches;
	}

	#clearTextMatches(): void {
		for (const mark of this.#textMatchMarks) {
			if (!mark.isConnected) continue;
			const text = document.createTextNode(mark.textContent ?? '');
			const prev = mark.previousSibling;
			const next = mark.nextSibling;
			mark.replaceWith(text);

			if (prev?.nodeType === Node.TEXT_NODE && next?.nodeType === Node.TEXT_NODE) {
				(prev as Text).textContent = `${prev.textContent ?? ''}${text.textContent ?? ''}${
					next.textContent ?? ''
				}`;
				(next as Text).remove();
				text.remove();
			} else if (prev?.nodeType === Node.TEXT_NODE) {
				(prev as Text).textContent = `${prev.textContent ?? ''}${text.textContent ?? ''}`;
				text.remove();
			} else if (next?.nodeType === Node.TEXT_NODE) {
				(next as Text).textContent = `${text.textContent ?? ''}${next.textContent ?? ''}`;
				text.remove();
			}
		}

		this.#textMatchMarks = [];
	}

	#clearHintOverlays(): void {
		for (const hint of this.#hints) {
			hint.label.remove();
			hint.label.classList.remove('is-top');
			hint.element.classList.remove('link-hint-target');
			hint.element.classList.remove('link-hint-target-input');
			hint.element.classList.remove('link-hint-target-top');
			if (hint.isTextMatch) {
				hint.element.classList.remove('link-hint-text-top');
			}
		}
		this.#hints = [];
		this.#activeHintIndices = [];
		this.#topHintIndex = null;
	}

	#assignSearchShortcuts(): void {
		const used = new Set<string>();
		const usedPrefixes = new Set<string>();
		const assignable = this.#hints
			.map((hint, index) => ({ hint, index }))
			.filter(({ hint }) => hint.kind !== 'text');

		const useShortcut = (value: string): void => {
			used.add(value);
			usedPrefixes.add(value[0]);
		};

		for (const { hint } of assignable) {
			const previous = this.#previousShortcutMap.get(hint.element);
			if (!previous) continue;
			if (used.has(previous) || usedPrefixes.has(previous[0])) continue;
			hint.shortcut = previous;
			useShortcut(previous);
		}

		for (const { hint } of assignable) {
			if (hint.shortcut) continue;
			const tokens = collectMnemonicTokens(hint.element, hint.kind);
			for (const rule of MNEMONIC_SHORTCUTS) {
				if (usedPrefixes.has(rule.key)) continue;
				if (rule.type && rule.type !== hint.kind) continue;
				if (rule.words && !rule.words.some((word) => tokens.has(word))) continue;
				hint.shortcut = rule.key;
				useShortcut(rule.key);
				break;
			}
		}

		for (const { hint } of assignable) {
			if (hint.shortcut) continue;
			const text = hint.element.innerText?.trim();
			if (!text || text.length < 2) continue;
			const shortcut = `${text[0]}${text[1]}`.toLowerCase();
			if (!SHORTCUT_ALPHABET_SET.has(shortcut[0]) || !SHORTCUT_ALPHABET_SET.has(shortcut[1])) {
				continue;
			}
			if (used.has(shortcut) || usedPrefixes.has(shortcut[0])) continue;
			hint.shortcut = shortcut;
			useShortcut(shortcut);
		}

		const availableFirst = SHORTCUT_ALPHABET.split('').filter(
			(letter) => !usedPrefixes.has(letter),
		);
		let index = 0;
		const maxCombos = availableFirst.length * SHORTCUT_ALPHABET.length;

		for (const { hint } of assignable) {
			if (hint.shortcut) continue;
			while (index < maxCombos) {
				const combo = `${availableFirst[Math.floor(index / SHORTCUT_ALPHABET.length)]}${
					SHORTCUT_ALPHABET[index % SHORTCUT_ALPHABET.length]
				}`;
				index += 1;
				if (used.has(combo)) continue;
				hint.shortcut = combo;
				useShortcut(combo);
				break;
			}
		}

		const prefixCounts = new Map<string, number>();
		for (const { hint } of assignable) {
			if (!hint.shortcut) continue;
			const prefix = hint.shortcut[0];
			prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
		}

		for (const { hint } of assignable) {
			if (!hint.shortcut || hint.shortcut.length === 1) continue;
			const prefix = hint.shortcut[0];
			if (prefixCounts.get(prefix) === 1) {
				hint.shortcut = prefix;
			}
		}

		const numberByIndex = new Map<number, string>();
		if (this.#currentInput) {
			const numbered = assignable
				.map(({ hint, index }) => ({ hint, index, rect: this.#getHintRect(hint) }))
				.filter(({ rect }) => this.#isRectInViewport(rect))
				.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);

			for (let i = 0; i < numbered.length && i < 9; i += 1) {
				numberByIndex.set(numbered[i].index, String(i + 1));
			}
		}

		for (const { hint, index } of assignable) {
			if (hint.shortcut) {
				this.#previousShortcutMap.set(hint.element, hint.shortcut);
			}

			const numberLabel = numberByIndex.get(index) ?? null;
			hint.shortcutKey = numberLabel ?? hint.shortcut;

			if (hint.shortcutKey) {
				this.#shortcutMap.set(hint.shortcutKey, index);
			}
		}
	}

	#renderSearchLabels(): void {
		for (const hint of this.#hints) {
			const label = hint.shortcutKey;
			if (label) {
				hint.label.style.display = 'block';
				hint.matchedSpan.textContent = '';
				hint.remainingSpan.textContent = label.toUpperCase();
			} else {
				hint.label.style.display = 'none';
			}

			if (this.#config.showElementBorder && !hint.isTextMatch) {
				if (hint.isEditable) {
					hint.element.classList.add('link-hint-target-input');
					hint.element.classList.remove('link-hint-target');
				} else {
					hint.element.classList.add('link-hint-target');
					hint.element.classList.remove('link-hint-target-input');
				}
			}
		}
	}

	#activateHint(index: number): void {
		const hint = this.#hints[index];
		if (!hint) return;
		this.#clickElement(hint.element);
		this.#deactivate();
	}

	#findTopHintIndex(indices: number[]): number | null {
		if (indices.length === 0) return null;
		let bestIndex = indices[0];
		let bestWeight = this.#weightHint(this.#hints[bestIndex], true);

		for (let i = 1; i < indices.length; i += 1) {
			const index = indices[i];
			const weight = this.#weightHint(this.#hints[index], true);
			if (weight > bestWeight) {
				bestWeight = weight;
				bestIndex = index;
			}
		}

		return bestIndex;
	}

	#weightHint(hint: HintElement, preferTextlessButton = false): number {
		const rect = this.#getHintRect(hint);
		let weight = 1;

		if (this.#isRectInViewport(rect)) {
			weight += 1e10;
		}

		if (hint.kind === 'input') {
			weight += 5e9;
		} else if (hint.kind === 'frame') {
			weight += 2e9;
		} else if (hint.kind === 'button') {
			weight += 1e9;
			if (preferTextlessButton && !hint.element.textContent?.trim()) {
				weight += 1e9;
			}
		}

		const sizeScore = rect.height * Math.sqrt(rect.width);
		const centerX = rect.left + rect.width / 2;
		const centerY = rect.top + rect.height / 2;

		if (centerY < window.innerHeight / 2) {
			weight += centerX < window.innerWidth / 2 ? 4 * sizeScore : 2 * sizeScore;
		} else {
			weight += centerX < window.innerWidth / 2 ? 2 * sizeScore : sizeScore;
		}

		return weight;
	}

	#getHintRect(hint: HintElement): DOMRect {
		try {
			return hint.element.getBoundingClientRect();
		} catch {
			return hint.rect;
		}
	}

	#isRectInViewport(rect: DOMRect): boolean {
		return !(
			rect.bottom <= 0 ||
			rect.top >= window.innerHeight ||
			rect.right <= 0 ||
			rect.left >= window.innerWidth
		);
	}

	#setTopHint(index: number | null): void {
		if (this.#topHintIndex !== null) {
			const previous = this.#hints[this.#topHintIndex];
			if (previous) {
				previous.label.classList.remove('is-top');
				previous.element.classList.remove('link-hint-target-top');
				if (previous.isTextMatch) {
					previous.element.classList.remove('link-hint-text-top');
				}
			}
		}

		this.#topHintIndex = index;
		if (index === null) return;
		const hint = this.#hints[index];
		if (!hint) return;
		hint.label.classList.add('is-top');
		if (hint.isTextMatch) {
			hint.element.classList.add('link-hint-text-top');
		} else {
			hint.element.classList.add('link-hint-target-top');
		}
	}

	#rotateTopHint(reverse: boolean): void {
		if (this.#activeHintIndices.length === 0) return;
		const current = this.#topHintIndex !== null ? this.#topHintIndex : this.#activeHintIndices[0];
		let position = this.#activeHintIndices.indexOf(current);
		if (position === -1) position = 0;

		const offset = reverse ? -1 : 1;
		const next =
			this.#activeHintIndices[
				(position + offset + this.#activeHintIndices.length) % this.#activeHintIndices.length
			];
		this.#setTopHint(next);
		this.#ensureHintInViewport(next);
	}

	#navigateSearch(direction: string): boolean {
		if (this.#topHintIndex === null) return false;
		const current = this.#hints[this.#topHintIndex];
		if (!current) return false;

		const currentRect = this.#getHintRect(current);
		let candidates = this.#activeHintIndices.filter((index) => index !== this.#topHintIndex);
		if (candidates.length === 0) return false;

		candidates = candidates.filter((index) => {
			const rect = this.#getHintRect(this.#hints[index]);
			if (direction === 'ArrowDown') return currentRect.bottom < rect.bottom;
			if (direction === 'ArrowUp') return currentRect.top > rect.top;
			if (direction === 'ArrowLeft') return currentRect.left > rect.left;
			if (direction === 'ArrowRight') return currentRect.right < rect.right;
			return false;
		});

		if (candidates.length === 0) return false;

		const aligned = candidates.filter((index) => {
			const rect = this.#getHintRect(this.#hints[index]);
			if (direction === 'ArrowDown' || direction === 'ArrowUp') {
				return (
					Math.abs(rect.left - currentRect.left) <= 5 ||
					Math.abs(rect.right - currentRect.right) <= 5 ||
					Math.abs(rect.left + rect.width / 2 - (currentRect.left + currentRect.width / 2)) <= 5
				);
			}

			return (
				Math.abs(rect.top - currentRect.top) <= 5 ||
				Math.abs(rect.bottom - currentRect.bottom) <= 5 ||
				Math.abs(rect.top + rect.height / 2 - (currentRect.top + currentRect.height / 2)) <= 5
			);
		});

		const pool = aligned.length > 0 ? aligned : candidates;
		let bestIndex = pool[0];
		let bestDistance = this.#distanceBetweenRects(
			currentRect,
			this.#getHintRect(this.#hints[bestIndex]),
		);

		for (let i = 1; i < pool.length; i += 1) {
			const rect = this.#getHintRect(this.#hints[pool[i]]);
			const distance = this.#distanceBetweenRects(currentRect, rect);
			if (distance < bestDistance) {
				bestDistance = distance;
				bestIndex = pool[i];
			}
		}

		this.#setTopHint(bestIndex);
		this.#ensureHintInViewport(bestIndex);
		return true;
	}

	#distanceBetweenRects(a: DOMRect, b: DOMRect): number {
		const centerAx = a.left + a.width / 2;
		const centerAy = a.top + a.height / 2;
		const centerBx = b.left + b.width / 2;
		const centerBy = b.top + b.height / 2;

		const dx = centerAx - centerBx;
		const dy = centerAy - centerBy;
		const center = dx * dx + dy * dy;
		const left = (a.left - b.left) * (a.left - b.left) + dy * dy;
		const right = (a.right - b.right) * (a.right - b.right) + dy * dy;
		const top = dx * dx + (a.top - b.top) * (a.top - b.top);
		const bottom = dx * dx + (a.bottom - b.bottom) * (a.bottom - b.bottom);

		return Math.min(center, left, right, top, bottom);
	}

	#ensureHintInViewport(index: number): void {
		const hint = this.#hints[index];
		if (!hint) return;
		const rect = this.#getHintRect(hint);
		const viewportTop = window.scrollY;
		const viewportBottom = viewportTop + window.innerHeight;
		const elementTop = viewportTop + rect.top;
		const elementBottom = viewportTop + rect.bottom;

		const padding = 100;
		if (elementTop >= viewportTop + padding && elementBottom <= viewportBottom - padding) {
			return;
		}

		let nextScroll = viewportTop;
		if (elementTop < viewportTop + padding) {
			nextScroll = elementTop - padding;
		} else if (elementBottom > viewportBottom - padding) {
			nextScroll = elementBottom + padding - window.innerHeight;
		}

		window.scrollTo({ top: Math.max(0, nextScroll), behavior: 'auto' });
		this.#showHints();
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
		if (this.#mode === 'newTab' || this.#mode === 'backgroundTab') {
			const url = this.#getElementUrl(element);
			if (url) {
				chrome.runtime.sendMessage({
					type: 'open-url',
					url,
					background: this.#mode === 'backgroundTab',
				});
				return;
			}
		}

		if (this.#isEditableElement(element)) {
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
			if (element.tabIndex >= 0) {
				element.focus();
			}
			const anchor = element.tagName === 'A' ? (element as HTMLAnchorElement) : null;
			if (anchor && this.#isJavascriptLink(anchor)) {
				element.addEventListener('click', (event) => event.preventDefault(), {
					capture: true,
					once: true,
				});
			}
			this.#dispatchMouseEvents(element);
		}
	}

	#getElementUrl(element: HTMLElement): string | null {
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
