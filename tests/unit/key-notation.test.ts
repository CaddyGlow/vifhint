import { describe, expect, it } from 'bun:test';
import {
	eventToKeyToken,
	formatKeySequenceForDisplay,
	parseKeySequence,
} from '../../src/key-notation';

describe('key notation', () => {
	it('parses leader and modifier sequences', () => {
		const tokens = parseKeySequence('<leader>ff<C-A-x><S-a>', ' ');
		expect(tokens).toEqual(['<Space>', 'f', 'f', '<C-A-x>', 'A']);
	});

	it('normalizes modifier ordering and aliases', () => {
		const tokens = parseKeySequence('<a-c-x><ctrl-shift-k>', ' ');
		expect(tokens).toEqual(['<C-A-x>', '<C-S-k>']);
	});

	it('formats sequences for display', () => {
		const display = formatKeySequenceForDisplay('<Space><Esc><CR><Tab>', ' ');
		expect(display).toEqual(['SPC', 'Esc', 'CR', 'Tab']);
	});

	it('maps keyboard events to tokens', () => {
		const ctrlA = eventToKeyToken({
			key: 'a',
			ctrlKey: true,
			altKey: false,
			metaKey: false,
			shiftKey: false,
		} as KeyboardEvent);
		expect(ctrlA).toBe('<C-a>');

		const shifted = eventToKeyToken({
			key: 'A',
			ctrlKey: false,
			altKey: false,
			metaKey: false,
			shiftKey: true,
		} as KeyboardEvent);
		expect(shifted).toBe('A');

		const special = eventToKeyToken({
			key: 'Enter',
			ctrlKey: true,
			altKey: false,
			metaKey: false,
			shiftKey: false,
		} as KeyboardEvent);
		expect(special).toBe('<C-CR>');

		const ignored = eventToKeyToken({
			key: 'Shift',
			ctrlKey: false,
			altKey: false,
			metaKey: false,
			shiftKey: true,
		} as KeyboardEvent);
		expect(ignored).toBeNull();
	});
});
