export type HintAlign = 'left' | 'center' | 'right';

export type HintConfig = {
	readonly hintChars: string;
	readonly hintAlign: HintAlign;
	readonly hintOffset: { readonly x: number; readonly y: number };
	readonly clickableSelector: string;
	readonly showElementBorder: boolean;
	readonly debugTimings: boolean;
};

export const defaultHintConfig: HintConfig = {
	hintChars: 'asdfghjkl',
	hintAlign: 'left',
	hintOffset: { x: -8, y: -10 },
	clickableSelector: '',
	showElementBorder: true,
	debugTimings: true,
};
