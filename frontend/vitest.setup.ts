import "@testing-library/jest-dom/vitest";

// jsdom does not provide the browser's modal dialog lifecycle.
Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: { configurable: true, value() { this.setAttribute("open", ""); } },
  close: { configurable: true, value() { this.removeAttribute("open"); } },
});
