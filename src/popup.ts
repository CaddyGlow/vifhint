import {
	type SiteDisableState,
	getSiteDisableState,
	isTemporaryFallbackStorage,
	setSiteDisableState,
} from './site-disable';

const siteEl = document.querySelector<HTMLElement>('[data-site]');
const statusEl = document.querySelector<HTMLElement>('[data-status]');
const noteEl = document.querySelector<HTMLElement>('[data-note]');
const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-action]'));

const stateLabels: Record<SiteDisableState, string> = {
	enabled: 'Enabled on this site',
	temporary: 'Disabled temporarily',
	permanent: 'Disabled permanently',
};

type ActiveContext = {
	tabId: number;
	host: string;
};

function setStatus(text: string, options: { warning?: boolean } = {}): void {
	if (!statusEl) return;
	statusEl.textContent = text;
	statusEl.classList.toggle('is-warning', options.warning === true);
}

function setSiteText(text: string): void {
	if (!siteEl) return;
	siteEl.textContent = text;
}

function setNote(text: string): void {
	if (!noteEl) return;
	noteEl.textContent = text;
}

function setButtonsEnabled(enabled: boolean): void {
	for (const button of buttons) {
		button.disabled = !enabled;
	}
}

function highlightState(state: SiteDisableState): void {
	for (const button of buttons) {
		const action = button.dataset.action as SiteDisableState | undefined;
		const isSelected = action === state;
		button.classList.toggle('is-selected', isSelected);
		button.disabled = isSelected;
	}
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

async function getActiveContext(): Promise<ActiveContext | null> {
	const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
	const tab = tabs[0];
	if (!tab?.id) return null;
	const host = getHostFromUrl(tab.url);
	if (!host) return null;
	return { tabId: tab.id, host };
}

async function updateState(context: ActiveContext): Promise<void> {
	const state = await getSiteDisableState(context.host);
	setStatus(stateLabels[state]);
	highlightState(state);
	setSiteText(context.host);
	if (state === 'enabled') {
		setNote('Hints and keymaps are active on this site.');
	} else if (state === 'temporary') {
		setNote('Temporary disables reset when the browser restarts.');
	} else {
		setNote('This site is on the permanent disable list.');
	}
}

async function applyState(context: ActiveContext, state: SiteDisableState): Promise<void> {
	await setSiteDisableState(context.host, state);
	await updateState(context);
	chrome.tabs.sendMessage(
		context.tabId,
		{ type: 'hint:site-state', host: context.host, state },
		() => {
			void chrome.runtime.lastError;
		},
	);
}

async function init(): Promise<void> {
	if (isTemporaryFallbackStorage()) {
		setNote('Temporary disables reset when the browser restarts.');
	}

	const context = await getActiveContext();
	if (!context) {
		setSiteText('Unsupported page');
		setStatus('Unavailable', { warning: true });
		setButtonsEnabled(false);
		setNote('Open a regular website to manage per-site settings.');
		return;
	}

	await updateState(context);

	for (const button of buttons) {
		button.addEventListener('click', () => {
			const action = button.dataset.action as SiteDisableState | undefined;
			if (!action) return;
			void applyState(context, action);
		});
	}
}

void init();
