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
      // Basic Firefox options
      const options = new firefox.Options();

      // Set headless mode
      options.addArguments('-headless');

      // Set window size
      options.addArguments('--width=1920');
      options.addArguments('--height=1080');

      // Set basic preferences
      options.setPreference('general.useragent.override', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
      options.setPreference('dom.webdriver.enabled', false);
      options.setPreference('useAutomationExtension', false);

      // Set proxy configuration
      options.setPreference('network.proxy.type', 1);
      options.setPreference('network.proxy.http', this.proxyConfig.host);
      options.setPreference('network.proxy.http_port', this.proxyConfig.port);
      options.setPreference('network.proxy.ssl', this.proxyConfig.host);
      options.setPreference('network.proxy.ssl_port', this.proxyConfig.port);

      // Build the driver
      this.driver = await new Builder()
        .forBrowser('firefox')
        .setFirefoxOptions(options)
        .build();

      return this.driver;
    } catch (error: any) {
      console.error('Driver initialization error:', error);
      throw new Error(`Firefox driver initialization failed: ${error.message}`);
    }
  }

  async loadPage(url: string): Promise<string> {
    if (!this.driver) {
      throw new Error('Driver not initialized');
    }

    try {
      await this.driver.get(url);
      await this.driver.wait(until.elementLocated(By.css('body')), 10000);
      return await this.driver.getPageSource();
    } catch (error: any) {
      throw new Error(`Page load failed: ${error.message}`);
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