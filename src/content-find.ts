import { getBottomBar } from './content-dom';

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

export class NativeFindController {
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

export class CustomFindController {
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
