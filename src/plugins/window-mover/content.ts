import type { KeymapContribution, PluginContext } from '../types';
import { manifest } from './manifest';

type RemoteTab = {
	readonly title: string;
	readonly url: string;
};

type RemoteWindow = {
	readonly id: number;
	readonly tabs: RemoteTab[];
	readonly isPreviousChoice?: boolean;
};

type WindowListResponse = {
	readonly windows: RemoteWindow[];
};

type SelectHandler = (windowId: number) => void | Promise<void>;

type NavDirection = 'up' | 'down';

class WindowMoverOverlay {
	#root: HTMLDivElement;
	#list: HTMLDivElement;
	#visible = false;
	#items: Array<{ windowId: number; el: HTMLDivElement }> = [];
	#selected = 0;
	#onSelect: SelectHandler = () => {};
	#onClose: (() => void) | null = null;
	#keyHandler: ((event: KeyboardEvent) => void) | null = null;

	constructor() {
		this.#root = document.createElement('div');
		this.#root.className = 'hint-window-mover';

		const card = document.createElement('div');
		card.className = 'hint-window-mover-card';

		const header = document.createElement('div');
		header.className = 'hint-window-mover-header';

		const title = document.createElement('div');
		title.className = 'hint-window-mover-title';
		title.textContent = 'Move tab to window';
		header.appendChild(title);

		const help = document.createElement('div');
		help.className = 'hint-window-mover-help';
		help.textContent = 'j/k or ↑/↓ to choose · Enter to move · Esc to cancel';
		header.appendChild(help);

		card.appendChild(header);

		this.#list = document.createElement('div');
		this.#list.className = 'hint-window-mover-list';
		card.appendChild(this.#list);

		this.#root.appendChild(card);
	}

	show(windows: RemoteWindow[], onSelect: SelectHandler, onClose: () => void): void {
		if (this.#visible) {
			this.hide();
		}

		this.#onSelect = onSelect;
		this.#onClose = onClose;

		this.#list.replaceChildren();
		this.#items = [];
		this.#selected = 0;

		// Add a “New window” option first.
		this.#addItem({
			windowId: -1,
			title: 'New window',
			subtitle: 'Move tab into a fresh window',
			tabPreviews: [],
		});

		for (const w of windows) {
			this.#addItem({
				windowId: w.id,
				title: `Window ${w.id}`,
				subtitle: `${w.tabs.length} tab${w.tabs.length === 1 ? '' : 's'}`,
				tabPreviews: w.tabs.slice(0, 4),
				isPreviousChoice: w.isPreviousChoice === true,
			});
		}

		if (this.#items.length > 1) {
			const previousIndex = this.#items.findIndex((item) => item.el.classList.contains('is-prev'));
			if (previousIndex >= 0) {
				this.#selected = previousIndex;
			}
		}

		this.#applySelection();

		if (!this.#root.isConnected) {
			(document.body ?? document.documentElement).appendChild(this.#root);
		}
		this.#root.classList.add('is-visible');
		this.#visible = true;
		this.#attachKeyHandler();
	}

	hide(): void {
		if (!this.#visible) return;
		this.#root.classList.remove('is-visible');
		this.#visible = false;
		this.#items = [];
		this.#detachKeyHandler();
		this.#onClose?.();
	}

	destroy(): void {
		this.hide();
		this.#root.remove();
	}

	#addItem(options: {
		windowId: number;
		title: string;
		subtitle?: string;
		tabPreviews: RemoteTab[];
		isPreviousChoice?: boolean;
	}): void {
		const row = document.createElement('div');
		row.className = 'hint-window-mover-row';
		if (options.isPreviousChoice) {
			row.classList.add('is-prev');
		}
		row.dataset.windowId = String(options.windowId);

		const title = document.createElement('div');
		title.className = 'hint-window-mover-row-title';
		title.textContent = options.title;

		const subtitle = document.createElement('div');
		subtitle.className = 'hint-window-mover-row-subtitle';
		subtitle.textContent = options.subtitle ?? '';

		const previews = document.createElement('div');
		previews.className = 'hint-window-mover-previews';
		for (const tab of options.tabPreviews) {
			const pill = document.createElement('div');
			pill.className = 'hint-window-mover-pill';
			pill.textContent = tab.title || new URL(tab.url).host;
			previews.appendChild(pill);
		}

		row.appendChild(title);
		row.appendChild(subtitle);
		if (options.tabPreviews.length > 0) {
			row.appendChild(previews);
		}

		row.addEventListener('click', () => {
			this.#selected = this.#items.findIndex((item) => item.el === row);
			this.#applySelection();
			void this.#confirmSelection();
		});

		this.#list.appendChild(row);
		this.#items.push({ windowId: options.windowId, el: row });
	}

	#attachKeyHandler(): void {
		this.#keyHandler = (event: KeyboardEvent) => {
			if (!this.#visible) return;
			const key = event.key;
			if (key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				this.hide();
				return;
			}

			if (key === 'Enter') {
				event.preventDefault();
				event.stopPropagation();
				void this.#confirmSelection();
				return;
			}

			if (key === 'ArrowUp' || key === 'k') {
				event.preventDefault();
				event.stopPropagation();
				this.#moveSelection('up');
				return;
			}

			if (key === 'ArrowDown' || key === 'j') {
				event.preventDefault();
				event.stopPropagation();
				this.#moveSelection('down');
			}
		};
		document.addEventListener('keydown', this.#keyHandler, true);
	}

	#detachKeyHandler(): void {
		if (this.#keyHandler) {
			document.removeEventListener('keydown', this.#keyHandler, true);
			this.#keyHandler = null;
		}
	}

	#moveSelection(direction: NavDirection): void {
		if (this.#items.length === 0) return;
		if (direction === 'up') {
			this.#selected = (this.#selected - 1 + this.#items.length) % this.#items.length;
		} else {
			this.#selected = (this.#selected + 1) % this.#items.length;
		}
		this.#applySelection();
	}

	#applySelection(): void {
		for (const [index, item] of this.#items.entries()) {
			if (index === this.#selected) {
				item.el.classList.add('is-selected');
				item.el.scrollIntoView({ block: 'nearest' });
			} else {
				item.el.classList.remove('is-selected');
			}
		}
	}

	async #confirmSelection(): Promise<void> {
		const item = this.#items[this.#selected];
		if (!item) return;
		await this.#onSelect(item.windowId);
		this.hide();
	}
}

async function listOtherWindows(): Promise<RemoteWindow[]> {
	return new Promise((resolve, reject) => {
		chrome.runtime.sendMessage({ type: 'window-mover:list' }, (response: WindowListResponse) => {
			if (chrome.runtime.lastError) {
				reject(chrome.runtime.lastError);
				return;
			}
			resolve(response?.windows ?? []);
		});
	});
}

async function moveToWindow(windowId: number): Promise<void> {
	return new Promise((resolve, reject) => {
		chrome.runtime.sendMessage({ type: 'window-mover:move', windowId }, () => {
			if (chrome.runtime.lastError) {
				reject(chrome.runtime.lastError);
				return;
			}
			resolve();
		});
	});
}

export const activateContent = (ctx: PluginContext) => {
	if (ctx.context !== 'content') return;

	const overlay = new WindowMoverOverlay();

	const command = async (): Promise<void> => {
		let windows: RemoteWindow[] = [];
		try {
			windows = await listOtherWindows();
		} catch (error) {
			ctx.log('Failed to list windows', error);
			ctx.ui.toast('Could not fetch windows');
			return;
		}

		if (windows.length === 0) {
			try {
				await moveToWindow(-1);
				ctx.ui.toast('Moved tab to a new window');
			} catch (error) {
				ctx.log('Failed to move tab to new window', error);
				ctx.ui.toast('Move failed');
			}
			return;
		}

		overlay.show(
			windows,
			async (windowId) => {
				try {
					await moveToWindow(windowId);
					ctx.ui.toast(windowId === -1 ? 'Moved tab to a new window' : 'Moved tab');
				} catch (error) {
					ctx.log('Failed to move tab', error);
					ctx.ui.toast('Move failed');
				}
			},
			() => overlay.hide(),
		);
	};

	ctx.registerCommand('window.moveTab', async () => {
		await command();
	});

	// Ensure the keymap is present even if registry contributions are filtered.
	ctx.registerKeymap({
		lhs: '<leader>w',
		rhs: 'window.moveTab',
		desc: 'Move current tab to another window',
		repeatable: false,
	} satisfies KeymapContribution);

	const disposers = [
		ctx.on('hint:activate', () => overlay.hide()),
		ctx.on('search:open', () => overlay.hide()),
	];

	return () => {
		overlay.destroy();
		for (const dispose of disposers) {
			dispose();
		}
	};
};
