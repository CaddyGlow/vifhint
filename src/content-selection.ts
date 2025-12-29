import { getBottomBar, isEditable } from './content-dom';

export class IncrementalSelection {
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
