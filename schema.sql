-- Ürünler tablosu
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  price TEXT NOT NULL,
  base_price TEXT NOT NULL,
  images TEXT[] NOT NULL,
  variants JSONB NOT NULL,
  attributes JSONB NOT NULL,
  categories TEXT[] NOT NULL,
  tags TEXT[] NOT NULL
);

-- İndeksler
CREATE INDEX IF NOT EXISTS products_url_idx ON products (url);
