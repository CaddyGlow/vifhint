import { beforeEach, describe, expect, it } from 'bun:test';
import { PluginHost } from '../../src/plugins/host';
import type { PluginDefinition } from '../../src/plugins/types';
import { installMockChrome } from '../helpers/mockChrome';

const noopUi = { toast: () => {} };

const makeRegistry = (onActivate: () => void, onCommandRun: () => void): PluginDefinition[] => [
	{
		manifest: {
			id: 'foo',
			name: 'Foo',
			version: '0.0.0',
			description: 'Test plugin',
			contexts: ['content'],
			activation: [{ type: 'onCommand', command: 'foo.run' }],
			contributes: {
				commands: [{ id: 'foo.run', title: 'Run Foo' }],
				keymaps: [{ lhs: 'gf', rhs: 'foo.run', desc: 'Run Foo', repeatable: false }],
			},
		},
		load: {
			content: async () => ({
				activateContent: (ctx) => {
					onActivate();
					ctx.registerCommand('foo.run', () => {
						onCommandRun();
					});
					return () => {};
				},
			}),
		},
	},
	{
		manifest: {
			id: 'background-only',
			name: 'Background',
			version: '0.0.0',
			contexts: ['background'],
			activation: [],
		},
		load: {},
	},
];

describe('PluginHost registry and activation', () => {
	beforeEach(() => {
		installMockChrome();
	});

	it('only indexes matching-context plugins and activates on command', async () => {
		let activateCalls = 0;
		let commandRuns = 0;
		const registry = makeRegistry(
			() => {
				activateCalls += 1;
			},
			() => {
				commandRuns += 1;
			},
		);

		const capturedKeymaps: unknown[] = [];
		const host = new PluginHost({
			context: 'content',
			registry,
			ui: noopUi,
			registerKeymap: (map) => capturedKeymaps.push(map),
		});

		expect(host.hasCommand('foo.run')).toBe(true);
		expect(host.hasCommand('background.run')).toBe(false);

		await host.executeCommand('foo.run', { count: 1, hasCount: false });
		expect(commandRuns).toBe(1);
		expect(activateCalls).toBe(1);

		await host.executeCommand('foo.run', { count: 2, hasCount: true });
		expect(commandRuns).toBe(2);
		expect(activateCalls).toBe(1);

		expect(host.getKeymaps()).toHaveLength(1);

		host.dispose();
	});
});
