import { Builder, By, until, WebDriver } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox';
import { ProxyConfig } from './proxy';

export class SeleniumManager {
  private driver: WebDriver | null = null;
  private proxyConfig: ProxyConfig;

  constructor(proxyConfig: ProxyConfig) {
    this.proxyConfig = proxyConfig;
  }

  async initDriver(): Promise<WebDriver> {
    try {
      // Firefox options
      const options = new firefox.Options()
        .addArguments('--headless')
        .addArguments('--no-sandbox')
        .addArguments('--disable-dev-shm-usage')
        .addArguments('--disable-gpu')
        .addArguments('--window-size=1920,1080')
        .addArguments('--width=1920')
        .addArguments('--height=1080')
        .setPreference('general.useragent.override', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36')
        .setPreference('dom.webdriver.enabled', false)
        .setPreference('useAutomationExtension', false)
        .setPreference('network.proxy.type', 1)
        .setPreference('network.proxy.http', this.proxyConfig.host)
        .setPreference('network.proxy.http_port', this.proxyConfig.port)
        .setPreference('network.proxy.ssl', this.proxyConfig.host)
        .setPreference('network.proxy.ssl_port', this.proxyConfig.port)
        .setPreference('javascript.enabled', true)
        .setPreference('permissions.default.image', 2); // Disable images for faster loading

      // Configure Firefox service
      const service = new firefox.ServiceBuilder()
        .setFirefoxBinary(process.env.FIREFOX_BIN || 'firefox')
        .enableVerboseLogging()
        .build();

      // Build driver with explicit wait timeout
      this.driver = await new Builder()
        .forBrowser('firefox')
        .setFirefoxOptions(options)
        .setFirefoxService(service)
        .build();

      await this.setupStealth();
      return this.driver;
    } catch (error: any) {
      console.error('Driver initialization error:', error);
      throw new Error(`Failed to initialize Firefox driver: ${error.message}`);
    }
  }

  private async setupStealth() {
    if (!this.driver) return;

    await this.driver.executeScript(`
      // Hide Selenium
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined
      });

      // Hide Automation
      window.navigator.permissions.query = (param) => ({
        state: 'granted',
        addEventListener: () => {}
      });

      // Spoof Plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5].map(() => ({
          name: 'Chrome PDF Plugin',
          filename: 'internal-pdf-viewer',
          description: 'Portable Document Format'
        }))
      });

      // Add Language Preferences
      Object.defineProperty(navigator, 'languages', {
        get: () => ['tr-TR', 'tr', 'en-US', 'en']
      });

      // Spoof Screen Resolution
      Object.defineProperty(window.screen, 'width', { get: () => 1920 });
      Object.defineProperty(window.screen, 'height', { get: () => 1080 });
      Object.defineProperty(window.screen, 'availWidth', { get: () => 1920 });
      Object.defineProperty(window.screen, 'availHeight', { get: () => 1080 });
      Object.defineProperty(window.screen, 'colorDepth', { get: () => 24 });
      Object.defineProperty(window.screen, 'pixelDepth', { get: () => 24 });
    `);
  }

  async loadPage(url: string): Promise<string> {
    if (!this.driver) {
      throw new Error('Driver not initialized');
    }

    try {
      await this.driver.get(url);

      // Sayfanın yüklenmesini bekle
      await this.driver.wait(until.elementLocated(By.css('.product-detail-container')), 10000);

      // İnsan benzeri scroll davranışı
      await this.simulateHumanBehavior();

      return await this.driver.getPageSource();
    } catch (error: any) {
      if (error.name === 'TimeoutError') {
        throw new Error('Page load timeout - product container not found');
      }
      throw error;
    }
  }

  private async simulateHumanBehavior() {
    if (!this.driver) return;

    try {
      // Rastgele scroll
      await this.driver.executeScript(`
        window.scrollTo({
          top: Math.floor(Math.random() * 500),
          behavior: 'smooth'
        });
      `);

      // Rastgele bekleme
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

      // Mouse hareketi simülasyonu
      const elements = await this.driver.findElements(By.css('a, button, img'));
      for (const element of elements.slice(0, 3)) {
        try {
          await this.driver.actions()
            .move({ origin: element })
            .pause(500 + Math.random() * 1000)
            .perform();
        } catch (e) {
          // Ignore element interaction errors
        }
      }
    } catch (error) {
      console.warn('Human behavior simulation error:', error);
      // Continue even if simulation fails
    }
  }

  async cleanup() {
    if (this.driver) {
      try {
        await this.driver.quit();
      } catch (error) {
        console.error('Driver cleanup error:', error);
      } finally {
        this.driver = null;
      }
    }
  }
}