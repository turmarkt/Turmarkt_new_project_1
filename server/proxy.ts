export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

// Proxy listesi
const proxyList: ProxyConfig[] = [
  {
    host: 'proxy1.example.com',
    port: 8080,
    username: process.env.PROXY_USER,
    password: process.env.PROXY_PASS
  },
  {
    host: 'proxy2.example.com',
    port: 8080,
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
    const response = await fetch('https://api.ipify.org?format=json', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    return response.ok;
  } catch (error) {
    console.error(`Proxy kontrolü başarısız: ${proxy.host}:${proxy.port}`, error);
    return false;
  }
}