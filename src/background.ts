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
    switch (message.operation) {
      case 'tab:next':
        navigateTab(1);
        break;
      case 'tab:previous':
        navigateTab(-1);
        break;
      case 'tab:close':
        if (sender.tab?.id) {
          chrome.tabs.remove(sender.tab.id);
        }
        break;
      case 'tab:new':
        chrome.tabs.create({});
        break;
      case 'tab:restore':
        chrome.sessions.restore();
        break;
    }
  } else if (message.type === 'open-url') {
    chrome.tabs.create({
      url: message.url,
      active: !message.background
    });
  }
});

async function navigateTab(direction: 1 | -1): Promise<void> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const activeTab = tabs.find(t => t.active);
  if (!activeTab || activeTab.index === undefined) return;

  const newIndex = (activeTab.index + direction + tabs.length) % tabs.length;
  const targetTab = tabs[newIndex];
  if (targetTab?.id) {
    chrome.tabs.update(targetTab.id, { active: true });
  }
}
