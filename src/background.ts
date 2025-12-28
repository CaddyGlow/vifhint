// Background script to handle keyboard shortcuts and tab operations

// Handle Chrome keyboard shortcuts
chrome.commands.onCommand.addListener((command) => {
	if (command === 'activate-hints') {
		chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
			if (tabs[0]?.id) {
				chrome.tabs.sendMessage(tabs[0].id, { command: 'activate-hints' });
			}
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
			case 'tab:close':
				if (sender.tab?.id) {
					chrome.tabs.remove(sender.tab.id);
				}
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
