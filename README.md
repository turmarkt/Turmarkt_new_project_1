# Trendyol to Shopify Product Converter

Bu uygulama Trendyol ürünlerini Shopify'a uyumlu formata dönüştürür ve CSV olarak dışa aktarır.

## Özellikler

### Ürün Veri Çekme
- Trendyol ürün URL'sinden otomatik veri çekme
- Ürün başlığı ve açıklaması
- Fiyat hesaplama (%15 kar marjı)
- Ürün özellikleri ve detayları
- Tüm ürün görselleri
- Beden ve renk varyantları
- Stok durumu

### Kategori Yönetimi
- Otomatik kategori tespiti
- Shopify uyumlu kategori eşleştirme
- Özel kategori yolları
- Akıllı ürün sınıflandırma

### Varyant İşleme
- Beden varyantları (S, M, L, XL vb.)
- Renk seçenekleri
- Stok durumu takibi
- Varyant bazlı fiyatlandırma

### CSV Dışa Aktarım
- Shopify uyumlu CSV formatı
- Tüm ürün detayları
- Varyant bilgileri
- Stok durumu
- Görsel URL'leri

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

1. Ana sayfada Trendyol ürün URL'sini girin
2. "Ürün Bilgilerini Getir" butonuna tıklayın
3. Çekilen ürün bilgilerini kontrol edin:
   - Ürün başlığı ve açıklaması
   - Fiyat bilgisi
   - Ürün özellikleri
   - Varyant bilgileri (beden/renk)
   - Görseller
4. "Shopify CSV'sine Aktar" butonuna tıklayarak CSV dosyasını indirin
5. İndirilen CSV dosyasını Shopify'a import edin

## Önemli Notlar

- Ürün fiyatları otomatik olarak %15 kar marjı ile hesaplanır
- Stok bilgileri varsayılan olarak kategori bazlı ayarlanır
- Görsel URL'leri otomatik olarak normalize edilir
- CSV dosyası Shopify'ın en güncel formatına uyumludur

## Lisans

MIT