import { appConfig } from '../config';
import type { HintMode } from '../types';
import type {
	CommandArgs,
	CommandHandler,
	CoreContext,
	CoreEvent,
	CoreEventMap,
	EventHandler,
	HintsApi,
	KeymapContribution,
	PluginContext,
	PluginContextBase,
	PluginDefinition,
	PluginDispose,
	PluginEntry,
	PluginManifest,
	PluginModule,
	SearchApi,
	SelectionApi,
	StorageApi,
	UiApi,
} from './types';

const CORE_VERSION = '1.0.0';

type PluginState = {
	manifest: PluginManifest;
	load?: () => Promise<PluginModule>;
	activated: boolean;
	loading?: Promise<void>;
	dispose?: PluginDispose;
	enabled: boolean;
};

type ActivationIndex = {
	onStartup: Set<string>;
	onCommand: Map<string, Set<string>>;
	onKey: Map<string, Set<string>>;
	onHintMode: Map<HintMode, Set<string>>;
	onHost: Array<{ pluginId: string; host: string }>;
	onUrl: Array<{ pluginId: string; match: string }>;
};

export type PluginHostOptions = {
	context: CoreContext;
	registry: readonly PluginDefinition[];
	ui: UiApi;
	registerKeymap?: (map: KeymapContribution) => void;
	hints?: HintsApi;
	selection?: SelectionApi;
	search?: SearchApi;
	log?: (message: string, data?: unknown) => void;
};

export class PluginHost {
	#context: CoreContext;
	#states = new Map<string, PluginState>();
	#commands = new Map<string, CommandHandler>();
	#commandOwners = new Map<string, string>();
	#keymaps: KeymapContribution[] = [];
	#activation: ActivationIndex = {
		onStartup: new Set(),
		onCommand: new Map(),
		onKey: new Map(),
		onHintMode: new Map(),
		onHost: [],
		onUrl: [],
	};
	#eventHandlers = new Map<CoreEvent, Set<EventHandler>>();
	#pendingKeymaps: KeymapContribution[] = [];
	#registerKeymap?: (map: KeymapContribution) => void;
	#ui: UiApi;
	#hints?: HintsApi;
	#selection?: SelectionApi;
	#search?: SearchApi;
	#log: (message: string, data?: unknown) => void;
	#runtimeOptions = new Map<string, Map<string, unknown>>();

	constructor(options: PluginHostOptions) {
		this.#context = options.context;
		this.#registerKeymap = options.registerKeymap;
		this.#ui = options.ui;
		this.#hints = options.hints;
		this.#selection = options.selection;
		this.#search = options.search;
		this.#log = options.log ?? ((message, data) => console.debug(message, data));
		this.#initRegistry(options.registry);
	}

	setKeymapRegistrar(registerKeymap: (map: KeymapContribution) => void): void {
		this.#registerKeymap = registerKeymap;
		for (const pending of this.#pendingKeymaps) {
			this.#registerKeymap(pending);
		}
		this.#pendingKeymaps = [];
	}

	getKeymaps(): KeymapContribution[] {
		return [...this.#keymaps];
	}

	hasCommand(command: string): boolean {
		return (
			this.#commandOwners.has(command) ||
			this.#commands.has(command) ||
			this.#activation.onCommand.has(command)
		);
	}

	on<K extends CoreEvent>(event: K, handler: (payload: CoreEventMap[K]) => void): PluginDispose {
		const list = this.#eventHandlers.get(event) ?? new Set<EventHandler>();
		list.add(handler as EventHandler);
		this.#eventHandlers.set(event, list);
		return () => {
			const handlers = this.#eventHandlers.get(event);
			if (!handlers) return;
			handlers.delete(handler as EventHandler);
		};
	}

	emit<K extends CoreEvent>(event: K, payload: CoreEventMap[K]): void {
		const handlers = this.#eventHandlers.get(event);
		if (handlers) {
			for (const handler of handlers) {
				try {
					handler(payload);
				} catch (error) {
					this.#log('[plugin] event handler failed', error);
				}
			}
		}

		if (event === 'hint:activate') {
			const data = payload as CoreEventMap['hint:activate'];
			void this.#activateByHintMode(data.mode);
		}

		if (event === 'key:sequence') {
			const data = payload as CoreEventMap['key:sequence'];
			if (data.status === 'match') {
				void this.#activateByKey(data.sequence);
			}
		}
	}

	async activateStartup(context?: { url?: string; host?: string }): Promise<void> {
		const targets = new Set(this.#activation.onStartup);
		if (context?.host) {
			for (const entry of this.#activation.onHost) {
				if (hostMatches(entry.host, context.host)) {
					targets.add(entry.pluginId);
				}
			}
		}
		if (context?.url) {
			for (const entry of this.#activation.onUrl) {
				if (urlMatches(entry.match, context.url)) {
					targets.add(entry.pluginId);
				}
			}
		}
		await this.#activateAll(Array.from(targets));
	}

	async executeCommand(command: string, args: CommandArgs): Promise<void> {
		const handler = this.#commands.get(command);
		if (handler) {
			await handler(args);
			return;
		}

		const owner = this.#commandOwners.get(command);
		if (owner) {
			await this.activatePlugin(owner);
			const loadedHandler = this.#commands.get(command);
			if (loadedHandler) {
				await loadedHandler(args);
				return;
			}
		}

		await this.#activateByCommand(command);
		const postHandler = this.#commands.get(command);
		if (postHandler) {
			await postHandler(args);
		}
	}

	registerCommand(command: string, handler: CommandHandler): void {
		this.#commands.set(command, handler);
	}

	registerKeymap(map: KeymapContribution): void {
		this.#keymaps.push(map);
		if (this.#registerKeymap) {
			this.#registerKeymap(map);
		} else {
			this.#pendingKeymaps.push(map);
		}
	}

	dispose(): void {
		for (const state of this.#states.values()) {
			if (state.dispose) {
				try {
					state.dispose();
				} catch (error) {
					this.#log('[plugin] dispose failed', error);
				}
			}
			state.dispose = undefined;
			state.activated = false;
			state.loading = undefined;
		}
		this.#eventHandlers.clear();
		this.#commands.clear();
		this.#commandOwners.clear();
		this.#keymaps = [];
		this.#pendingKeymaps = [];
	}

	async activatePlugin(pluginId: string): Promise<void> {
		const state = this.#states.get(pluginId);
		if (!state || !state.enabled) return;
		if (state.activated) return;
		if (state.loading) return state.loading;

		state.loading = this.#activatePluginInternal(pluginId, state);
		try {
			await state.loading;
		} finally {
			state.loading = undefined;
		}
	}

	#initRegistry(registry: readonly PluginDefinition[]): void {
		for (const definition of registry) {
			const manifest = definition.manifest;
			if (!manifest.contexts.includes(this.#context)) continue;

			const configEntry = appConfig.plugins?.[manifest.id];
			const enabled = configEntry?.enabled !== false;
			const load = definition.load[this.#context];

			this.#states.set(manifest.id, {
				manifest,
				load,
				enabled,
				activated: false,
			});

			if (!enabled) continue;

			const contributions = manifest.contributes;
			if (contributions?.commands) {
				for (const command of contributions.commands) {
					this.#commandOwners.set(command.id, manifest.id);
				}
			}

			if (contributions?.keymaps) {
				this.#keymaps.push(...contributions.keymaps);
			}

			for (const activation of manifest.activation) {
				this.#indexActivation(manifest.id, activation);
			}
		}
	}

	#indexActivation(pluginId: string, activation: PluginManifest['activation'][number]): void {
		switch (activation.type) {
			case 'onStartup':
				this.#activation.onStartup.add(pluginId);
				break;
			case 'onCommand':
				this.#addActivationEntry(this.#activation.onCommand, activation.command, pluginId);
				break;
			case 'onKey':
				this.#addActivationEntry(this.#activation.onKey, activation.key, pluginId);
				break;
			case 'onHintMode':
				this.#addActivationEntry(this.#activation.onHintMode, activation.mode, pluginId);
				break;
			case 'onHost':
				this.#activation.onHost.push({ pluginId, host: activation.host });
				break;
			case 'onUrl':
				this.#activation.onUrl.push({ pluginId, match: activation.match });
				break;
		}
	}

	#addActivationEntry<K>(map: Map<K, Set<string>>, key: K, pluginId: string): void {
		const list = map.get(key);
		if (list) {
			list.add(pluginId);
			return;
		}
		map.set(key, new Set([pluginId]));
	}

	async #activateByCommand(command: string): Promise<void> {
		const targets = this.#activation.onCommand.get(command);
		if (!targets) return;
		await this.#activateAll(Array.from(targets));
	}

	async #activateByKey(key: string): Promise<void> {
		const targets = this.#activation.onKey.get(key);
		if (!targets) return;
		await this.#activateAll(Array.from(targets));
	}

	async #activateByHintMode(mode: HintMode): Promise<void> {
		const targets = this.#activation.onHintMode.get(mode);
		if (!targets) return;
		await this.#activateAll(Array.from(targets));
	}

	async #activateAll(pluginIds: string[]): Promise<void> {
		for (const pluginId of pluginIds) {
			await this.activatePlugin(pluginId);
		}
	}

	async #activatePluginInternal(pluginId: string, state: PluginState): Promise<void> {
		if (state.manifest.dependencies) {
			for (const dependency of state.manifest.dependencies) {
				await this.activatePlugin(dependency);
			}
		}

		if (!state.load) {
			this.#log(`[plugin] No entrypoint for ${pluginId} in ${this.#context} context.`);
			state.activated = true;
			return;
		}

		try {
			const module = await state.load();
			const entry =
				this.#context === 'content' ? module.activateContent : module.activateBackground;
			if (!entry) {
				this.#log(`[plugin] Missing activate entry for ${pluginId}.`);
				state.activated = true;
				return;
			}
			const disposer = entry(this.#createContext(pluginId));
			state.dispose = typeof disposer === 'function' ? disposer : undefined;
			state.activated = true;
		} catch (error) {
			this.#log(`[plugin] Failed to activate ${pluginId}`, error);
		}
	}

	#createContext(pluginId: string): PluginContext {
		const base: PluginContextBase = {
			coreVersion: CORE_VERSION,
			context: this.#context,
			registerCommand: (id: string, handler: CommandHandler) => {
				this.registerCommand(id, handler);
			},
			registerKeymap: (map: KeymapContribution) => {
				this.registerKeymap(map);
			},
			on: <K extends CoreEvent>(event: K, handler: (payload: CoreEventMap[K]) => void) =>
				this.on(event, handler),
			getKeymaps: () => this.getKeymaps(),
			getOption: <T>(key: string, fallback: T): T => this.#getOption(pluginId, key, fallback),
			setOption: <T>(key: string, value: T): void => this.#setOption(pluginId, key, value),
			getConfig: () => this.#getConfig(pluginId),
			getPluginConfig: () => this.#getPluginConfig(pluginId),
			storage: this.#storageApi(),
			ui: this.#ui,
			log: (message: string, data?: unknown) => this.#log(`[plugin:${pluginId}] ${message}`, data),
		};

		if (this.#context === 'content') {
			return {
				...base,
				context: 'content',
				hints: this.#hints ?? {
					isActive: () => false,
					activate: () => {},
				},
				selection: this.#selection ?? {
					expand: () => {},
					shrink: () => {},
					toggle: () => {},
					toggleLinewise: () => {},
					yank: () => {},
					moveWord: () => {},
					moveWordEnd: () => {},
					moveBigWord: () => {},
					moveLine: () => {},
					moveParagraph: () => {},
					selectTextObject: () => {},
					moveCaret: () => {},
					scrollAndFollow: () => {},
					swapSelectionEndpoint: () => {},
					getWordUnderCaret: () => null,
				},
				search: this.#search ?? {
					open: () => {},
					next: () => {},
					prev: () => {},
					searchWord: () => {},
					isActive: () => false,
					close: () => {},
					clearHighlights: () => {},
				},
			};
		}

		return {
			...base,
			context: 'background',
		};
	}

	#storageApi(): StorageApi {
		return {
			get: async <T>(key: string, fallback?: T): Promise<T | undefined> => {
				const result = await chrome.storage.local.get(key);
				if (Object.prototype.hasOwnProperty.call(result, key)) {
					return result[key] as T;
				}
				return fallback;
			},
			set: async <T>(key: string, value: T): Promise<void> => {
				await chrome.storage.local.set({ [key]: value });
			},
			remove: async (key: string): Promise<void> => {
				await chrome.storage.local.remove(key);
			},
		};
	}

	#getOption<T>(pluginId: string, key: string, fallback: T): T {
		const overrides = this.#runtimeOptions.get(pluginId);
		if (overrides?.has(key)) {
			return overrides.get(key) as T;
		}
		const configEntry = appConfig.plugins?.[pluginId];
		const optionValue = configEntry?.config?.[key] ?? configEntry?.options?.[key];
		if (optionValue !== undefined) {
			return optionValue as T;
		}
		return fallback;
	}

	#setOption<T>(pluginId: string, key: string, value: T): void {
		let overrides = this.#runtimeOptions.get(pluginId);
		if (!overrides) {
			overrides = new Map();
			this.#runtimeOptions.set(pluginId, overrides);
		}
		overrides.set(key, value);
	}

	#getConfig(pluginId: string): typeof appConfig {
		const configEntry = appConfig.plugins?.[pluginId];
		const overrides = this.#runtimeOptions.get(pluginId);
		if (!configEntry && !overrides) return appConfig;

		const mergedPluginConfig = this.#getPluginConfig(pluginId);

		const plugins = {
			...(appConfig.plugins ?? {}),
			[pluginId]: {
				...configEntry,
				config: mergedPluginConfig,
			},
		};

		return {
			...appConfig,
			plugins,
		};
	}

	#getPluginConfig(pluginId: string): Record<string, unknown> {
		const configEntry = appConfig.plugins?.[pluginId];
		const basePluginConfig = (configEntry?.config ?? configEntry?.options ?? {}) as Record<
			string,
			unknown
		>;
		const overrides = this.#runtimeOptions.get(pluginId);
		if (!overrides) return { ...basePluginConfig };
		const merged: Record<string, unknown> = { ...basePluginConfig };
		for (const [key, value] of overrides) {
			merged[key] = value;
		}
		return merged;
	}
}

function hostMatches(pattern: string, host: string): boolean {
	if (pattern.startsWith('*.')) {
		const suffix = pattern.slice(2);
		return host === suffix || host.endsWith(`.${suffix}`);
	}
	return host === pattern;
}

function urlMatches(match: string, url: string): boolean {
	if (!match) return false;
	if (match.includes('*')) {
		const escaped = match.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&');
		const regex = new RegExp(`^${escaped.replace(/\\\*/g, '.*')}$`);
		return regex.test(url);
	}
	return url.includes(match);
}
