import { Window } from 'happy-dom';

type DomGlobals = {
	window: Window;
	document: Document;
};

export function createDom(): DomGlobals {
	const window = new Window();
	const { document } = window;

	const globalScope = globalThis as typeof globalThis & Record<string, unknown>;
	Object.assign(globalScope, {
		window,
		document,
		HTMLElement: window.HTMLElement,
		HTMLInputElement: window.HTMLInputElement,
		HTMLTextAreaElement: window.HTMLTextAreaElement,
		HTMLSelectElement: window.HTMLSelectElement,
		HTMLDivElement: window.HTMLDivElement,
		FocusEvent: window.FocusEvent,
		getComputedStyle: window.getComputedStyle.bind(window),
		requestAnimationFrame: window.requestAnimationFrame.bind(window),
		cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
	});

	return { window, document };
}
