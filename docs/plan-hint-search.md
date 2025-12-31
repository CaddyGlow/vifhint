# Hint Search Mode Plan (BrowseCut Parity)

- Match BrowseCut’s query matching for clickable elements.
  - Inputs/contenteditable: match `placeholder`, `aria-label`, `title`, and `value` (or `innerText` for
    contenteditable).
  - Other clickables: match `innerText`, `aria-label`, `title`.
  - Case-insensitive substring matching; no extra fields (no id/name/class).
- Add new command + keymap for `<leader>/` to activate a new hint mode.
- Implement a new hint mode that:
  - Accepts freeform text input (not limited to hint chars).
  - Filters clickable elements by the BrowseCut matching rules.
  - Shows numeric labels for the first 9 matches (top-left order).
  - Selects the element by pressing its number.
  - Supports Backspace, Escape, and ignores unmatched input (like current hints).
- Reuse existing hint label and border styling where possible; adjust only if needed for numeric labels.
- Manual validation:
  - `<leader>/` shows numeric hints for matches of visible text, `aria-label`, `title`,
    input `placeholder`/`value`.
  - Numbers click the right element; Backspace and Escape behave as expected.
  - Existing hint modes (`f`, `F`, `gF`) remain unchanged.
