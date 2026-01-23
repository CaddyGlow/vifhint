// Background script to handle keyboard shortcuts and tab operations

import { PluginHost } from './plugins/host';
import { pluginRegistry } from './plugins/registry';
import type { UiApi } from './plugins/types';
import {
	clearTemporaryFallbackHosts,
	getGlobalEnabled,
	getSiteDisableState,
	setSiteDisableState,
} from './site-disable';
import { loadConfig, watchConfigChanges } from './user-config';

const ui: UiApi = {
	toast: (message) => {
		console.log(`[plugin toast] ${message}`);
	},
};

let pluginHost: PluginHost | null = null;

const createPluginHost = (config: Awaited<ReturnType<typeof loadConfig>>): PluginHost =>
	new PluginHost({
		context: 'background',
		registry: pluginRegistry,
		ui,
		config,
	});

const actionApi = chrome.action ?? chrome.browserAction;
const ICON_SIZES = [16, 32, 48, 128] as const;
const ICON_PATHS: Record<number, string> = {
	16: 'icons/icon16.png',
	32: 'icons/icon32.png',
	48: 'icons/icon48.png',
	128: 'icons/icon128.png',
};
let disabledIconData: Record<number, ImageData> | null = null;

chrome.runtime.onStartup.addListener(() => {
	void clearTemporaryFallbackHosts();
	void updateAllTabIcons();
});
chrome.runtime.onInstalled.addListener(() => {
	void clearTemporaryFallbackHosts();
	void updateAllTabIcons();
});

void updateAllTabIcons();

const initPluginHost = async (): Promise<void> => {
	const config = await loadConfig();
	if (pluginHost) {
		pluginHost.dispose();
	}
	pluginHost = createPluginHost(config);
	await pluginHost.activateStartup();
	pluginHost.emit('page:ready', undefined);
};

void initPluginHost();
watchConfigChanges((config) => {
	if (pluginHost) {
		pluginHost.dispose();
	}
	pluginHost = createPluginHost(config);
	void pluginHost.activateStartup();
	pluginHost.emit('page:ready', undefined);
});

// Handle Chrome keyboard shortcuts
chrome.commands.onCommand.addListener((command) => {
	if (command === 'activate-hints') {
		chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
			if (tabs[0]?.id) {
				chrome.tabs.sendMessage(tabs[0].id, { command: 'activate-hints' });
			}
		});
	} else if (command === 'toggle-site') {
		chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
			const tab = tabs[0];
			if (!tab) return;
			void toggleSiteState(tab);
		});
	}
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender) => {
	if (message.type === 'tab-operation') {
		const count =
			typeof message.count === 'number' && message.count > 0 ? Math.floor(message.count) : 1;
		switch (message.operation) {
			case 'tab:next':
				navigateTab(1, count);
				break;
			case 'tab:previous':
				navigateTab(-1, count);
				break;
			case 'tab:first':
				void gotoTabByIndex(0);
				break;
			case 'tab:last':
				void gotoTabByIndex(-1);
				break;
			case 'tab:goto-playing':
				void gotoPlayingTab();
				break;
			case 'tab:close':
				if (sender.tab?.id) {
					chrome.tabs.remove(sender.tab.id);
				}
				break;
			case 'tab:close-left':
				void closeTabRelative(-1, sender.tab);
				break;
			case 'tab:close-right':
				void closeTabRelative(1, sender.tab);
				break;
			case 'tab:close-all-left':
				void closeAllTabsOnSide('left', sender.tab);
				break;
			case 'tab:close-all-right':
				void closeAllTabsOnSide('right', sender.tab);
				break;
			case 'tab:close-others':
				void closeOtherTabs(sender.tab);
				break;
			case 'tab:close-playing':
				void closePlayingTab();
				break;
			case 'tab:new':
				for (let i = 0; i < count; i++) {
					chrome.tabs.create({});
				}
				break;
			case 'tab:restore':
				chrome.sessions.restore();
				break;
		}
	} else if (message.type === 'open-url') {
		chrome.tabs.create({
			url: message.url,
			active: !message.background,
		});
	}
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
	void chrome.tabs.get(tabId).then((tab) => updateActionForTab(tab));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	if (changeInfo.status === 'complete' || changeInfo.url) {
		void updateActionForTab(tab);
	}
});

chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName !== 'local' && areaName !== 'session') return;
	const relevant = Boolean(
		changes['hint.globalEnabled'] ||
			changes['hint.disabledHosts'] ||
			changes['hint.disabledHostsSession'],
	);
	if (!relevant) return;
	void updateAllTabIcons();
});

async function navigateTab(direction: 1 | -1, count = 1): Promise<void> {
	const tabs = await chrome.tabs.query({ currentWindow: true });
	const activeTab = tabs.find((t) => t.active);
	if (!activeTab || activeTab.index === undefined) return;

	const step = Math.max(1, count);
	const newIndex = (activeTab.index + direction * step + tabs.length) % tabs.length;
	const targetTab = tabs[newIndex];
	if (targetTab?.id) {
		chrome.tabs.update(targetTab.id, { active: true });
	}
}

async function updateAllTabIcons(): Promise<void> {
	const tabs = await chrome.tabs.query({});
	for (const tab of tabs) {
		await updateActionForTab(tab);
	}
}

async function updateActionForTab(tab: chrome.tabs.Tab): Promise<void> {
	if (!actionApi?.setIcon || !tab.id) return;
	const enabled = await isTabEnabled(tab);
	if (enabled) {
		actionApi.setIcon({ tabId: tab.id, path: ICON_PATHS });
	} else {
		try {
			const imageData = await getDisabledIconData();
			actionApi.setIcon({ tabId: tab.id, imageData });
		} catch {
			actionApi.setIcon({ tabId: tab.id, path: ICON_PATHS });
		}
	}
}

async function isTabEnabled(tab: chrome.tabs.Tab): Promise<boolean> {
	const globalEnabled = await getGlobalEnabled();
	if (!globalEnabled) return false;
	const host = getHostFromUrl(tab.url);
	if (!host) return false;
	const state = await getSiteDisableState(host);
	return state === 'enabled';
}

async function toggleSiteState(tab: chrome.tabs.Tab): Promise<void> {
	if (!tab.id) return;
	const host = getHostFromUrl(tab.url);
	if (!host) return;
	const current = await getSiteDisableState(host);
	const next = current === 'enabled' ? 'permanent' : 'enabled';
	await setSiteDisableState(host, next);
	chrome.tabs.sendMessage(tab.id, { type: 'hint:site-state', host, state: next }, () => {
		void chrome.runtime.lastError;
	});
	await updateActionForTab(tab);
}

function getHostFromUrl(rawUrl?: string): string | null {
	if (!rawUrl) return null;
	try {
		const url = new URL(rawUrl);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		return url.hostname;
	} catch {
		return null;
	}
}

async function getDisabledIconData(): Promise<Record<number, ImageData>> {
	if (disabledIconData) return disabledIconData;
	const data: Record<number, ImageData> = {};
	for (const size of ICON_SIZES) {
		data[size] = await renderDisabledIcon(size);
	}
	disabledIconData = data;
	return data;
}

async function renderDisabledIcon(size: number): Promise<ImageData> {
	const { canvas, ctx } = createIconCanvas(size);
	const source = await loadIconSource(ICON_PATHS[size]);
	ctx.drawImage(source, 0, 0, size, size);

	ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
	ctx.fillRect(0, 0, size, size);

	ctx.lineCap = 'round';
	ctx.strokeStyle = 'rgba(244, 241, 229, 0.9)';
	ctx.lineWidth = Math.max(2, Math.round(size * 0.18));
	ctx.beginPath();
	ctx.moveTo(size * 0.2, size * 0.8);
	ctx.lineTo(size * 0.8, size * 0.2);
	ctx.stroke();

	ctx.strokeStyle = 'rgba(204, 0, 0, 0.9)';
	ctx.lineWidth = Math.max(2, Math.round(size * 0.1));
	ctx.beginPath();
	ctx.moveTo(size * 0.2, size * 0.8);
	ctx.lineTo(size * 0.8, size * 0.2);
	ctx.stroke();

	return ctx.getImageData(0, 0, size, size);
}

function createIconCanvas(size: number): {
	canvas: OffscreenCanvas | HTMLCanvasElement;
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
} {
	if (typeof OffscreenCanvas !== 'undefined') {
		const canvas = new OffscreenCanvas(size, size);
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Failed to create canvas context.');
		return { canvas, ctx };
	}
	if (typeof document !== 'undefined') {
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Failed to create canvas context.');
		return { canvas, ctx };
	}
	throw new Error('Canvas not available.');
}

async function loadIconSource(path: string): Promise<CanvasImageSource> {
	const url = chrome.runtime.getURL(path);
	if (typeof createImageBitmap === 'function') {
		const response = await fetch(url);
		const blob = await response.blob();
		return await createImageBitmap(blob);
	}
	if (typeof Image !== 'undefined') {
		return await new Promise((resolve, reject) => {
			const image = new Image();
			image.onload = () => resolve(image);
			image.onerror = () => reject(new Error(`Failed to load icon: ${path}`));
			image.src = url;
		});
	}
	throw new Error('Image loader not available.');
}

async function gotoTabByIndex(index: number): Promise<void> {
	const tabs = await chrome.tabs.query({ currentWindow: true });
	if (tabs.length === 0) return;
	const targetIndex = index < 0 ? tabs.length + index : index;
	const targetTab = tabs[targetIndex];
	if (targetTab?.id) {
		chrome.tabs.update(targetTab.id, { active: true });
	}
}

async function gotoPlayingTab(): Promise<void> {
	const tabs = await chrome.tabs.query({ audible: true });
	if (tabs.length > 0 && tabs[0].id) {
		chrome.tabs.update(tabs[0].id, { active: true });
	}
}

async function closeTabRelative(direction: -1 | 1, currentTab?: chrome.tabs.Tab): Promise<void> {
	if (!currentTab || currentTab.index === undefined) return;
	const tabs = await chrome.tabs.query({ currentWindow: true });
	const targetIndex = currentTab.index + direction;
	const targetTab = tabs.find((t) => t.index === targetIndex);
	if (targetTab?.id) {
		chrome.tabs.remove(targetTab.id);
	}
}

async function closeAllTabsOnSide(
	side: 'left' | 'right',
	currentTab?: chrome.tabs.Tab,
): Promise<void> {
	if (!currentTab || currentTab.index === undefined) return;
	const tabs = await chrome.tabs.query({ currentWindow: true });
	const tabsToClose = tabs.filter((t) =>
		side === 'left' ? t.index < currentTab.index : t.index > currentTab.index,
	);
	const idsToClose = tabsToClose.map((t) => t.id).filter((id): id is number => id !== undefined);
	if (idsToClose.length > 0) {
		chrome.tabs.remove(idsToClose);
	}
}

async function closeOtherTabs(currentTab?: chrome.tabs.Tab): Promise<void> {
	if (!currentTab?.id) return;
	const tabs = await chrome.tabs.query({ currentWindow: true });
	const idsToClose = tabs
		.filter((t) => t.id !== currentTab.id)
		.map((t) => t.id)
		.filter((id): id is number => id !== undefined);
	if (idsToClose.length > 0) {
		chrome.tabs.remove(idsToClose);
	}
}

async function closePlayingTab(): Promise<void> {
	const tabs = await chrome.tabs.query({ audible: true });
	if (tabs.length > 0 && tabs[0].id) {
		chrome.tabs.remove(tabs[0].id);
	}
}
