import type { PluginContext } from '../types';
import { manifest } from './manifest';

type WindowListPayload = {
	readonly windows: Array<{
		id: number;
		tabs: Array<{ title: string; url: string }>;
		isPreviousChoice?: boolean;
	}>;
};

type MoveMessage = { type: 'window-mover:move'; windowId: number };
type ListMessage = { type: 'window-mover:list' };
type Message = MoveMessage | ListMessage;

export const activateBackground = (ctx: PluginContext) => {
	if (ctx.context !== 'background') return;

	let previousChoice: number | null = null;

	const handleList = async (sender: chrome.runtime.MessageSender): Promise<WindowListPayload> => {
		const currentWindowId = sender.tab?.windowId ?? null;
		const windows = await chrome.windows.getAll({ populate: true });
		const others = windows
			.filter((w) => w.id !== undefined && w.id !== currentWindowId)
			.map((w) => ({
				id: w.id as number,
				tabs: w.tabs?.map((t) => ({ title: t.title ?? '(untitled)', url: t.url ?? '' })) ?? [],
				isPreviousChoice: previousChoice !== null && w.id === previousChoice,
			}))
			.sort((a, b) => a.id - b.id);

		return { windows: others };
	};

	const handleMove = async (
		sender: chrome.runtime.MessageSender,
		windowId: number,
	): Promise<void> => {
		const tabId = sender.tab?.id;
		if (!tabId) return;

		if (windowId === -1) {
			await chrome.windows.create({ tabId });
			previousChoice = -1;
			return;
		}

		await chrome.tabs.move(tabId, { windowId, index: -1 });
		await chrome.windows.update(windowId, { focused: true });
		await chrome.tabs.update(tabId, { active: true });
		previousChoice = windowId;
	};

	const listener = (
		message: Message,
		sender: chrome.runtime.MessageSender,
		sendResponse: (resp?: unknown) => void,
	) => {
		if (message?.type === 'window-mover:list') {
			void handleList(sender)
				.then((data) => sendResponse(data))
				.catch((error) => {
					ctx.log('Failed to list windows', error);
					sendResponse({ windows: [] });
				});
			return true;
		}

		if (message?.type === 'window-mover:move') {
			void handleMove(sender, message.windowId)
				.then(() => sendResponse({ ok: true }))
				.catch((error) => {
					ctx.log('Failed to move tab', error);
					sendResponse({ ok: false });
				});
			return true;
		}

		return undefined;
	};

	chrome.runtime.onMessage.addListener(listener as never);

	ctx.log(`${manifest.name} activated`);

	return () => {
		chrome.runtime.onMessage.removeListener(listener as never);
	};
};
