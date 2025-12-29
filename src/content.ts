// Optimized link hints implementation

import { appConfig } from './config';
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

type KeyBinding = (typeof appConfig.keyBindings.bindings)[number];

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
	'Selection',
	'Other',
] as const;

function groupForBinding(binding: KeyBinding): string {
	if (binding.operation.startsWith('tab:')) return 'Tabs';
	if (binding.operation.startsWith('scroll:')) return 'Scroll';
	if (binding.operation.startsWith('hints:')) return 'Hints';
	if (binding.operation.startsWith('focus:')) return 'Focus';
	if (binding.operation.startsWith('selection:')) return 'Selection';
	if (binding.operation.startsWith('find:')) return 'Find';
	if (binding.operation.startsWith('help:')) return 'Help';
	return 'Other';
}

function createKeyCaps(keys: string): HTMLElement {
	const container = document.createElement('span');
	container.className = 'hint-help-keys';
	for (const char of keys) {
		const key = document.createElement('kbd');
		key.textContent = char;
		container.appendChild(key);
	}
	return container;
}

class HelpOverlay {
	#overlay: HTMLDivElement;
	#bindings: readonly KeyBinding[];

	constructor(bindings: readonly KeyBinding[]) {
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
		overlay.setAttribute('aria-label', 'Key bindings');

		const card = document.createElement('div');
		card.className = 'hint-help-card';

		const header = document.createElement('div');
		header.className = 'hint-help-header';

		const title = document.createElement('div');
		title.className = 'hint-help-title';
		title.textContent = 'Key bindings';

		const subtitle = document.createElement('div');
		subtitle.className = 'hint-help-subtitle';
		subtitle.textContent = 'Press ? or Esc to close';

		header.appendChild(title);
		header.appendChild(subtitle);
		card.appendChild(header);

		const sectionsContainer = document.createElement('div');
		sectionsContainer.className = 'hint-help-sections';

		const grouped = new Map<string, KeyBinding[]>();
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
				desc.textContent = binding.description;

				row.appendChild(createKeyCaps(binding.keys));
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

	next(): void {}

	prev(): void {}
}

class CustomFindController {
	open(): void {
		console.info('[hint] Custom find mode is not implemented yet.');
	}

	close(): void {}

	isActive(): boolean {
		return false;
	}

	next(): void {
		console.info('[hint] Custom find mode is not implemented yet.');
	}

	prev(): void {
		console.info('[hint] Custom find mode is not implemented yet.');
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

function shouldStealFocusFrom(el: HTMLElement): boolean {
	if (el === document.body || el === document.documentElement) return false;
	return isEditable(el);
}

function setupStealFocusOnLoad(): void {
	if (!appConfig.settings.stealFocusOnLoad) return;

	const blurActive = (): void => {
		const active = document.activeElement as HTMLElement | null;
		if (active && shouldStealFocusFrom(active)) {
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
		if (target && shouldStealFocusFrom(target)) {
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

		this.#hints.forEach((hint, i) => {
			const { rect } = elements[i];

			// Calculate horizontal position based on alignment
			let left =
				config.hintAlign === 'right'
					? rect.right + window.scrollX + config.hintOffset.x
					: config.hintAlign === 'center'
						? rect.left + rect.width / 2 + window.scrollX + config.hintOffset.x
						: rect.left + window.scrollX + config.hintOffset.x;

			let top = rect.top + window.scrollY + config.hintOffset.y;

			// Keep within viewport
			const minLeft = window.scrollX + 2;
			const maxLeft = window.scrollX + window.innerWidth - 30;
			const minTop = window.scrollY + 2;

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
			document.body.appendChild(hint.label);
		});
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
	#indicator: HTMLDivElement | null = null;

	constructor() {
		document.addEventListener('keydown', (event) => {
			if (event.key === 'Escape' && this.#caretMode) {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
				this.#exitCaretMode();
			}
		});
	}

	toggle(): void {
		if (this.#caretMode) {
			this.#exitCaretMode();
		} else {
			this.#enterCaretMode();
		}
	}

	expand(): void {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return;

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
	}

	yank(): void {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return;

		const text = selection.toString();
		if (!text) return;

		void this.#copyText(text);
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

		let range: Range | null = null;
		if (selection.rangeCount > 0) {
			range = selection.getRangeAt(0).cloneRange();
			range.collapse(true);
		} else {
			range = this.#findInitialRange();
		}

		if (!range) return;

		selection.removeAllRanges();
		selection.addRange(range);
		this.#rangeStack = [range.cloneRange()];
		this.#caretMode = true;
		this.#showIndicator('VISUAL');
	}

	#exitCaretMode(): void {
		const selection = window.getSelection();
		selection?.removeAllRanges();
		this.#rangeStack = [];
		this.#caretMode = false;
		this.#hideIndicator();
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
function getActiveBindings(useNativeFind: boolean): readonly KeyBinding[] {
	return appConfig.keyBindings.bindings.filter((binding) => {
		if (useNativeFind && (binding.operation === 'find:next' || binding.operation === 'find:prev')) {
			return false;
		}
		return true;
	});
}

setupStealFocusOnLoad();
const linkHints = new LinkHints();
const incrementalSelection = new IncrementalSelection();
const useNativeFind = appConfig.settings.findMode === 'native';
const searchController = useNativeFind ? new NativeFindController() : new CustomFindController();
const activeBindings = getActiveBindings(useNativeFind);
const helpOverlay = new HelpOverlay(activeBindings);
new KeyBindings(linkHints, incrementalSelection, searchController, helpOverlay, activeBindings);
