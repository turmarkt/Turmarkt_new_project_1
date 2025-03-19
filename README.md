# Trendyol to Shopify Product Converter

Bu uygulama Trendyol ürünlerini Shopify'a uyumlu formata dönüştürür.

## Özellikler

- Trendyol ürün verilerini otomatik çekme
- Fiyat hesaplama (%15 kar marjı)
- Kategori yolu gösterimi
- Beden ve renk varyantları
- Ürün özelliklerini accordion menüde gösterme
- Shopify uyumlu CSV export

## Kurulum

### Gereksinimler

```bash
Node.js v20 veya üzeri
PostgreSQL 16 veya üzeri
```

### Bağımlılıklar

```bash
# Frontend Bağımlılıkları
@hookform/resolvers
@radix-ui/react-accordion
@radix-ui/react-avatar
@radix-ui/react-badge
@radix-ui/react-card
@tanstack/react-query
framer-motion
react
react-dom
react-hook-form
wouter
zod

# Backend Bağımlılıkları
cheerio
csv-writer
drizzle-orm
drizzle-zod
express
node-fetch
```

### Veritabanı Kurulumu

1. PostgreSQL veritabanı oluşturun
2. Aşağıdaki ortam değişkenlerini ayarlayın:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
PGUSER=user
PGPASSWORD=password
PGDATABASE=dbname
PGHOST=localhost
PGPORT=5432
```

### Projeyi Çalıştırma

1. Bağımlılıkları yükleyin:
```bash
npm install
```

2. Veritabanı şemasını oluşturun:
```bash
npm run db:push
```

3. Uygulamayı başlatın:
```bash
npm run dev
```

Uygulama varsayılan olarak 5000 portunda çalışacaktır: http://localhost:5000

## Kullanım

1. Trendyol ürün URL'sini girin
2. Ürün verileri otomatik olarak çekilecek
3. "Shopify CSV'sine Aktar" butonuna tıklayarak CSV dosyasını indirin
4. CSV dosyasını Shopify'a import edin

## Lisans

MIT
