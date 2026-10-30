import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/dom";

// Cold lazy imports can exceed the library's one-second default on shared runners.
// Keep a bounded readiness wait; tests with operation-specific budgets still override it.
const ASYNC_UI_READY_TIMEOUT_MS = 3_000;
configure({ asyncUtilTimeout: ASYNC_UI_READY_TIMEOUT_MS });

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

class TestResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: TestResizeObserver,
});

function createMemoryStorage(): Storage {
  const items = new Map<string, string>();

  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key: string) => items.get(key) ?? null,
    key: (index: number) => Array.from(items.keys())[index] ?? null,
    removeItem: (key: string) => {
      items.delete(key);
    },
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
}

const memoryStorage = createMemoryStorage();

Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: memoryStorage,
});

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: memoryStorage,
});

// jsdom does not implement the Web Animations API used by HeroUI tab indicators.
Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: () => [] });

// ProseMirror reads text Range geometry when focus/undo scrolls a selection.
// jsdom has no layout; real geometry is covered by the browser editor suite.
if (!Range.prototype.getClientRects) Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
if (!Range.prototype.getBoundingClientRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
