import { appConfig } from './config';
import { setupNoAutofocus } from './content-dom';
import { CustomFindController, NativeFindController } from './content-find';
import { HelpOverlay } from './content-help-overlay';
import { LinkHints } from './content-link-hints';
import { IncrementalSelection } from './content-selection';
import { KeyBindings } from './keybindings';

type Keymap = (typeof appConfig.keymaps)[number];

function getActiveBindings(useNativeFind: boolean): readonly Keymap[] {
	return appConfig.keymaps.filter((binding) => {
		if (useNativeFind && (binding.rhs === 'find:next' || binding.rhs === 'find:prev')) {
			return false;
		}
		return true;
	});
}

setupNoAutofocus();
const linkHints = new LinkHints();
const incrementalSelection = new IncrementalSelection();
const useNativeFind = appConfig.options.findmode === 'native';
const searchController = useNativeFind ? new NativeFindController() : new CustomFindController();
const activeBindings = getActiveBindings(useNativeFind);
const helpOverlay = new HelpOverlay(activeBindings);
new KeyBindings(linkHints, incrementalSelection, searchController, helpOverlay, activeBindings);
