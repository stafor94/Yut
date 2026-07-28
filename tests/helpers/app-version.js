export const APP_VERSION_DOCUMENT_LOAD_COUNT_KEY = 'qa:app-version-document-load-count';

export async function installAppVersionDocumentLoadCounter(context) {
  await context.addInitScript((key) => {
    if (!window.location.pathname.includes('/Yut/')) return;
    const current = Number(window.sessionStorage.getItem(key) ?? '0');
    window.sessionStorage.setItem(key, String(current + 1));
  }, APP_VERSION_DOCUMENT_LOAD_COUNT_KEY);
}

export async function getAppVersionDocumentLoadCount(page) {
  return page.evaluate((key) => Number(window.sessionStorage.getItem(key) ?? '0'), APP_VERSION_DOCUMENT_LOAD_COUNT_KEY);
}

export async function routeNewAppVersion(page, version) {
  await page.route('**/version.json?version-check=*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ version }),
    });
  });
}
