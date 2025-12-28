// Background script to handle keyboard shortcuts
chrome.commands.onCommand.addListener((command) => {
  if (command === 'activate-hints') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { command: 'activate-hints' });
      }
    });
  }
});
