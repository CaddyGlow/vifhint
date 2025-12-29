import { appConfig } from './config';

let bottomBar: HTMLDivElement | null = null;

export function getBottomBar(): HTMLDivElement {
	if (!bottomBar) {
		const bar = document.createElement('div');
		bar.className = 'hint-bottom-bar';
		const host = document.body ?? document.documentElement;
		host.appendChild(bar);
		bottomBar = bar;
	}
	return bottomBar;
}

export function isEditable(el: HTMLElement): boolean {
	const tag = el.tagName;
	if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
	if (el.isContentEditable) return true;
	if (tag === 'INPUT') {
		const type = (el as HTMLInputElement).type;
		return !/^(button|checkbox|file|hidden|image|radio|reset|submit)$/i.test(type);
	}
	return false;
}

function shouldBlockAutofocusFrom(el: HTMLElement): boolean {
	if (el === document.body || el === document.documentElement) return false;
	return isEditable(el);
}

export function setupNoAutofocus(): void {
	if (!appConfig.options.noautofocus) return;

	const blurActive = (): void => {
		const active = document.activeElement as HTMLElement | null;
		if (active && shouldBlockAutofocusFrom(active)) {
			try {
				active.blur();
			} catch {
				// Ignore blur errors on protected inputs
			}
		}
	};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', blurActive, { once: true });
	} else {
		blurActive();
	}

	const focusHandler = (event: FocusEvent): void => {
		if (event.isTrusted) return;
		const target = event.target as HTMLElement | null;
		if (target && shouldBlockAutofocusFrom(target)) {
			try {
				target.blur();
			} catch {
				// Ignore blur errors on protected inputs
			}
		}
	};

	document.addEventListener('focusin', focusHandler, true);
	window.setTimeout(() => {
		document.removeEventListener('focusin', focusHandler, true);
	}, 1000);
}
