import { isEditable } from './content-dom';

interface ElementData {
	readonly element: HTMLElement;
	readonly rect: DOMRect;
	readonly style: CSSStyleDeclaration;
}

interface HintElement {
	readonly element: HTMLElement;
	readonly hint: string;
	readonly hintUpper: string;
	readonly label: HTMLElement;
	readonly matchedSpan: HTMLSpanElement;
	readonly remainingSpan: HTMLSpanElement;
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

const config: HintConfig = {
	hintChars: 'asdfghjkl',
	hintAlign: 'left',
	hintOffset: { x: -8, y: -10 },
	clickableSelector: '',
	showElementBorder: true,
	debugTimings: true,
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

	constructor() {
		this.#setupKeyListener();
		this.#setupCommandListener();
	}

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
		document.addEventListener(
			'keydown',
			(e) => {
				if (!this.#active) return;

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
			},
			true,
		);
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
		this.#lastInput = '';
		this.#activeHintIndices = [];
		this.#hintMap.clear();
		this.#hintLength = 0;

		this.#createInputDisplay();
		this.#attachResizeListener();

		const timings: Record<string, number> = {};
		const mark = (label: string): void => {
			if (config.debugTimings) timings[label] = performance.now();
		};
		const fmt = (value: number): string => value.toFixed(1);

		mark('start');

		const elements = sortElementsForHints(collectClickableElements());
		mark('collected');

		const hintStrings = this.#generateHints(elements.length);
		mark('generated');

		this.#hints = elements.map((data, i) => {
			const { label, matchedSpan, remainingSpan } = this.#createLabel(hintStrings[i]);
			return {
				element: data.element,
				hint: hintStrings[i],
				hintUpper: hintStrings[i].toUpperCase(),
				label,
				matchedSpan,
				remainingSpan,
			};
		});
		this.#hintMap.clear();
		for (let i = 0; i < hintStrings.length; i += 1) {
			this.#hintMap.set(hintStrings[i], i);
		}
		this.#hintLength = hintStrings[0]?.length ?? 0;
		mark('created');

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
		this.#lastInput = '';
		this.#activeHintIndices = [];
		this.#hintMap.clear();
		this.#hintLength = 0;
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

	#createLabel(text: string): {
		label: HTMLElement;
		matchedSpan: HTMLSpanElement;
		remainingSpan: HTMLSpanElement;
	} {
		const label = document.createElement('div');
		label.className = 'link-hint-label';
		const matchedSpan = document.createElement('span');
		matchedSpan.className = 'matched';
		const remainingSpan = document.createElement('span');
		remainingSpan.textContent = text.toUpperCase();
		label.appendChild(matchedSpan);
		label.appendChild(remainingSpan);
		return { label, matchedSpan, remainingSpan };
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

			let left =
				config.hintAlign === 'right'
					? rect.right + scrollX + offsetX
					: config.hintAlign === 'center'
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
		});

		document.body.appendChild(fragment);
	}

	#filterHints(): void {
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
