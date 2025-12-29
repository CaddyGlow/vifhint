import { type Keymap, appConfig } from './config';
import { formatKeySequenceForDisplay } from './key-notation';

type HelpGroup =
	| 'Help'
	| 'Find'
	| 'Tabs'
	| 'Scroll'
	| 'Hints'
	| 'Focus'
	| 'Motion'
	| 'Caret'
	| 'Selection'
	| 'Other';

const HELP_GROUP_ORDER: readonly HelpGroup[] = [
	'Help',
	'Find',
	'Tabs',
	'Scroll',
	'Hints',
	'Focus',
	'Motion',
	'Caret',
	'Selection',
	'Other',
];

function groupForBinding(binding: Keymap): HelpGroup {
	if (binding.rhs.startsWith('tab:')) return 'Tabs';
	if (binding.rhs.startsWith('scroll:')) return 'Scroll';
	if (binding.rhs.startsWith('hints:')) return 'Hints';
	if (binding.rhs.startsWith('focus:')) return 'Focus';
	if (binding.rhs.startsWith('motion:')) return 'Motion';
	if (binding.rhs.startsWith('textobj:')) return 'Motion';
	if (binding.rhs.startsWith('caret:')) return 'Caret';
	if (binding.rhs.startsWith('selection:')) return 'Selection';
	if (binding.rhs.startsWith('find:')) return 'Find';
	if (binding.rhs.startsWith('search:')) return 'Find';
	if (binding.rhs.startsWith('help:')) return 'Help';
	return 'Other';
}

function createKeyCaps(lhs: string): HTMLElement {
	const container = document.createElement('span');
	container.className = 'hint-help-keys';
	const tokens = formatKeySequenceForDisplay(lhs, appConfig.options.leader);
	for (const token of tokens) {
		const key = document.createElement('kbd');
		key.textContent = token;
		container.appendChild(key);
	}
	return container;
}

export class HelpOverlay {
	#overlay: HTMLDivElement;
	#bindings: Keymap[];

	constructor(bindings: readonly Keymap[]) {
		this.#bindings = [...bindings];
		this.#overlay = this.#buildOverlay();
	}

	setBindings(bindings: readonly Keymap[]): void {
		this.#bindings = [...bindings];
		const wasVisible = this.isVisible();
		if (this.#overlay.isConnected) {
			this.#overlay.remove();
		}
		this.#overlay = this.#buildOverlay();
		if (wasVisible) {
			this.show();
		}
	}

	toggle(): void {
		if (this.isVisible()) {
			this.hide();
		} else {
			this.show();
		}
	}

	show(): void {
		this.#ensureAttached();
		this.#overlay.classList.add('is-visible');
	}

	hide(): void {
		this.#overlay.classList.remove('is-visible');
	}

	isVisible(): boolean {
		return this.#overlay.classList.contains('is-visible');
	}

	#ensureAttached(): void {
		if (this.#overlay.isConnected) return;
		const host = document.body ?? document.documentElement;
		host.appendChild(this.#overlay);
	}

	#buildOverlay(): HTMLDivElement {
		const overlay = document.createElement('div');
		overlay.className = 'hint-help-overlay';
		overlay.setAttribute('role', 'dialog');
		overlay.setAttribute('aria-modal', 'true');
		overlay.setAttribute('aria-label', 'Keymaps');

		const card = document.createElement('div');
		card.className = 'hint-help-card';

		const header = document.createElement('div');
		header.className = 'hint-help-header';

		const title = document.createElement('div');
		title.className = 'hint-help-title';
		title.textContent = 'Keymaps';

		const subtitle = document.createElement('div');
		subtitle.className = 'hint-help-subtitle';
		subtitle.textContent = 'Press ? or <Esc> to close';

		header.appendChild(title);
		header.appendChild(subtitle);
		card.appendChild(header);

		const sectionsContainer = document.createElement('div');
		sectionsContainer.className = 'hint-help-sections';

		const grouped = new Map<HelpGroup, Keymap[]>();
		for (const binding of this.#bindings) {
			const group = groupForBinding(binding);
			const list = grouped.get(group);
			if (list) {
				list.push(binding);
			} else {
				grouped.set(group, [binding]);
			}
		}

		for (const group of HELP_GROUP_ORDER) {
			const bindings = grouped.get(group);
			if (!bindings || bindings.length === 0) continue;

			const section = document.createElement('section');
			section.className = 'hint-help-section';

			const heading = document.createElement('h2');
			heading.className = 'hint-help-section-title';
			heading.textContent = group;

			const list = document.createElement('div');
			list.className = 'hint-help-list';

			for (const binding of bindings) {
				const row = document.createElement('div');
				row.className = 'hint-help-row';

				const desc = document.createElement('div');
				desc.className = 'hint-help-desc';
				desc.textContent = binding.desc;

				row.appendChild(createKeyCaps(binding.lhs));
				row.appendChild(desc);
				list.appendChild(row);
			}

			section.appendChild(heading);
			section.appendChild(list);
			sectionsContainer.appendChild(section);
		}

		card.appendChild(sectionsContainer);

		if (this.#bindings.some((binding) => binding.repeatable)) {
			const footer = document.createElement('div');
			footer.className = 'hint-help-footer';
			footer.textContent = 'Repeatable commands accept counts (e.g., 3d).';
			card.appendChild(footer);
		}

		overlay.addEventListener('click', (event) => {
			if (event.target === overlay) {
				this.hide();
			}
		});

		overlay.appendChild(card);
		return overlay;
	}
}
