import type { Page } from "@playwright/test";

export function notification(page: Page, title: string | RegExp) {
  return page.locator('[data-slot="toast"]').filter({
    has: page.locator('[data-slot="toast-title"]').filter({ hasText: title }),
  });
}
