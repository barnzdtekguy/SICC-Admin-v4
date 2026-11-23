import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
configure({ asyncUtilTimeout: 3000 });

// jsdom lacks these browser APIs.
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
window.scrollTo = () => {};
Element.prototype.scrollTo = () => {};
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
