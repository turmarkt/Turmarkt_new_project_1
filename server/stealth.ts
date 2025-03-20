import { Page } from 'puppeteer';

export async function applyStealthTechniques(page: Page) {
  await page.evaluateOnNewDocument(() => {
    // Navigator özellikleri
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 1 });
    Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' });
    Object.defineProperty(navigator, 'vendorSub', { get: () => '' });
    Object.defineProperty(navigator, 'productSub', { get: () => '20030107' });
    Object.defineProperty(navigator, 'cookieEnabled', { get: () => true });
    Object.defineProperty(navigator, 'appCodeName', { get: () => 'Mozilla' });
    Object.defineProperty(navigator, 'appName', { get: () => 'Netscape' });
    Object.defineProperty(navigator, 'appVersion', { get: () => '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    Object.defineProperty(navigator, 'product', { get: () => 'Gecko' });
    Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' });
    Object.defineProperty(navigator, 'language', { get: () => 'tr-TR' });
    Object.defineProperty(navigator, 'languages', { get: () => ['tr-TR', 'tr', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'onLine', { get: () => true });
    Object.defineProperty(navigator, 'doNotTrack', { get: () => null });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

    // Screen özellikleri
    Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
    Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });
    Object.defineProperty(screen, 'availWidth', { get: () => 1920 });
    Object.defineProperty(screen, 'availHeight', { get: () => 1080 });
    Object.defineProperty(screen, 'width', { get: () => 1920 });
    Object.defineProperty(screen, 'height', { get: () => 1080 });

    // Window özellikleri
    Object.defineProperty(window, 'devicePixelRatio', { get: () => 1 });
    Object.defineProperty(window, 'innerWidth', { get: () => 1920 });
    Object.defineProperty(window, 'innerHeight', { get: () => 1080 });
    Object.defineProperty(window, 'outerWidth', { get: () => 1920 });
    Object.defineProperty(window, 'outerHeight', { get: () => 1080 });
    Object.defineProperty(window, 'screenX', { get: () => 0 });
    Object.defineProperty(window, 'screenY', { get: () => 0 });
    Object.defineProperty(window, 'pageXOffset', { get: () => 0 });
    Object.defineProperty(window, 'pageYOffset', { get: () => 0 });

    // Document özellikleri
    Object.defineProperty(document, 'referrer', { get: () => '' });
    Object.defineProperty(document, 'hidden', { get: () => false });
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });

    // WebGL maskeleme
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      // UNMASKED_VENDOR_WEBGL
      if (parameter === 37445) {
        return 'Intel Inc.';
      }
      // UNMASKED_RENDERER_WEBGL
      if (parameter === 37446) {
        return 'Intel Iris OpenGL Engine';
      }
      return getParameter.apply(this, [parameter]);
    };

    // WebRTC devre dışı bırakma
    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices && mediaDevices.enumerateDevices) {
      mediaDevices.enumerateDevices = async () => [];
    }

    // Canvas fingerprint gizleme
    const oldGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(contextType, contextAttributes) {
      const context = oldGetContext.call(this, contextType, contextAttributes);
      if (context && contextType === '2d') {
        const oldGetImageData = context.getImageData;
        context.getImageData = function(...args) {
          const imageData = oldGetImageData.apply(this, args);
          for (let i = 0; i < imageData.data.length; i += 4) {
            // Rastgele gürültü ekle
            imageData.data[i] = imageData.data[i] + (Math.random() * 2 - 1);
            imageData.data[i + 1] = imageData.data[i + 1] + (Math.random() * 2 - 1);
            imageData.data[i + 2] = imageData.data[i + 2] + (Math.random() * 2 - 1);
          }
          return imageData;
        };
      }
      return context;
    };

    // Permission API simülasyonu
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = async (parameters: any) => {
      return {
        state: 'prompt',
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
      };
    };
  });
}
