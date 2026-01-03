export type FakeArea = {
	readonly area: chrome.storage.StorageArea;
	readonly store: Map<string, unknown>;
};

export type ChromeContext = {
	readonly local: FakeArea;
	readonly session?: FakeArea;
};

function createStorageArea(): FakeArea {
	const store = new Map<string, unknown>();
	const area: chrome.storage.StorageArea = {
		async get(keys?: string | string[] | object | null): Promise<Record<string, unknown>> {
			if (keys === undefined || keys === null) return Object.fromEntries(store.entries());
			if (typeof keys === 'string') return { [keys]: store.get(keys) };
			if (Array.isArray(keys)) {
				const result: Record<string, unknown> = {};
				for (const key of keys) result[key] = store.get(key);
				return result;
			}
			return keys as Record<string, unknown>;
		},
		async set(items: Record<string, unknown>): Promise<void> {
			for (const [key, value] of Object.entries(items)) store.set(key, value);
		},
		async remove(keys: string | string[]): Promise<void> {
			const list = Array.isArray(keys) ? keys : [keys];
			for (const key of list) store.delete(key);
		},
	} as chrome.storage.StorageArea;

	return { area, store };
}

export function installMockChrome(options: { withSession?: boolean } = {}): ChromeContext {
	const local = createStorageArea();
	const session = options.withSession ? createStorageArea() : undefined;

	(globalThis as unknown as { chrome?: unknown }).chrome = {
		storage: {
			local: local.area,
			...(session ? { session: session.area } : {}),
		},
		runtime: {
			onMessage: { addListener: () => {}, removeListener: () => {} },
			sendMessage: () => {},
		},
	} as unknown as chrome.Chrome;

	(globalThis as { location?: Location }).location = { protocol: 'chrome-extension:' } as Location;

	return { local, session };
}
