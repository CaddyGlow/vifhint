import type { AppConfig, CommandId } from '../config';
import type { KeyToken } from '../key-notation';
import type { HintMode } from '../types';

export type CoreContext = 'content' | 'background';

export type ActivationEvent =
	| { type: 'onStartup' }
	| { type: 'onCommand'; command: string }
	| { type: 'onKey'; key: string; when?: string }
	| { type: 'onHost'; host: string }
	| { type: 'onUrl'; match: string }
	| { type: 'onHintMode'; mode: HintMode };

export type OptionsSchema = {
	[id: string]: { type: 'string' | 'number' | 'boolean'; default: unknown };
};

export type KeymapContribution = {
	lhs: string;
	rhs: CommandId;
	desc: string;
	repeatable?: boolean;
	modes?: Array<'normal'>;
	when?: string;
};

export type CommandContribution = {
	id: CommandId;
	title: string;
	group?: string;
};

export type HelpSection = {
	id: string;
	title: string;
	entries: Array<{ lhs: string; desc: string }>;
};

export type ContentBehavior = {
	id: string;
	description?: string;
};

export type BackgroundBehavior = {
	id: string;
	description?: string;
};

export type PluginContributions = {
	keymaps?: KeymapContribution[];
	commands?: CommandContribution[];
	options?: OptionsSchema;
	helpSections?: HelpSection[];
	contentScripts?: ContentBehavior[];
	backgroundTasks?: BackgroundBehavior[];
};

export type PluginManifest = {
	id: string;
	name: string;
	version: string;
	description?: string;
	author?: string;
	license?: string;
	minCoreVersion?: string;
	contexts: Array<CoreContext>;
	activation: ActivationEvent[];
	contributes?: PluginContributions;
	dependencies?: string[];
};

export type CommandArgs = {
	count: number;
	hasCount: boolean;
};

export type CommandHandler = (args: CommandArgs) => void | Promise<void>;

export type PluginDispose = () => void;
export type PluginEntry = (ctx: PluginContext) => undefined | PluginDispose;

export type PluginModule = {
	activateContent?: PluginEntry;
	activateBackground?: PluginEntry;
};

export type PluginDefinition = {
	manifest: PluginManifest;
	load: {
		content?: () => Promise<PluginModule>;
		background?: () => Promise<PluginModule>;
	};
};

export type StorageApi = {
	get<T>(key: string, fallback?: T): Promise<T | undefined>;
	set<T>(key: string, value: T): Promise<void>;
	remove(key: string): Promise<void>;
};

export type UiApi = {
	toast(message: string, options?: { duration?: number }): void;
};

export type HintsApi = {
	isActive(): boolean;
	activate(mode?: HintMode): void;
};

export type SelectionApi = {
	expand(): void;
	shrink(): void;
	toggle(): void;
	toggleLinewise(): void;
	yank(): void;
	moveWord(direction: 'forward' | 'backward', count?: number): void;
	moveWordEnd(count?: number): void;
	moveBigWord(direction: 'forward' | 'backward', count?: number): void;
	moveLine(boundary: 'start' | 'first' | 'end', count?: number): void;
	moveParagraph(direction: 'prev' | 'next', count?: number): void;
	selectTextObject(kind: 'word' | 'paragraph', around: boolean): void;
	moveCaret(direction: 'left' | 'right' | 'up' | 'down', count?: number): void;
	scrollAndFollow(deltaY: number): void;
	swapSelectionEndpoint(): void;
	getWordUnderCaret(): string | null;
};

export type SearchApi = {
	open(): void;
	next(count?: number): void;
	prev(count?: number): void;
	searchWord(query: string, direction: 'next' | 'prev', count?: number): void;
	isActive(): boolean;
	close(): void;
	clearHighlights(): void;
};

export type KeySequenceEvent =
	| { status: 'match'; sequence: string; tokens: readonly KeyToken[] }
	| { status: 'partial'; tokens: readonly KeyToken[] }
	| { status: 'none' };

export type CoreEventMap = {
	'page:ready': undefined;
	'hint:activate': { mode: HintMode };
	'hint:deactivate': undefined;
	'search:open': undefined;
	'search:close': undefined;
	'key:sequence': KeySequenceEvent;
};

export type CoreEvent = keyof CoreEventMap;

export type EventHandler<K extends CoreEvent = CoreEvent> = (payload: CoreEventMap[K]) => void;

export type PluginContextBase = {
	coreVersion: string;
	context: CoreContext;
	registerCommand(id: string, handler: CommandHandler): void;
	registerKeymap(map: KeymapContribution): void;
	on<K extends CoreEvent>(event: K, handler: (payload: CoreEventMap[K]) => void): PluginDispose;
	getKeymaps(): KeymapContribution[];
	getOption<T>(key: string, fallback: T): T;
	setOption<T>(key: string, value: T): void;
	getConfig(): AppConfig;
	getPluginConfig(): Record<string, unknown>;
	storage: StorageApi;
	ui: UiApi;
	log(message: string, data?: unknown): void;
};

export type ContentPluginContext = PluginContextBase & {
	context: 'content';
	hints: HintsApi;
	selection: SelectionApi;
	search: SearchApi;
};

export type BackgroundPluginContext = PluginContextBase & {
	context: 'background';
};

export type PluginContext = ContentPluginContext | BackgroundPluginContext;
