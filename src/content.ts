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
import { type SiteDisableState, getGlobalEnabled, getSiteDisableState } from './site-disable';
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
		document.body.appendChild(container);
		return container;
	};

	return {
		toast: (message, options = {}) => {
			const host = ensureContainer();
			const toast = document.createElement('div');
			toast.className = 'hint-plugin-toast';
			toast.textContent = message;
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

type Runtime = {
	dispose(): void;
};

function createRuntime(): Runtime {
	let extensionEnabled = true;

	const isEnabled = (): boolean => extensionEnabled;

	setupNoAutofocus();
	document.documentElement.dataset.hintColorsheme = appConfig.options.colorsheme;

	const ui = createUi();
	let pluginHost: PluginHost | null = null;
	const linkHints = new LinkHints({
		onActivate: (mode: HintMode) => pluginHost?.emit('hint:activate', { mode }),
		onDeactivate: () => pluginHost?.emit('hint:deactivate', undefined),
		isEnabled,
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
			isEnabled,
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

	const dispose = (): void => {
		extensionEnabled = false;
		linkHints.deactivate();
		searchController.close();
		searchController.clearHighlights();
		helpOverlay.hide();
		keyBindings.dispose();
		linkHints.dispose();
		incrementalSelection.dispose();
		helpOverlay.dispose();
		searchController.dispose();
		pluginHost?.dispose();
		delete document.documentElement.dataset.hintColorsheme;
	};

	return { dispose };
}

void (async () => {
	const host = window.location.hostname;
	let runtime: Runtime | null = null;
	let globalEnabled = true;
	let siteState: SiteDisableState = 'enabled';

	const ensureRuntime = (): Runtime => {
		if (!runtime) runtime = createRuntime();
		return runtime;
	};

	const updateRuntime = (): void => {
		const shouldEnable = globalEnabled && siteState === 'enabled';
		if (shouldEnable) {
			ensureRuntime();
		} else if (runtime) {
			runtime.dispose();
			runtime = null;
		}
	};

	const [initialGlobal, initialSite] = await Promise.all([
		getGlobalEnabled(),
		getSiteDisableState(host),
	]);
	globalEnabled = initialGlobal;
	siteState = initialSite;
	updateRuntime();

	chrome.runtime.onMessage.addListener((message) => {
		if (!message || typeof message !== 'object') return;
		if (message.type === 'hint:site-state') {
			if (typeof message.host === 'string' && message.host !== host) return;
			if (
				message.state === 'enabled' ||
				message.state === 'temporary' ||
				message.state === 'permanent'
			) {
				siteState = message.state;
				updateRuntime();
			}
			return;
		}
		if (message.type === 'hint:global-state') {
			if (typeof message.enabled !== 'boolean') return;
			globalEnabled = message.enabled;
			updateRuntime();
		}
	});
})();
