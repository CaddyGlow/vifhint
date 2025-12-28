// Optimized link hints implementation

// ============================================================================
// Types
// ============================================================================

interface ElementData {
  readonly element: HTMLElement;
  readonly rect: DOMRect;
  readonly style: CSSStyleDeclaration;
}

interface HintElement {
  readonly element: HTMLElement;
  readonly hint: string;
  readonly label: HTMLElement;
}

type HintAlign = 'left' | 'center' | 'right';

interface HintConfig {
  readonly hintChars: string;
  readonly hintAlign: HintAlign;
  readonly hintOffset: { readonly x: number; readonly y: number };
  readonly clickableSelector: string;
}

// ============================================================================
// Configuration
// ============================================================================

const config: HintConfig = {
  hintChars: 'asdfghjkl',
  hintAlign: 'left',
  hintOffset: { x: -8, y: -10 },
  clickableSelector: '',
};

// ============================================================================
// Constants
// ============================================================================

// Use querySelectorAll directly - browser's native selector engine is faster
const BASE_CLICKABLE_SELECTOR = [
  'a[href]', 'a[onclick]', 'button', 'select', 'input', 'textarea', 'summary',
  '[onclick]', '[contenteditable="true"]',
  '[role="button"]', '[role="link"]', '[role="menuitem"]',
  '[role="option"]', '[role="switch"]', '[role="tab"]',
  '[role="checkbox"]', '[role="combobox"]',
  '[role="menuitemcheckbox"]', '[role="menuitemradio"]'
].join(',');

function getClickableSelector(): string {
  if (config.clickableSelector) {
    return `${BASE_CLICKABLE_SELECTOR},${config.clickableSelector}`;
  }
  return BASE_CLICKABLE_SELECTOR;
}

// Elements that don't need overlap detection (they're always on top or interactive)
const SAFE_ELEMENTS = /^(INPUT|TEXTAREA|SELECT|BUTTON)$/;

// ============================================================================
// Helper Functions
// ============================================================================

function isEditable(el: HTMLElement): boolean {
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !/^(button|checkbox|file|hidden|image|radio|reset|submit)$/i.test(type);
  }
  return false;
}

function getElementDataIfVisible(
  el: HTMLElement,
  viewportWidth: number,
  viewportHeight: number
): ElementData | null {
  // Check 1: offsetWidth/Height (very cheap, no reflow)
  if (!el.offsetWidth || !el.offsetHeight) return null;

  // Check 2: Get rect once, cache it
  const rect = el.getBoundingClientRect();

  // Check 3: In viewport? (cheap comparison)
  if (rect.bottom <= 0 || rect.top >= viewportHeight ||
      rect.right <= 0 || rect.left >= viewportWidth) return null;

  // Check 4: Min size (4px, or 1px for editables)
  const minSize = isEditable(el) ? 1 : 4;
  if (rect.width <= minSize || rect.height <= minSize) return null;

  // Check 5: Get style once, cache it (expensive)
  const style = getComputedStyle(el);

  // Check 6: Visibility
  if (style.visibility === 'hidden' || style.display === 'none') return null;

  // Check 7: Opacity (skip for non-text inputs)
  const opacity = parseFloat(style.opacity);
  if (opacity <= 0.1 && !(el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'text')) {
    return null;
  }

  return { element: el, rect, style };
}

function addCursorPointerElements(
  results: ElementData[],
  viewportWidth: number,
  viewportHeight: number
): void {
  const found = new Set(results.map(r => r.element));

  // Use TreeWalker for efficient traversal
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        const el = node as HTMLElement;
        if (found.has(el)) return NodeFilter.FILTER_SKIP;
        if (!el.offsetWidth || !el.offsetHeight) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let node: Node | null;
  while (node = walker.nextNode()) {
    const el = node as HTMLElement;
    const style = getComputedStyle(el);
    const cursor = style.cursor;

    if (cursor === 'pointer' || cursor.startsWith('url(')) {
      const data = getElementDataIfVisible(el, viewportWidth, viewportHeight);
      if (data) {
        results.push(data);
        found.add(el);
      }
    }
  }
}

function addShadowDOMElements(
  results: ElementData[],
  viewportWidth: number,
  viewportHeight: number
): void {
  const found = new Set(results.map(r => r.element));

  // Find all elements with shadow roots
  const allElements = document.querySelectorAll('*');
  for (let i = 0; i < allElements.length; i++) {
    const host = allElements[i];
    if (host.shadowRoot) {
      const shadowElements = host.shadowRoot.querySelectorAll(getClickableSelector());
      for (let j = 0; j < shadowElements.length; j++) {
        const el = shadowElements[j] as HTMLElement;
        if (!found.has(el)) {
          const data = getElementDataIfVisible(el, viewportWidth, viewportHeight);
          if (data) {
            results.push(data);
            found.add(el);
          }
        }
      }
    }
  }
}

function filterOverlaps(elements: ElementData[]): ElementData[] {
  return elements.filter(({ element, rect }) => {
    // Skip check for safe elements (inputs, buttons, etc.)
    if (SAFE_ELEMENTS.test(element.tagName)) return true;
    if (element.contentEditable === 'true') return true;

    // Check if element is actually clickable at its center
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const topEl = document.elementFromPoint(centerX, centerY);

    if (!topEl) return true;

    // Element is visible if:
    // - topEl is the element itself
    // - topEl is inside the element
    // - element is inside topEl
    // - topEl is in element's shadow root
    return topEl === element ||
           element.contains(topEl) ||
           topEl.contains(element) ||
           (element.shadowRoot?.contains(topEl) ?? false);
  });
}

function filterAncestors(elements: ElementData[]): ElementData[] {
  const result: ElementData[] = [];

  for (const data of elements) {
    let dominated = false;

    for (let i = 0; i < result.length; i++) {
      const existing = result[i];

      if (existing.element.contains(data.element)) {
        // Existing contains new - replace unless existing is <a> with href
        if (existing.element.tagName !== 'A' || !(existing.element as HTMLAnchorElement).href) {
          result[i] = data;
        }
        dominated = true;
        break;
      } else if (data.element.contains(existing.element)) {
        // New contains existing - skip new
        dominated = true;
        break;
      }
    }

    if (!dominated) result.push(data);
  }

  return result;
}

function collectClickableElements(): ElementData[] {
  const results: ElementData[] = [];
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Phase 1: Query selector elements (fast, native)
  const selectorElements = document.querySelectorAll(getClickableSelector());

  // Phase 2: Single pass filter with cached data
  for (let i = 0; i < selectorElements.length; i++) {
    const data = getElementDataIfVisible(selectorElements[i] as HTMLElement, viewportWidth, viewportHeight);
    if (data) results.push(data);
  }

  // Phase 3: Find cursor:pointer elements not in selector
  addCursorPointerElements(results, viewportWidth, viewportHeight);

  // Phase 4: Shadow DOM traversal (lazy, only if needed)
  addShadowDOMElements(results, viewportWidth, viewportHeight);

  // Phase 5: Filter overlaps (expensive, do last, skip safe elements)
  const filtered = filterOverlaps(results);

  // Phase 6: Dedupe ancestors
  return filterAncestors(filtered);
}

// ============================================================================
// LinkHints Class
// ============================================================================

class LinkHints {
  #hints: HintElement[] = [];
  #active = false;
  #currentInput = '';
  #inputDisplay: HTMLElement | null = null;

  constructor() {
    this.#setupKeyListener();
    this.#setupCommandListener();
  }

  #setupCommandListener(): void {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.command === 'activate-hints') {
        this.#toggle();
      }
    });
  }

  #setupKeyListener(): void {
    // Use capture phase to intercept before other listeners
    document.addEventListener('keydown', (e) => {
      if (!this.#active) return;

      // Stop event from reaching page or other extensions
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (e.key === 'Escape') {
        this.#deactivate();
        return;
      }

      if (e.key === 'Backspace') {
        this.#currentInput = this.#currentInput.slice(0, -1);
        this.#updateInputDisplay();
        this.#filterHints();
        return;
      }

      const key = e.key.toLowerCase();
      if (config.hintChars.includes(key)) {
        this.#currentInput += key;
        this.#updateInputDisplay();
        this.#filterHints();

        // Check for exact match (uniform-length hints = no prefix conflicts)
        const match = this.#hints.find(h => h.hint === this.#currentInput);
        if (match) {
          this.#clickElement(match.element);
          this.#deactivate();
        } else {
          // Check if any hints still match
          const hasMatches = this.#hints.some(h => h.hint.startsWith(this.#currentInput));
          if (!hasMatches) {
            // No matches - revert last key
            this.#currentInput = this.#currentInput.slice(0, -1);
            this.#updateInputDisplay();
            this.#filterHints();
          }
        }
      }
    }, true); // capture phase
  }

  #toggle(): void {
    if (this.#active) {
      this.#deactivate();
    } else {
      this.#activate();
    }
  }

  #activate(): void {
    this.#active = true;
    this.#currentInput = '';

    // Create input display
    this.#createInputDisplay();

    // Collect elements using optimized pipeline
    const elements = collectClickableElements();

    // Generate hint strings
    const hintStrings = this.#generateHints(elements.length);

    // Create hints
    this.#hints = elements.map((data, i) => ({
      element: data.element,
      hint: hintStrings[i],
      label: this.#createLabel(hintStrings[i])
    }));

    // Show hints using cached rects
    this.#showHints(elements);
  }

  #createInputDisplay(): void {
    this.#inputDisplay = document.createElement('div');
    this.#inputDisplay.className = 'link-hint-input';
    document.body.appendChild(this.#inputDisplay);
  }

  #updateInputDisplay(): void {
    if (this.#inputDisplay) {
      this.#inputDisplay.textContent = this.#currentInput.toUpperCase();
      this.#inputDisplay.style.display = this.#currentInput ? 'block' : 'none';
    }
  }

  #deactivate(): void {
    this.#active = false;
    this.#currentInput = '';
    this.#hints.forEach(h => h.label.remove());
    this.#hints = [];
    if (this.#inputDisplay) {
      this.#inputDisplay.remove();
      this.#inputDisplay = null;
    }
  }

  #generateHints(count: number): string[] {
    const chars = config.hintChars.toUpperCase();
    const hints: string[] = [''];
    let offset = 0;

    // BFS-style generation: build hints level by level
    while (hints.length - offset < count || offset === 0) {
      const prefix = hints[offset++];
      for (let i = 0; i < chars.length; i++) {
        hints.push(prefix + chars[i]);
      }
    }

    // Skip shorter hints, return only uniform-length hints
    return hints.slice(offset, offset + count).map(h => h.toLowerCase());
  }

  #createLabel(text: string): HTMLElement {
    const label = document.createElement('div');
    label.className = 'link-hint-label';
    label.textContent = text.toUpperCase();
    return label;
  }

  #showHints(elements: ElementData[]): void {
    const positions: Array<{ top: number; left: number }> = [];

    this.#hints.forEach((hint, i) => {
      const { rect } = elements[i];

      // Calculate horizontal position based on alignment
      let left = config.hintAlign === 'right'
        ? rect.right + window.scrollX + config.hintOffset.x
        : config.hintAlign === 'center'
          ? rect.left + rect.width / 2 + window.scrollX + config.hintOffset.x
          : rect.left + window.scrollX + config.hintOffset.x;

      let top = rect.top + window.scrollY + config.hintOffset.y;

      // Keep within viewport
      const minLeft = window.scrollX + 2;
      const maxLeft = window.scrollX + window.innerWidth - 30;
      const minTop = window.scrollY + 2;

      left = Math.max(minLeft, Math.min(maxLeft, left));
      top = Math.max(minTop, top);

      // Avoid overlapping with previous hints
      for (const pos of positions) {
        if (Math.abs(top - pos.top) < 16 && Math.abs(left - pos.left) < 24) {
          left = pos.left + 24;
          if (left > maxLeft) {
            left = minLeft;
            top = pos.top + 16;
          }
        }
      }

      positions.push({ top, left });

      hint.label.style.left = `${left}px`;
      hint.label.style.top = `${top}px`;
      document.body.appendChild(hint.label);
    });
  }

  #filterHints(): void {
    for (const { hint, label } of this.#hints) {
      if (hint.startsWith(this.#currentInput)) {
        label.style.display = 'block';
        const matched = this.#currentInput.toUpperCase();
        const remaining = hint.slice(this.#currentInput.length).toUpperCase();
        label.innerHTML = `<span class="matched">${matched}</span>${remaining}`;
      } else {
        label.style.display = 'none';
      }
    }
  }

  #isEditableElement(element: HTMLElement): boolean {
    if ((element as HTMLInputElement).disabled) return false;
    const { localName, isContentEditable } = element;
    if (localName === 'textarea' || localName === 'select') return true;
    if (isContentEditable) return true;
    if (localName === 'input') {
      const { type } = element as HTMLInputElement;
      return !/^(button|checkbox|file|hidden|image|radio|reset|submit)$/i.test(type);
    }
    return false;
  }

  #dispatchMouseEvents(element: HTMLElement): void {
    const events = ['mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const;
    for (const eventName of events) {
      element.dispatchEvent(new MouseEvent(eventName, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window
      }));
    }
  }

  #clickElement(element: HTMLElement): void {
    if (this.#isEditableElement(element)) {
      element.focus();
      if (element.localName === 'input' || element.localName === 'textarea') {
        try {
          const input = element as HTMLInputElement | HTMLTextAreaElement;
          input.setSelectionRange(input.value.length, input.value.length);
        } catch {
          // Some input types don't support setSelectionRange
        }
      }
    } else {
      this.#dispatchMouseEvents(element);
    }
  }
}

// Initialize
new LinkHints();
