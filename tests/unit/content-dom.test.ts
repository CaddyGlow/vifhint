import { beforeAll, describe, expect, it } from 'bun:test';
import { isEditable } from '../../src/content-dom';
import { createDom } from '../helpers/dom';

describe('content dom utilities', () => {
	beforeAll(() => {
		createDom();
	});

	it('detects editable elements', () => {
		const input = document.createElement('input');
		input.type = 'text';
		expect(isEditable(input)).toBe(true);

		const hiddenInput = document.createElement('input');
		hiddenInput.type = 'hidden';
		expect(isEditable(hiddenInput)).toBe(false);

		const textarea = document.createElement('textarea');
		expect(isEditable(textarea)).toBe(true);

		const select = document.createElement('select');
		expect(isEditable(select)).toBe(true);

		const button = document.createElement('button');
		expect(isEditable(button)).toBe(false);
	});
});
