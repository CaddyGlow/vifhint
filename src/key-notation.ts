// Key notation helpers for nvim-style sequences.

export type KeyToken = string;

type Modifier = 'C' | 'S' | 'A' | 'D';

const MODIFIER_ALIASES: Record<string, Modifier> = {
	c: 'C',
	ctrl: 'C',
	control: 'C',
	s: 'S',
	shift: 'S',
	a: 'A',
	alt: 'A',
	option: 'A',
	m: 'A',
	meta: 'A',
	d: 'D',
	cmd: 'D',
	command: 'D',
	super: 'D',
};

const MODIFIER_ORDER: readonly Modifier[] = ['C', 'S', 'A', 'D'];

const SPECIAL_KEY_ALIASES: Record<string, string> = {
	esc: 'Esc',
	escape: 'Esc',
	cr: 'CR',
	enter: 'CR',
	return: 'CR',
	tab: 'Tab',
	bs: 'BS',
	backspace: 'BS',
	space: 'Space',
	spc: 'Space',
	del: 'Del',
	delete: 'Del',
	up: 'Up',
	down: 'Down',
	left: 'Left',
	right: 'Right',
	pageup: 'PageUp',
	pagedown: 'PageDown',
	home: 'Home',
	end: 'End',
};

const EVENT_SPECIAL_KEYS: Record<string, string> = {
	Escape: 'Esc',
	Enter: 'CR',
	Tab: 'Tab',
	Backspace: 'BS',
	Delete: 'Del',
	' ': 'Space',
	Spacebar: 'Space',
	ArrowUp: 'Up',
	ArrowDown: 'Down',
	ArrowLeft: 'Left',
	ArrowRight: 'Right',
	PageUp: 'PageUp',
	PageDown: 'PageDown',
	Home: 'Home',
	End: 'End',
};

function normalizeModifier(part: string): Modifier | null {
	const key = part.toLowerCase();
	return MODIFIER_ALIASES[key] ?? null;
}

function normalizeSpecialKey(name: string): string | null {
	const key = name.toLowerCase();
	return SPECIAL_KEY_ALIASES[key] ?? null;
}

function normalizeModifiers(parts: string[]): Modifier[] {
	const mods = new Set<Modifier>();
	for (const part of parts) {
		const mod = normalizeModifier(part);
		if (mod) mods.add(mod);
	}
	return MODIFIER_ORDER.filter((mod) => mods.has(mod));
}

function tokenForLiteralChar(char: string): KeyToken {
	if (char === ' ') return '<Space>';
	return char;
}

function normalizeLeaderTokens(leader: string): KeyToken[] {
	if (!leader) return ['<Space>'];
	if (leader.startsWith('<') && leader.endsWith('>')) {
		return parseBracketToken(leader.slice(1, -1), null);
	}
	return Array.from(leader, tokenForLiteralChar);
}

function parseBracketToken(inner: string, leaderTokens: KeyToken[] | null): KeyToken[] {
	const trimmed = inner.trim();
	if (!trimmed) return [];
	if (leaderTokens && trimmed.toLowerCase() === 'leader') return leaderTokens;

	const parts = trimmed.split('-').filter(Boolean);
	if (parts.length === 0) return [];

	const keyPart = parts[parts.length - 1];
	const modifierParts = parts.slice(0, -1);
	const modifiers = normalizeModifiers(modifierParts);
	const special = normalizeSpecialKey(keyPart);

	if (modifiers.length === 0) {
		if (special) return [`<${special}>`];
		if (keyPart.length === 1) return [keyPart];
		return [keyPart];
	}

	if (modifiers.length === 1 && modifiers[0] === 'S' && !special && keyPart.length === 1) {
		return [keyPart.toUpperCase()];
	}

	const base = special ? special : keyPart.length === 1 ? keyPart.toLowerCase() : keyPart;
	return [`<${modifiers.join('-')}-${base}>`];
}

function parseSequence(input: string, leaderTokens: KeyToken[] | null): KeyToken[] {
	const tokens: KeyToken[] = [];
	let i = 0;
	while (i < input.length) {
		const char = input[i];
		if (char === '<') {
			const closeIndex = input.indexOf('>', i + 1);
			if (closeIndex === -1) {
				tokens.push(tokenForLiteralChar(char));
				i += 1;
				continue;
			}

			const inner = input.slice(i + 1, closeIndex);
			tokens.push(...parseBracketToken(inner, leaderTokens));
			i = closeIndex + 1;
			continue;
		}

		tokens.push(tokenForLiteralChar(char));
		i += 1;
	}

	return tokens;
}

export function parseKeySequence(input: string, leader: string): KeyToken[] {
	const leaderTokens = normalizeLeaderTokens(leader);
	return parseSequence(input, leaderTokens);
}

export function formatKeyTokenForDisplay(token: KeyToken): string {
	if (token === '<Space>') return 'SPC';
	if (token === '<Esc>') return 'Esc';
	if (token === '<CR>') return 'CR';
	if (token === '<BS>') return 'BS';
	if (token === '<Tab>') return 'Tab';
	if (token.startsWith('<') && token.endsWith('>')) return token.slice(1, -1);
	return token;
}

export function formatKeySequenceForDisplay(input: string, leader: string): string[] {
	const tokens = parseKeySequence(input, leader);
	return tokens.map((token) => formatKeyTokenForDisplay(token));
}

function shouldIncludeShift(event: KeyboardEvent, special: string | null): boolean {
	if (!event.shiftKey) return false;
	if (event.ctrlKey || event.altKey || event.metaKey) return true;
	if (!special) return false;
	return !['Space', 'CR', 'Esc', 'BS'].includes(special);
}

export function eventToKeyToken(event: KeyboardEvent): KeyToken | null {
	const key = event.key;
	if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta') return null;

	const special = EVENT_SPECIAL_KEYS[key] ?? null;
	const hasChordMods = event.ctrlKey || event.altKey || event.metaKey;
	const includeShift = shouldIncludeShift(event, special);

	if (hasChordMods || includeShift) {
		const modifiers: Modifier[] = [];
		if (event.ctrlKey) modifiers.push('C');
		if (includeShift) modifiers.push('S');
		if (event.altKey) modifiers.push('A');
		if (event.metaKey) modifiers.push('D');

		let base: string | null = null;
		if (special) {
			base = special;
		} else if (key.length === 1) {
			base = key.toLowerCase();
		} else {
			return null;
		}

		if (
			modifiers.length === 1 &&
			modifiers[0] === 'S' &&
			!special &&
			key.length === 1 &&
			/[a-zA-Z]/.test(key)
		) {
			return key;
		}

		return `<${modifiers.join('-')}-${base}>`;
	}

	if (special) return `<${special}>`;
	if (key.length === 1) return tokenForLiteralChar(key);
	return null;
}
