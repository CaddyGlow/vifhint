import type { AppConfig } from './config';
import { isEditable } from './content-dom';

type CaretOptions = AppConfig['options']['caret'];

export class NormalModeController {
	#caret: HTMLDivElement | null = null;
	#caretUpdateId: number | null = null;
	#preferredCaretX: number | null = null;
	#onDomContentLoaded?: () => void;
	#initTimerId: number | null = null;
	#caretOptions: CaretOptions;

	constructor(caretOptions: CaretOptions) {
		this.#caretOptions = caretOptions;

		document.addEventListener('selectionchange', this.scheduleCaretUpdate);
		window.addEventListener('scroll', this.scheduleCaretUpdate, { passive: true });
		window.addEventListener('resize', this.scheduleCaretUpdate);
		document.addEventListener('focusin', this.scheduleCaretUpdate);
		document.addEventListener('focusout', this.scheduleCaretUpdate);

		const init = (): void => {
			this.ensureCaret();
			this.scheduleCaretUpdate();
		};

		if (document.readyState === 'loading') {
			this.#onDomContentLoaded = () => {
				init();
			};
			document.addEventListener('DOMContentLoaded', this.#onDomContentLoaded, { once: true });
		} else {
			this.#initTimerId = window.setTimeout(init, 0);
		}
	}

	dispose(): void {
		document.removeEventListener('selectionchange', this.scheduleCaretUpdate);
		window.removeEventListener('scroll', this.scheduleCaretUpdate);
		window.removeEventListener('resize', this.scheduleCaretUpdate);
		document.removeEventListener('focusin', this.scheduleCaretUpdate);
		document.removeEventListener('focusout', this.scheduleCaretUpdate);

		if (this.#onDomContentLoaded) {
			document.removeEventListener('DOMContentLoaded', this.#onDomContentLoaded);
			this.#onDomContentLoaded = undefined;
		}
		if (this.#initTimerId !== null) {
			window.clearTimeout(this.#initTimerId);
			this.#initTimerId = null;
		}
		if (this.#caretUpdateId !== null) {
			window.cancelAnimationFrame(this.#caretUpdateId);
			this.#caretUpdateId = null;
		}

		this.#preferredCaretX = null;
		this.#hideCaret();
		if (this.#caret) {
			this.#caret.remove();
			this.#caret = null;
		}
	}

	moveWord(direction: 'forward' | 'backward', count = 1): void {
		const selection = this.ensureCaret();
		if (!selection) return;

		const steps = Math.max(1, count);
		const alter = this.isVisualMode() ? 'extend' : 'move';
		const withModify = selection as Selection & {
			modify?: (alter: string, direction: string, granularity: string) => void;
		};
		if (!withModify.modify) return;

		for (let i = 0; i < steps; i += 1) {
			withModify.modify(alter, direction, 'word');
		}

		if (this.isLinewiseMode()) {
			this.normalizeLinewiseSelection(selection);
		}
		this.resetPreferredCaretX();
		this.scheduleCaretUpdate();
	}

	moveWordEnd(count = 1): void {
		const selection = this.ensureCaret();
		if (!selection) return;

		const steps = Math.max(1, count);
		const extend = this.isVisualMode();
		const alter = extend ? 'extend' : 'move';
		const withModify = selection as Selection & {
			modify?: (alter: string, direction: string, granularity: string) => void;
		};
		if (!withModify.modify) return;

		for (let i = 0; i < steps; i += 1) {
			withModify.modify(alter, 'forward', 'word');
			if (!extend) {
				withModify.modify('move', 'backward', 'character');
			}
		}

		if (this.isLinewiseMode()) {
			this.normalizeLinewiseSelection(selection);
		}
		this.resetPreferredCaretX();
		this.scheduleCaretUpdate();
	}

	moveBigWord(direction: 'forward' | 'backward', count = 1): void {
		const selection = this.ensureCaret();
		if (!selection) return;

		const steps = Math.max(1, count);
		for (let i = 0; i < steps; i += 1) {
			const moved = this.#moveWhitespaceWordOnce(selection, direction, this.isVisualMode());
			if (!moved) break;
		}

		if (this.isLinewiseMode()) {
			this.normalizeLinewiseSelection(selection);
		}
		this.resetPreferredCaretX();
		this.scheduleCaretUpdate();
	}

	moveLine(boundary: 'start' | 'first' | 'end', count = 1): void {
		const selection = this.ensureCaret();
		if (!selection) return;

		const steps = Math.max(1, count);
		const alter = this.isVisualMode() ? 'extend' : 'move';
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
				withModify.modify(alter, 'forward', 'word');
			}
		}

		if (this.isLinewiseMode()) {
			this.normalizeLinewiseSelection(selection);
		}
		this.resetPreferredCaretX();
		this.scheduleCaretUpdate();
	}

	moveParagraph(direction: 'prev' | 'next', count = 1): void {
		const selection = this.ensureCaret();
		if (!selection) return;

		const steps = Math.max(1, count);
		const alter = this.isVisualMode() ? 'extend' : 'move';
		const withModify = selection as Selection & {
			modify?: (alter: string, direction: string, granularity: string) => void;
		};
		if (!withModify.modify) return;

		for (let i = 0; i < steps; i += 1) {
			withModify.modify(alter, direction === 'next' ? 'forward' : 'backward', 'paragraph');
		}

		if (this.isLinewiseMode()) {
			this.normalizeLinewiseSelection(selection);
		}
		this.resetPreferredCaretX();
		this.scheduleCaretUpdate();
	}

	moveCaret(direction: 'left' | 'right' | 'up' | 'down', count = 1): void {
		const selection = this.ensureCaret();
		if (!selection) return;

		const steps = Math.max(1, count);
		const extend = this.isVisualMode();

		if (!extend && selection.rangeCount > 0 && !selection.isCollapsed) {
			const range = this.rangeFromSelectionFocus(selection);
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

		if (this.isLinewiseMode()) {
			this.normalizeLinewiseSelection(selection);
		}
		this.scheduleCaretUpdate();
	}

	scrollAndFollow(deltaY: number): void {
		if (deltaY === 0) return;

		const selection = this.ensureCaret();
		let anchor: { x: number; y: number } | null = null;
		if (selection && (this.isVisualMode() || (selection.rangeCount > 0 && selection.isCollapsed))) {
			anchor = this.#getCaretViewportPoint(selection);
		}

		window.scrollBy({ top: deltaY, behavior: 'auto' });

		if (!selection || !anchor) {
			this.scheduleCaretUpdate();
			return;
		}

		this.#moveCaretToViewportPoint(selection, anchor.x, anchor.y);
	}

	getWordUnderCaret(): string | null {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return null;

		const range = this.rangeFromSelectionFocus(selection) ?? selection.getRangeAt(0).cloneRange();
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

	protected isVisualMode(): boolean {
		return false;
	}

	protected isLinewiseMode(): boolean {
		return false;
	}

	protected normalizeLinewiseSelection(_selection: Selection): void {}

	protected resetPreferredCaretX(): void {
		this.#preferredCaretX = null;
	}

	protected scheduleCaretUpdate = (): void => {
		if (this.#caretUpdateId !== null) return;
		this.#caretUpdateId = window.requestAnimationFrame(() => {
			this.#caretUpdateId = null;
			this.#updateCaret();
		});
	};

	protected ensureCaret(): Selection | null {
		if (this.#isEditableActive()) {
			this.#hideCaret();
			return null;
		}

		const selection = window.getSelection();
		if (!selection) return null;

		if (selection.rangeCount > 0) return selection;

		const range = this.findInitialRange();
		if (!range) return null;

		selection.removeAllRanges();
		selection.addRange(range);
		return selection;
	}

	protected findInitialRange(): Range | null {
		const active = document.activeElement as HTMLElement | null;
		if (active?.isContentEditable) {
			const range = document.createRange();
			range.selectNodeContents(active);
			range.collapse(true);
			return range;
		}

		return this.findFirstVisibleTextRange();
	}

	protected findFirstVisibleTextRange(): Range | null {
		if (!document.body) return null;
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const text = node.textContent?.trim();
			if (!text) continue;
			const textNode = node as Text;
			if (!this.isTextNodeVisible(textNode)) continue;
			const range = document.createRange();
			range.setStart(textNode, 0);
			range.setEnd(textNode, 0);
			return range;
		}
		return null;
	}

	protected rangeFromSelectionFocus(selection: Selection): Range | null {
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

	protected getTextPositionFromRange(range: Range): { node: Text; offset: number } | null {
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
				const textNode = this.findTextNodeInSubtree(
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

	protected findTextNodeInSubtree(node: Node, direction: 'forward' | 'backward'): Text | null {
		const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
		if (direction === 'forward') {
			for (let current = walker.nextNode(); current; current = walker.nextNode()) {
				const textNode = current as Text;
				if (this.isTextNodeVisible(textNode)) return textNode;
			}
			return null;
		}

		const nodes: Text[] = [];
		for (let current = walker.nextNode(); current; current = walker.nextNode()) {
			const textNode = current as Text;
			if (this.isTextNodeVisible(textNode)) nodes.push(textNode);
		}
		return nodes.length > 0 ? nodes[nodes.length - 1] : null;
	}

	protected collectVisibleTextNodes(): Text[] {
		const nodes: Text[] = [];
		const root = document.body ?? document.documentElement;
		if (!root) return nodes;
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		for (let current = walker.nextNode(); current; current = walker.nextNode()) {
			const textNode = current as Text;
			if (this.isTextNodeVisible(textNode)) nodes.push(textNode);
		}
		return nodes;
	}

	protected isTextNodeVisible(node: Text): boolean {
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

	protected getContainingElement(range: Range): Element | null {
		let node: Node | null = range.commonAncestorContainer;
		if (node.nodeType === Node.TEXT_NODE) {
			node = node.parentElement;
		}
		if (node && node.nodeType === Node.ELEMENT_NODE) {
			return node as Element;
		}
		return null;
	}

	protected rangeForElement(element: Element): Range {
		const range = document.createRange();
		range.selectNodeContents(element);
		return range;
	}

	protected isSameRange(a: Range, b: Range): boolean {
		return (
			a.startContainer === b.startContainer &&
			a.startOffset === b.startOffset &&
			a.endContainer === b.endContainer &&
			a.endOffset === b.endOffset
		);
	}

	protected setSelectionWithDirection(
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

	protected getCaretRect(range: Range): DOMRect | null {
		const rects = range.getClientRects();
		if (rects.length > 0) return rects[0];
		const rect = range.getBoundingClientRect();
		if (rect.height > 0 || rect.width > 0) return rect;
		return null;
	}

	protected getBlockCaretRect(
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

	protected rangeFromPoint(x: number, y: number): Range | null {
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

	#getCaretViewportPoint(selection: Selection): { x: number; y: number } | null {
		if (selection.rangeCount === 0) return null;
		const range =
			selection.isCollapsed || !this.isVisualMode()
				? selection.getRangeAt(0)
				: this.rangeFromSelectionFocus(selection);
		if (!range) return null;
		const rect = this.getCaretRect(range);
		if (!rect) return null;
		const blockRect = this.getBlockCaretRect(range, rect) ?? rect;
		const x = this.#preferredCaretX ?? blockRect.left;
		const y = blockRect.top + blockRect.height / 2;
		return { x, y };
	}

	#moveCaretToViewportPoint(selection: Selection, x: number, y: number): void {
		const targetRange = this.rangeFromPoint(x, y);
		if (!targetRange) return;

		if (this.isVisualMode()) {
			const anchorNode = selection.anchorNode;
			if (!anchorNode) return;
			this.setSelectionWithDirection(
				selection,
				anchorNode,
				selection.anchorOffset,
				targetRange.startContainer,
				targetRange.startOffset,
			);
		} else {
			selection.removeAllRanges();
			selection.addRange(targetRange);
		}

		this.#preferredCaretX = x;
		if (this.isLinewiseMode()) {
			this.normalizeLinewiseSelection(selection);
		}
		this.scheduleCaretUpdate();
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

		if (!this.isVisualMode() && !selection.isCollapsed) {
			this.#hideCaret();
			return;
		}

		const range =
			selection.isCollapsed || !this.isVisualMode()
				? selection.getRangeAt(0)
				: this.rangeFromSelectionFocus(selection);
		if (!range) {
			this.#hideCaret();
			return;
		}
		const rect = this.getCaretRect(range);
		if (!rect) {
			this.#hideCaret();
			return;
		}

		const caret = this.#getCaretElement();
		caret.classList.toggle('is-visual', this.isVisualMode());
		caret.classList.toggle('is-normal', !this.isVisualMode());

		const blockRect = this.getBlockCaretRect(range, rect);
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

	#moveWhitespaceWordOnce(
		selection: Selection,
		direction: 'forward' | 'backward',
		extend: boolean,
	): boolean {
		const range = this.rangeFromSelectionFocus(selection);
		const position = range ? this.getTextPositionFromRange(range) : null;
		if (!position) return false;

		const nodes = this.collectVisibleTextNodes();
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

		const startRect = this.getCaretRect(startRange);
		if (!startRect) return;

		const preferredX = this.#preferredCaretX ?? startRect.left;
		let currentRange = startRange;
		let currentRect = startRect;

		for (let i = 0; i < steps; i += 1) {
			const step = Math.max(4, currentRect.height || 16);
			const targetY = direction === 'up' ? currentRect.top - step : currentRect.bottom + step;
			const nextRange = this.rangeFromPoint(preferredX, targetY);
			if (!nextRange) break;
			if (this.isSameRange(currentRange, nextRange)) break;

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
			currentRect = this.getCaretRect(currentRange) ?? currentRect;
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

		let currentRect = this.getCaretRect(currentRange);
		if (!currentRect) return;

		for (let i = 0; i < steps; i += 1) {
			const delta = direction === 'left' ? -1 : 1;
			const xBase = direction === 'left' ? currentRect.left : currentRect.right;
			const targetX = xBase + delta * 8;
			const targetY = currentRect.top + currentRect.height / 2;
			const nextRange = this.rangeFromPoint(targetX, targetY);
			if (!nextRange) break;
			if (this.isSameRange(currentRange, nextRange)) break;

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
			currentRect = this.getCaretRect(currentRange) ?? currentRect;
		}
	}

	#isEditableActive(): boolean {
		const active = document.activeElement as HTMLElement | null;
		if (!active || active === document.body) return false;
		return isEditable(active);
	}

	#getCaretElement(): HTMLDivElement {
		if (!this.#caret) {
			const caret = document.createElement('div');
			caret.className = 'hint-caret';
			if (this.#caretOptions.shape === 'block') {
				caret.classList.add('is-block');
			}
			if (this.#caretOptions.blink === 'blink') {
				caret.classList.add('is-blink');
			}
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
}
