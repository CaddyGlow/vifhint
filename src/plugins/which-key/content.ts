import type { Keymap } from '../../config';
import { type KeyToken, formatKeyTokenForDisplay, parseKeySequence } from '../../key-notation';
import type { KeySequenceEvent, KeymapContribution, PluginContext } from '../types';
import { manifest } from './manifest';

type Binding = {
	lhs: string;
	desc: string;
	tokens: KeyToken[];
};

type TrieNode = {
	children: Map<KeyToken, TrieNode>;
	binding?: Binding;
};

type Entry = {
	key: KeyToken;
	desc: string;
	isPrefix: boolean;
};

function buildTrie(bindings: readonly Binding[]): TrieNode {
	const root: TrieNode = { children: new Map() };

	for (const binding of bindings) {
		let node = root;
		for (const token of binding.tokens) {
			let child = node.children.get(token);
			if (!child) {
				child = { children: new Map() };
				node.children.set(token, child);
			}
			node = child;
		}
		node.binding = binding;
	}

	return root;
}

function collectBindings(
	ctx: PluginContext,
	leader: string,
	bindings: readonly Keymap[],
): Binding[] {
	const coreBindings: Binding[] = bindings.map((binding) => ({
		lhs: binding.lhs,
		desc: binding.desc,
		tokens: parseKeySequence(binding.lhs, leader),
	}));

	const pluginBindings: Binding[] = ctx.getKeymaps().map((binding: KeymapContribution) => ({
		lhs: binding.lhs,
		desc: binding.desc,
		tokens: parseKeySequence(binding.lhs, leader),
	}));

	return [...coreBindings, ...pluginBindings].filter((binding) => binding.tokens.length > 0);
}

function entriesForPrefix(root: TrieNode, prefix: readonly KeyToken[]): Entry[] {
	let node: TrieNode | undefined = root;
	for (const token of prefix) {
		node = node.children.get(token);
		if (!node) return [];
	}

	const entries: Entry[] = [];
	for (const [key, child] of node.children.entries()) {
		const desc = child.binding?.desc ?? 'prefix';
		entries.push({ key, desc, isPrefix: !child.binding });
	}

	entries.sort((a, b) => a.key.localeCompare(b.key));
	return entries;
}

function createKeyCaps(tokens: readonly KeyToken[]): HTMLElement {
	const container = document.createElement('span');
	container.className = 'hint-whichkey-keys';
	for (const token of tokens) {
		const key = document.createElement('kbd');
		key.textContent = formatKeyTokenForDisplay(token);
		container.appendChild(key);
	}
	return container;
}

class WhichKeyOverlay {
	#root: HTMLDivElement;
	#prefix: HTMLDivElement;
	#list: HTMLDivElement;

	constructor() {
		this.#root = document.createElement('div');
		this.#root.className = 'hint-whichkey';

		const card = document.createElement('div');
		card.className = 'hint-whichkey-card';

		const header = document.createElement('div');
		header.className = 'hint-whichkey-header';

		const title = document.createElement('div');
		title.className = 'hint-whichkey-title';
		title.textContent = 'Prefix';

		this.#prefix = document.createElement('div');
		this.#prefix.className = 'hint-whichkey-prefix';

		header.appendChild(title);
		header.appendChild(this.#prefix);

		this.#list = document.createElement('div');
		this.#list.className = 'hint-whichkey-list';

		card.appendChild(header);
		card.appendChild(this.#list);
		this.#root.appendChild(card);
	}

	update(prefix: readonly KeyToken[], entries: readonly Entry[]): void {
		this.#prefix.replaceChildren(createKeyCaps(prefix));
		this.#list.replaceChildren(
			...entries.map((entry) => {
				const row = document.createElement('div');
				row.className = 'hint-whichkey-row';

				const key = document.createElement('kbd');
				key.className = 'hint-whichkey-key';
				key.textContent = formatKeyTokenForDisplay(entry.key);

				const desc = document.createElement('div');
				desc.className = 'hint-whichkey-desc';
				desc.textContent = entry.desc;
				if (entry.isPrefix) {
					desc.classList.add('is-prefix');
				}

				row.appendChild(key);
				row.appendChild(desc);
				return row;
			}),
		);
	}

	show(): void {
		if (!this.#root.isConnected) {
			const host = document.body ?? document.documentElement;
			host.appendChild(this.#root);
		}
		this.#root.classList.add('is-visible');
	}

	hide(): void {
		this.#root.classList.remove('is-visible');
	}

	destroy(): void {
		this.#root.remove();
	}
}

export const activateContent = (ctx: PluginContext) => {
	if (ctx.context !== 'content') return;

	const fullConfig = ctx.getConfig();
	const pluginConfig = ctx.getPluginConfig();
	const leader = fullConfig.options.leader;
	const overlay = new WhichKeyOverlay();
	const trie = buildTrie(collectBindings(ctx, leader, fullConfig.keymaps));
	const delay = Math.max(0, typeof pluginConfig.delay === 'number' ? pluginConfig.delay : 100);
	const timeout = Math.max(0, fullConfig.options.timeoutlen);
	let showTimer: number | null = null;
	let hideTimer: number | null = null;
	let pending: readonly KeyToken[] | null = null;

	const clearShowTimer = () => {
		if (showTimer !== null) {
			window.clearTimeout(showTimer);
			showTimer = null;
		}
	};

	const clearHideTimer = () => {
		if (hideTimer !== null) {
			window.clearTimeout(hideTimer);
			hideTimer = null;
		}
	};

	const hide = () => {
		clearShowTimer();
		clearHideTimer();
		pending = null;
		overlay.hide();
	};

	const show = () => {
		if (!pending) return;
		if (ctx.hints.isActive()) {
			hide();
			return;
		}
		const entries = entriesForPrefix(trie, pending);
		if (entries.length === 0) {
			hide();
			return;
		}
		overlay.update(pending, entries);
		overlay.show();
	};

	const scheduleHide = () => {
		if (timeout <= 0) return;
		clearHideTimer();
		hideTimer = window.setTimeout(() => {
			hide();
		}, timeout);
	};

	const scheduleShow = (tokens: readonly KeyToken[]) => {
		pending = tokens;
		clearShowTimer();
		if (delay <= 0) {
			show();
		} else {
			showTimer = window.setTimeout(() => {
				show();
			}, delay);
		}
		scheduleHide();
	};

	const onSequence = (event: KeySequenceEvent) => {
		switch (event.status) {
			case 'partial':
				scheduleShow(event.tokens);
				break;
			case 'match':
			case 'none':
				hide();
				break;
		}
	};

	const disposers = [
		ctx.on('key:sequence', onSequence),
		ctx.on('hint:activate', () => hide()),
		ctx.on('hint:deactivate', () => hide()),
	];

	return () => {
		hide();
		for (const dispose of disposers) {
			dispose();
		}
		overlay.destroy();
	};
};
