export async function detectAndBypassProtection(page: any) {
  // Bot algılama scriptlerini tespit et
  const scripts = await page.evaluate(() => {
    return Array.from(document.scripts).map(script => script.src);
  });

  // Bilinen bot algılama scriptlerini engelle
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = request.url();
    if (
      url.includes('datadome') ||
      url.includes('imperva') ||
      url.includes('perimeterx') ||
      url.includes('akamai') ||
      url.includes('cloudflare')
    ) {
      request.abort();
    } else {
      request.continue();
    }
  });

  // Otomatik bot algılama bypass
  await page.evaluateOnNewDocument(() => {
    // Bot algılama değişkenlerini gizle
    delete (window as any)._phantom;
    delete (window as any).__nightmare;
    delete (window as any).callPhantom;
    delete (window as any)._selenium;
    delete (window as any).domAutomation;
    delete (window as any).domAutomationController;
    delete (window as any)._WEBDRIVER_ELEM_CACHE;
    delete (window as any).selenium;

    // Automation kontrollerini gizle
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'automationController', { get: () => undefined });

    // Debugger kontrollerini gizle
    const originalFunction = Function.prototype.toString;
    Function.prototype.toString = function() {
      if (this === Function.prototype.toString) return originalFunction.call(this);
      if (this === window.alert) return 'function alert() { [native code] }';
      if (this === window.prompt) return 'function prompt() { [native code] }';
      if (this === window.confirm) return 'function confirm() { [native code] }';
      return originalFunction.call(this);
    };

    // Konsol çıktılarını gizle
    ['debug', 'info', 'warn', 'error'].forEach(method => {
      const originalMethod = console[method];
      console[method] = function(...args) {
        if (args.some(arg => /selenium|webdriver|puppeteer/i.test(String(arg)))) {
          return;
        }
        return originalMethod.apply(this, args);
      };
    });
  });
}
