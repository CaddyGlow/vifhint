import { beforeEach, describe, expect, it } from 'bun:test';
import { __test as linkHintTestHelpers } from '../../src/content-link-hints';
import { createDom } from '../helpers/dom';
import { installMockChrome } from '../helpers/mockChrome';

function createButton(label: string, x: number): HTMLButtonElement {
	const button = document.createElement('button');
	button.textContent = label;
	button.style.position = 'absolute';
	button.style.left = `${x}px`;
	button.style.top = '0px';
	button.style.width = '50px';
	button.style.height = '20px';
	Object.defineProperty(button, 'offsetWidth', { configurable: true, get: () => 50 });
	Object.defineProperty(button, 'offsetHeight', { configurable: true, get: () => 20 });
	button.getBoundingClientRect = () => new window.DOMRect(x, 0, 50, 20);
	return button;
}

describe('LinkHints search candidate collection', () => {
	beforeEach(() => {
		createDom();
		installMockChrome();
		Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
		Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
		const nodeFilter = (window as Window & typeof globalThis).NodeFilter ?? {
			SHOW_ELEMENT: 1,
			FILTER_ACCEPT: 1,
			FILTER_SKIP: 3,
		};
		(globalThis as unknown as { NodeFilter?: unknown }).NodeFilter = nodeFilter;
		document.body.innerHTML = '';
	});

	it('includes visible clickable elements and skips hidden ones', () => {
		const visible = createButton('Save', 0);
		const hidden = createButton('Hidden', 60);
		hidden.style.display = 'none';
		document.body.append(visible, hidden);

		const candidates = linkHintTestHelpers.collectSearchCandidates();
		const labels = candidates.map((c) => c.element.textContent);

		expect(labels).toContain('Save');
		expect(labels).not.toContain('Hidden');
	});
});
