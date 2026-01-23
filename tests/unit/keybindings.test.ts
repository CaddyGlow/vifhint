import { beforeAll, describe, expect, it } from 'bun:test';
import type { Keymap } from '../../src/config';
import { KeyBindings } from '../../src/keybindings';
import type { HintMode } from '../../src/types';
import { createDom } from '../helpers/dom';

type SequenceEvent = { status: string; tokens?: readonly string[]; sequence?: string };

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

function dispatchKey(key: string, init: KeyboardEventInit = {}): void {
	const event = new window.KeyboardEvent('keydown', {
		key,
		bubbles: true,
		cancelable: true,
		...init,
	});
	document.dispatchEvent(event);
}

function createSelectionRecorder() {
	const moves: Array<{ direction: 'forward' | 'backward'; count?: number }> = [];
	const controller = {
		expand: () => {},
		shrink: () => {},
		toggle: () => {},
		toggleLinewise: () => {},
		yank: () => {},
		moveWord: (direction: 'forward' | 'backward', count?: number) => {
			moves.push({ direction, count });
		},
		moveWordEnd: () => {},
		moveBigWord: () => {},
		moveLine: () => {},
		moveParagraph: () => {},
		selectTextObject: () => {},
		moveCaret: () => {},
		scrollAndFollow: () => {},
		swapSelectionEndpoint: () => {},
		getWordUnderCaret: () => null,
	};
	return { controller, moves } as const;
}

function createBindings(keymaps: Keymap[], timeoutlen = 25) {
	const selection = createSelectionRecorder();
	const linkHints = {
		isActive: () => false,
		activate: (_mode?: HintMode) => {},
	};
	const events: SequenceEvent[] = [];
	const bindings = new KeyBindings(linkHints, selection.controller, null, null, keymaps, {
		timeoutlen,
		onKeySequence: (event) => events.push(event),
	});
	return { bindings, events, selection };
}

describe('keybindings sequence handling', () => {
	beforeAll(() => {
		createDom();
	});

	it('clears partial sequences after timeout', async () => {
		const keymaps: Keymap[] = [
			{ lhs: 'abc', rhs: 'motion:word-forward', desc: 'test', repeatable: true },
		];
		const { bindings, events } = createBindings(keymaps, 5);

		dispatchKey('a');
		expect(events.at(-1)).toEqual({ status: 'partial', tokens: ['a'] });

		await sleep(8);
		dispatchKey('b');
		expect(events.at(-1)).toEqual({ status: 'none' });

		bindings.dispose();
	});

	it('matches sequences after partial input', () => {
		const keymaps: Keymap[] = [
			{ lhs: 'aa', rhs: 'motion:word-forward', desc: 'forward', repeatable: true },
		];
		const { bindings, events, selection } = createBindings(keymaps);

		dispatchKey('a');
		dispatchKey('a');

		expect(selection.moves).toEqual([{ direction: 'forward', count: 1 }]);
		expect(events.some((e) => e.status === 'match')).toBe(true);

		bindings.dispose();
	});

	it('drops pending count when sequence does not match', () => {
		const keymaps: Keymap[] = [
			{ lhs: 'aa', rhs: 'motion:word-forward', desc: 'forward', repeatable: true },
		];
		const { bindings, selection } = createBindings(keymaps);

		dispatchKey('3');
		dispatchKey('z');
		dispatchKey('a');
		dispatchKey('a');

		expect(selection.moves.at(-1)?.count).toBe(1);

		bindings.dispose();
	});

	it('matches three-key sequences like gx0', () => {
		const keymaps: Keymap[] = [
			{ lhs: 'g0', rhs: 'tab:first', desc: 'first tab', repeatable: false },
			{ lhs: 'gx0', rhs: 'tab:close-all-left', desc: 'close left', repeatable: false },
		];
		const { bindings, events } = createBindings(keymaps);

		dispatchKey('g');
		expect(events.at(-1)).toEqual({ status: 'partial', tokens: ['g'] });

		dispatchKey('x');
		expect(events.at(-1)).toEqual({ status: 'partial', tokens: ['g', 'x'] });

		dispatchKey('0');
		expect(events.at(-1)?.status).toBe('match');
		expect(events.at(-1)?.sequence).toBe('gx0');

		bindings.dispose();
	});

	it('matches g0 without conflict with gx0', () => {
		const keymaps: Keymap[] = [
			{ lhs: 'g0', rhs: 'tab:first', desc: 'first tab', repeatable: false },
			{ lhs: 'gx0', rhs: 'tab:close-all-left', desc: 'close left', repeatable: false },
		];
		const { bindings, events } = createBindings(keymaps);

		dispatchKey('g');
		dispatchKey('0');

		expect(events.at(-1)?.status).toBe('match');
		expect(events.at(-1)?.sequence).toBe('g0');

		bindings.dispose();
	});
});
