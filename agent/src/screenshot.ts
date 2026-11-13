import type { Page } from "@playwright/test";

const sensitiveFields = [
  "[data-private]",
  'input[type="password" i]',
  'input[type="email" i]',
  'input[type="tel" i]',
  "input[autocomplete]:not([autocomplete=off i]):not([autocomplete=on i])",
  "textarea",
].join(", ");

export function captureMaskedScreenshot(page: Page): Promise<Buffer> {
  return page.screenshot({
    type: "jpeg",
    mask: page.frames().map((frame) => frame.locator(sensitiveFields)),
    maskColor: "#000000",
    timeout: 3000,
  });
}
