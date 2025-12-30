import type { AppConfig } from './config';
import { getBottomBar } from './content-dom';
import { NormalModeController } from './normal-mode-controller';

type CaretOptions = AppConfig['options']['caret'];

export class VisualModeController extends NormalModeController {
	#rangeStack: Range[] = [];
	#visualMode = false;
	#visualLineMode = false;
	#indicator: HTMLDivElement | null = null;
	#onKeyDown?: (event: KeyboardEvent) => void;

	constructor(caretOptions: CaretOptions) {
		super(caretOptions);
		this.#onKeyDown = (event) => {
			if (event.key === 'Escape' && this.#visualMode) {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
				this.#exitVisualMode();
			}
		};
		document.addEventListener('keydown', this.#onKeyDown);
	}

	override dispose(): void {
		if (this.#onKeyDown) {
			document.removeEventListener('keydown', this.#onKeyDown);
			this.#onKeyDown = undefined;
		}
		this.#rangeStack = [];
		this.#visualMode = false;
		this.#visualLineMode = false;
		this.#hideIndicator();
		if (this.#indicator) {
			this.#indicator.remove();
			this.#indicator = null;
		}
		super.dispose();
	}

	protected override isVisualMode(): boolean {
		return this.#visualMode;
	}

	protected override isLinewiseMode(): boolean {
		return this.#visualLineMode;
	}

	protected override normalizeLinewiseSelection(selection: Selection): void {
		if (!this.#visualLineMode) return;
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

		this.setSelectionWithDirection(
			selection,
			anchorBoundary.node,
			anchorBoundary.offset,
			focusBoundary.node,
			focusBoundary.offset,
		);
	}

	toggle(): void {
		if (this.#visualMode) {
			this.#exitVisualMode();
		} else {
			this.#enterVisualMode();
		}
		this.scheduleCaretUpdate();
	}

	toggleLinewise(): void {
		if (this.#visualMode && this.#visualLineMode) {
			this.#exitVisualMode();
		} else {
			this.#enterVisualLineMode();
		}
		this.scheduleCaretUpdate();
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

		const container = this.getContainingElement(currentRange);
		if (!container) return;

		const containerRange = this.rangeForElement(container);
		let nextRange: Range | null = null;

		if (!this.isSameRange(currentRange, containerRange)) {
			nextRange = containerRange;
		} else {
			const parent = container.parentElement;
			if (!parent) return;
			nextRange = this.rangeForElement(parent);
		}

		this.#applyRange(selection, nextRange);
		this.#rangeStack.push(nextRange.cloneRange());
		this.#visualMode = true;
		this.#showIndicator('VISUAL');
		this.scheduleCaretUpdate();
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
		if (!this.isSameRange(currentRange, lastRange)) {
			this.#rangeStack = [currentRange];
			return;
		}

		if (this.#rangeStack.length <= 1) return;

		this.#rangeStack.pop();
		const previousRange = this.#rangeStack[this.#rangeStack.length - 1];
		this.#applyRange(selection, previousRange);
		this.#visualMode = true;
		this.#showIndicator('VISUAL');
		this.scheduleCaretUpdate();
	}

	yank(): void {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) {
			if (this.#visualMode) {
				this.#exitVisualMode();
			}
			return;
		}

		const text = selection.toString();
		if (!text) {
			if (this.#visualMode) {
				this.#exitVisualMode();
			}
			return;
		}

		void this.#copyText(text).finally(() => {
			if (this.#visualMode) {
				this.#exitVisualMode();
			}
		});
	}

	selectTextObject(kind: 'word' | 'paragraph', around: boolean): void {
		const selection = window.getSelection();
		if (!selection) return;

		let range: Range | null = null;
		if (selection.rangeCount > 0) {
			range = this.rangeFromSelectionFocus(selection) ?? selection.getRangeAt(0).cloneRange();
		} else {
			range = this.findInitialRange();
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
		this.#visualMode = true;
		this.#visualLineMode = false;
		this.#showIndicator('VISUAL');
		this.resetPreferredCaretX();
		this.scheduleCaretUpdate();
	}

	swapSelectionEndpoint(): void {
		if (!this.#visualMode) return;
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

		this.resetPreferredCaretX();
		if (this.#visualLineMode) {
			this.normalizeLinewiseSelection(selection);
		}
		this.scheduleCaretUpdate();
	}

	#syncStack(currentRange: Range): void {
		if (this.#rangeStack.length === 0) {
			this.#rangeStack = [currentRange.cloneRange()];
			return;
		}

		const lastRange = this.#rangeStack[this.#rangeStack.length - 1];
		if (!this.isSameRange(currentRange, lastRange)) {
			this.#rangeStack = [currentRange.cloneRange()];
		}
	}

	#enterVisualMode(): void {
		const selection = window.getSelection();
		if (!selection) return;

		let range: Range | null = this.rangeFromSelectionFocus(selection);
		if (!range) range = this.findInitialRange();

		if (!range) return;

		selection.removeAllRanges();
		selection.addRange(range);
		this.#rangeStack = [range.cloneRange()];
		this.#visualMode = true;
		this.#visualLineMode = false;
		this.#showIndicator('VISUAL');
		this.#selectCharacterAtCaret(selection);
		this.scheduleCaretUpdate();
	}

	#enterVisualLineMode(): void {
		const selection = window.getSelection();
		if (!selection) return;

		let range: Range | null = null;
		if (selection.rangeCount > 0) {
			range = selection.getRangeAt(0).cloneRange();
		} else {
			range = this.rangeFromSelectionFocus(selection);
			if (!range) range = this.findInitialRange();
			if (!range) return;
			selection.removeAllRanges();
			selection.addRange(range);
		}

		this.#rangeStack = [range.cloneRange()];
		this.#visualMode = true;
		this.#visualLineMode = true;
		this.#showIndicator('VISUAL LINE');
		this.normalizeLinewiseSelection(selection);
		this.scheduleCaretUpdate();
	}

	#exitVisualMode(): void {
		const selection = window.getSelection();
		if (selection && selection.rangeCount > 0) {
			const range = this.rangeFromSelectionFocus(selection);
			if (range) {
				selection.removeAllRanges();
				selection.addRange(range);
			}
		} else {
			this.ensureCaret();
		}
		this.#rangeStack = [];
		this.#visualMode = false;
		this.#visualLineMode = false;
		this.#hideIndicator();
		this.scheduleCaretUpdate();
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

		const rect = this.getCaretRect(range);
		if (!rect) return { node: range.startContainer, offset: range.startOffset };
		const y = rect.top + rect.height / 2;
		const x = edge === 'start' ? 1 : window.innerWidth - 2;
		const boundaryRange = this.rangeFromPoint(x, y);
		if (!boundaryRange) return { node: range.startContainer, offset: range.startOffset };
		return { node: boundaryRange.startContainer, offset: boundaryRange.startOffset };
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

	#selectWordObject(selection: Selection, around: boolean): boolean {
		if (selection.rangeCount === 0) return false;
		const range = selection.getRangeAt(0).cloneRange();
		const position = this.getTextPositionFromRange(range);
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
		let container = this.getContainingElement(range) as HTMLElement | null;
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
		return this.getContainingElement(range) as HTMLElement | null;
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
		this.#visualMode = true;
		this.#showIndicator('VISUAL');
		this.scheduleCaretUpdate();
		return true;
	}

	#applyRange(selection: Selection, range: Range): void {
		selection.removeAllRanges();
		selection.addRange(range);
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
