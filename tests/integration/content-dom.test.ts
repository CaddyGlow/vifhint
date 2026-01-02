import { beforeAll, describe, expect, it } from 'bun:test';
import { getBottomBar, setupNoAutofocus } from '../../src/content-dom';
import { createDom } from '../helpers/dom';

describe('content dom integration', () => {
	beforeAll(() => {
		createDom();
	});

	it('creates and reuses the bottom bar host', () => {
		const bar = getBottomBar();
		expect(bar.className).toBe('hint-bottom-bar');
		expect(document.body.contains(bar)).toBe(true);
		expect(getBottomBar()).toBe(bar);
	});

	it('blocks programmatic autofocus for editable elements', async () => {
		const input = document.createElement('input');
		document.body.appendChild(input);

		input.focus();
		expect(document.activeElement).toBe(input);

		setupNoAutofocus(true);
		expect(document.activeElement).not.toBe(input);

		input.focus();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(document.activeElement).not.toBe(input);
	});
});
