export class TrendyolScrapingError extends Error {
  constructor(message: string, public details?: any) {
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
  constructor(message: string, public field: string) {
    super(message);
    this.name = 'ProductDataError';
  }
}

export function handleError(error: any): { status: number; message: string; details?: any } {
  console.error('Error details:', {
    name: error.name,
    message: error.message,
    stack: error.stack,
    details: error.details
  });

  if (error instanceof TrendyolScrapingError) {
    return {
      status: 500,
      message: "Ürün verisi çekilirken hata oluştu: " + error.message,
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
      message: `${error.field} alanında hata: ${error.message}`
    };
  }

  return {
    status: 500,
    message: "Beklenmeyen bir hata oluştu"
  };
}
