import { type Keymap, appConfig } from './config';
import { setupNoAutofocus } from './content-dom';
import { CustomFindController, NativeFindController } from './content-find';
import { HelpOverlay } from './content-help-overlay';
import { LinkHints } from './content-link-hints';
import { IncrementalSelection } from './content-selection';
import { KeyBindings } from './keybindings';
import { PluginHost } from './plugins/host';
import { pluginRegistry } from './plugins/registry';
import type { KeymapContribution, UiApi } from './plugins/types';
import type { HintMode } from './types';

type CommandExecutor = {
	isRegistered(command: string): boolean;
	execute(command: string, count: number, hasCount: boolean): void | Promise<void>;
};

function getActiveBindings(useNativeFind: boolean, bindings: readonly Keymap[]): readonly Keymap[] {
	return bindings.filter((binding) => {
		if (useNativeFind && (binding.rhs === 'find:next' || binding.rhs === 'find:prev')) {
			return false;
		}
		return true;
	});
}

function normalizeKeymapContribution(binding: KeymapContribution): Keymap {
	return {
		lhs: binding.lhs,
		rhs: binding.rhs,
		desc: binding.desc,
		repeatable: binding.repeatable ?? false,
	};
}

function createUi(): UiApi {
	let container: HTMLDivElement | null = null;

	const ensureContainer = (): HTMLDivElement => {
		if (container?.isConnected) return container;
		container = document.createElement('div');
		container.className = 'hint-plugin-toast-host';
		container.style.position = 'fixed';
		container.style.bottom = '16px';
		container.style.right = '16px';
		container.style.display = 'flex';
		container.style.flexDirection = 'column';
		container.style.gap = '8px';
		container.style.zIndex = '2147483647';
		document.body.appendChild(container);
		return container;
	};

	return {
		toast: (message, options = {}) => {
			const host = ensureContainer();
			const toast = document.createElement('div');
			toast.textContent = message;
			toast.style.background = 'rgba(20, 20, 20, 0.9)';
			toast.style.color = '#fff';
			toast.style.padding = '8px 12px';
			toast.style.borderRadius = '6px';
			toast.style.fontSize = '12px';
			toast.style.fontFamily = 'ui-sans-serif, system-ui, -apple-system, sans-serif';
			toast.style.boxShadow = '0 6px 18px rgba(0, 0, 0, 0.2)';
			host.appendChild(toast);

			const duration = Math.max(1000, options.duration ?? 2000);
			window.setTimeout(() => {
				toast.remove();
				if (host.childElementCount === 0) {
					host.remove();
					if (container === host) container = null;
				}
			}, duration);
		},
	};
}

setupNoAutofocus();
const ui = createUi();
let pluginHost: PluginHost | null = null;
const linkHints = new LinkHints({
	onActivate: (mode: HintMode) => pluginHost?.emit('hint:activate', { mode }),
	onDeactivate: () => pluginHost?.emit('hint:deactivate', undefined),
});
const incrementalSelection = new IncrementalSelection();
const useNativeFind = appConfig.options.findmode === 'native';
const searchController = useNativeFind
	? new NativeFindController({
			onOpen: () => pluginHost?.emit('search:open', undefined),
			onClose: () => pluginHost?.emit('search:close', undefined),
		})
	: new CustomFindController({
			onOpen: () => pluginHost?.emit('search:open', undefined),
			onClose: () => pluginHost?.emit('search:close', undefined),
		});

pluginHost = new PluginHost({
	context: 'content',
	registry: pluginRegistry,
	ui,
	hints: {
		isActive: () => linkHints.isActive(),
		activate: (mode?: HintMode) => linkHints.activate(mode),
	},
	selection: incrementalSelection,
	search: searchController,
});

const pluginKeymaps = pluginHost.getKeymaps().map(normalizeKeymapContribution);
const activeBindings = getActiveBindings(useNativeFind, [...appConfig.keymaps, ...pluginKeymaps]);
const helpOverlay = new HelpOverlay(activeBindings);

const commandExecutor: CommandExecutor = {
	isRegistered: (command) => pluginHost?.hasCommand(command) ?? false,
	execute: (command, count, hasCount) =>
		pluginHost ? pluginHost.executeCommand(command, { count, hasCount }) : undefined,
};

const keyBindings = new KeyBindings(
	linkHints,
	incrementalSelection,
	searchController,
	helpOverlay,
	activeBindings,
	{
		commandExecutor,
		onKeySequence: (event) => pluginHost?.emit('key:sequence', event),
	},
);

pluginHost.setKeymapRegistrar((map) => {
	const normalized = normalizeKeymapContribution(map);
	if (useNativeFind && (normalized.rhs === 'find:next' || normalized.rhs === 'find:prev')) {
		return;
	}
	keyBindings.registerKeymap(normalized);
	helpOverlay.setBindings(keyBindings.getBindings());
});

void pluginHost.activateStartup({ url: window.location.href, host: window.location.host });
pluginHost.emit('page:ready', undefined);
