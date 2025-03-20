import type { ProxyConfig } from 'playwright';
import fetch from 'node-fetch';
import HttpsProxyAgent from 'https-proxy-agent';

// Proxy yapılandırması
const proxyList: ProxyConfig[] = [
  {
    server: 'http://proxy1.example.com:8080',
    username: process.env.PROXY_USER,
    password: process.env.PROXY_PASS
  },
  {
    server: 'http://proxy2.example.com:8080',
    username: process.env.PROXY_USER,
    password: process.env.PROXY_PASS
  }
];

let currentProxyIndex = 0;

// Proxy rotasyonu
export function getNextProxy(): ProxyConfig {
  const proxy = proxyList[currentProxyIndex];
  currentProxyIndex = (currentProxyIndex + 1) % proxyList.length;
  return proxy;
}

// Proxy durumunu kontrol et
export async function checkProxyStatus(proxy: ProxyConfig): Promise<boolean> {
  try {
    const proxyAgent = new HttpsProxyAgent(proxy.server);
    const response = await fetch('https://api.ipify.org?format=json', {
      // @ts-ignore
      agent: proxyAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    return response.ok;
  } catch (error) {
    console.error(`Proxy kontrolü başarısız: ${proxy.server}`, error);
    return false;
  }
}