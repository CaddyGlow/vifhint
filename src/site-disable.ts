export type SiteDisableState = 'enabled' | 'temporary' | 'permanent';

const PERMANENT_KEY = 'hint.disabledHosts';
const TEMPORARY_KEY = 'hint.disabledHostsSession';

type StorageArea = chrome.storage.StorageArea;

type StorageSessionShim = {
	readonly session?: StorageArea;
};

function getSessionStorage(): StorageArea | null {
	const storage = chrome.storage as unknown as StorageSessionShim;
	return storage.session ?? null;
}

function getTemporaryStorage(): { area: StorageArea; fallback: boolean } {
	const session = getSessionStorage();
	if (session) return { area: session, fallback: false };
	return { area: chrome.storage.local, fallback: true };
}

function normalizeHost(host: string): string {
	return host.trim().toLowerCase();
}

function toHostList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const entries: string[] = [];
	for (const item of value) {
		if (typeof item !== 'string') continue;
		const normalized = normalizeHost(item);
		if (normalized) entries.push(normalized);
	}
	return entries;
}

function uniqueHosts(list: string[]): string[] {
	return Array.from(new Set(list.map((host) => normalizeHost(host)).filter(Boolean))).sort();
}

async function readHosts(area: StorageArea, key: string): Promise<string[]> {
	const result = await area.get(key);
	return toHostList(result[key]);
}

async function writeHosts(area: StorageArea, key: string, hosts: string[]): Promise<void> {
	await area.set({ [key]: uniqueHosts(hosts) });
}

export function isTemporaryFallbackStorage(): boolean {
	return getTemporaryStorage().fallback;
}

export async function clearTemporaryFallbackHosts(): Promise<void> {
	const { area, fallback } = getTemporaryStorage();
	if (!fallback) return;
	await area.remove(TEMPORARY_KEY);
}

export async function getSiteDisableState(host: string): Promise<SiteDisableState> {
	const normalized = normalizeHost(host);
	if (!normalized) return 'enabled';

	const { area: tempArea } = getTemporaryStorage();
	const [permanent, temporary] = await Promise.all([
		readHosts(chrome.storage.local, PERMANENT_KEY),
		readHosts(tempArea, TEMPORARY_KEY),
	]);

	if (permanent.includes(normalized)) return 'permanent';
	if (temporary.includes(normalized)) return 'temporary';
	return 'enabled';
}

export async function setSiteDisableState(host: string, state: SiteDisableState): Promise<void> {
	const normalized = normalizeHost(host);
	if (!normalized) return;

	const { area: tempArea } = getTemporaryStorage();
	const [permanent, temporary] = await Promise.all([
		readHosts(chrome.storage.local, PERMANENT_KEY),
		readHosts(tempArea, TEMPORARY_KEY),
	]);

	const nextPermanent = new Set(permanent);
	const nextTemporary = new Set(temporary);

	nextPermanent.delete(normalized);
	nextTemporary.delete(normalized);

	if (state === 'permanent') {
		nextPermanent.add(normalized);
	} else if (state === 'temporary') {
		nextTemporary.add(normalized);
	}

	await Promise.all([
		writeHosts(chrome.storage.local, PERMANENT_KEY, Array.from(nextPermanent)),
		writeHosts(tempArea, TEMPORARY_KEY, Array.from(nextTemporary)),
	]);
}
