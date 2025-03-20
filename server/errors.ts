export class TrendyolScrapingError extends Error {
  constructor(message: string, public details?: {
    status: number;
    statusText: string;
    details?: string;
  }) {
    super(message);
    this.name = 'TrendyolScrapingError';
  }
}

export class URLValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'URLValidationError';
  }
}

export class ProductDataError extends Error {
  constructor(
    message: string,
    public field: string,
    public details?: any
  ) {
    super(message);
    this.name = 'ProductDataError';
  }
}

export class BotProtectionError extends Error {
  constructor(message: string, public retryAfter?: number) {
    super(message);
    this.name = 'BotProtectionError';
  }
}

export class NetworkError extends Error {
  constructor(message: string, public originalError: any) {
    super(message);
    this.name = 'NetworkError';
  }
}

export function handleError(error: any): { 
  status: number; 
  message: string; 
  details?: any;
  retryAfter?: number;
} {
  console.error('Error details:', {
    name: error.name,
    message: error.message,
    stack: error.stack,
    details: error.details
  });

  if (error instanceof TrendyolScrapingError) {
    return {
      status: error.details?.status || 500,
      message: error.message,
      details: error.details
    };
  }

  if (error instanceof URLValidationError) {
    return {
      status: 400,
      message: error.message
    };
  }

  if (error instanceof ProductDataError) {
    return {
      status: 422,
      message: `${error.field} alanında hata: ${error.message}`,
      details: error.details
    };
  }

  if (error instanceof BotProtectionError) {
    return {
      status: 403,
      message: error.message,
      retryAfter: error.retryAfter
    };
  }

  if (error instanceof NetworkError) {
    return {
      status: 503,
      message: error.message,
      details: error.originalError
    };
  }

  // Axios/Fetch özel hata durumları
  if (error.response?.status === 403) {
    return {
      status: 403,
      message: "Bot koruması aktif, erişim engellendi",
      retryAfter: parseInt(error.response.headers?.['retry-after'] || '60')
    };
  }

  if (error.response?.status === 429) {
    return {
      status: 429,
      message: "İstek limiti aşıldı, lütfen daha sonra tekrar deneyin",
      retryAfter: parseInt(error.response.headers?.['retry-after'] || '60')
    };
  }

  if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
    return {
      status: 503,
      message: "Bağlantı hatası, sunucuya erişilemiyor",
      details: error.message
    };
  }

  return {
    status: 500,
    message: "Beklenmeyen bir hata oluştu",
    details: error.message
  };
}