import { beforeAll, describe, expect, it } from 'bun:test';
import type { Keymap } from '../../src/config';
import { KeyBindings } from '../../src/keybindings';
import type { HintMode } from '../../src/types';
import { createDom } from '../helpers/dom';
import { installMockChrome } from '../helpers/mockChrome';

type SelectionMove = { direction: 'forward' | 'backward'; count?: number };

const dispatchKey = (key: string): void => {
	document.dispatchEvent(
		new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
	);
};

function createSelectionRecorder() {
	const moves: SelectionMove[] = [];
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

describe('KeyBindings with help overlay', () => {
	beforeAll(() => {
		createDom();
		installMockChrome();
	});

	it('blocks commands while help overlay is visible and resumes after closing', () => {
		const keymaps: Keymap[] = [
			{ lhs: 'j', rhs: 'motion:word-forward', desc: 'forward', repeatable: true },
		];

		const selection = createSelectionRecorder();
		const linkHints = { isActive: () => false, activate: (_mode?: HintMode) => {} };

		let overlayVisible = true;
		const helpOverlay = {
			isVisible: () => overlayVisible,
			toggle: () => {
				overlayVisible = !overlayVisible;
			},
			hide: () => {
				overlayVisible = false;
			},
		};

		const bindings = new KeyBindings(linkHints, selection.controller, null, helpOverlay, keymaps);

		dispatchKey('j');
		expect(selection.moves).toHaveLength(0);

		dispatchKey('Escape');
		expect(helpOverlay.isVisible()).toBe(false);

		dispatchKey('j');
		expect(selection.moves).toEqual([{ direction: 'forward', count: 1 }]);

		bindings.dispose();
	});
});
