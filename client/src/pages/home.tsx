import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { urlSchema } from "@shared/schema";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Tag, Package, ArrowRight } from "lucide-react";

export default function Home() {
  const [product, setProduct] = useState<any>(null);
  const { toast } = useToast();

  const form = useForm({
    resolver: zodResolver(urlSchema),
    defaultValues: {
      url: ""
    }
  });

  const scrapeMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await apiRequest("POST", "/api/scrape", { url });
      return res.json();
    },
    onSuccess: (data) => {
      setProduct(data);
      toast({
        title: "Başarılı",
        description: "Ürün verileri başarıyla çekildi"
      });
    },
    onError: (error) => {
      toast({
        title: "Hata",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/export", { product });
      return res.blob();
    },
    onSuccess: (blob) => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'products.csv';
      a.click();
      toast({
        title: "Başarılı",
        description: "CSV dosyası başarıyla indirildi"
      });
    },
    onError: (error) => {
      toast({
        title: "Hata",
        description: "CSV dosyası oluşturulamadı",
        variant: "destructive"
      });
    }
  });

  const onSubmit = form.handleSubmit((data) => {
    scrapeMutation.mutate(data.url);
  });

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        <motion.div
          initial={false}
          animate={product ? { y: -20, scale: 0.95, opacity: 0.8 } : { y: 0, scale: 1, opacity: 1 }}
          className="transition-all duration-500"
        >
          <div className="text-center mb-8">
            <Package className="w-12 h-12 mx-auto mb-4 text-primary" />
            <h1 className="text-3xl font-bold mb-2">Trendyol Ürün Aktarıcı</h1>
            <p className="text-gray-400">Ürün verilerini Shopify'a uyumlu formata dönüştürün</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="relative">
              <Input
                placeholder="Trendyol ürün URL'sini girin..."
                {...form.register("url")}
                className="text-lg p-6 bg-gray-900 border-gray-800 rounded-xl"
              />
              <Button 
                type="submit"
                className="absolute right-2 top-1/2 transform -translate-y-1/2"
                disabled={scrapeMutation.isPending}
              >
                {scrapeMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowRight className="w-4 h-4" />
                )}
              </Button>
            </div>
          </form>
        </motion.div>

        <AnimatePresence>
          {product && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <Card className="bg-gray-900 border-gray-800">
                <CardContent className="p-8 space-y-8">
                  {/* Başlık ve Kategori/Etiketler */}
                  <div className="space-y-4">
                    <h2 className="text-2xl font-bold">{product.title}</h2>
                    <div className="flex flex-wrap gap-2">
                      {product.categories.map((category: string, i: number) => (
                        <Badge key={i} variant="outline" className="bg-gray-800 text-gray-200">
                          {category}
                        </Badge>
                      ))}
                      {product.tags.map((tag: string, i: number) => (
                        <Badge key={i} variant="secondary" className="bg-gray-800">
                          <Tag className="w-3 h-3 mr-1" />
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {/* Ürün Görselleri */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">Ürün Görselleri</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                      {product.images.map((img: string, i: number) => (
                        <motion.div
                          key={i}
                          whileHover={{ scale: 1.05 }}
                          className="aspect-square rounded-lg overflow-hidden bg-gray-800"
                        >
                          <img 
                            src={img}
                            alt={`Ürün ${i + 1}`}
                            className="w-full h-full object-cover"
                          />
                        </motion.div>
                      ))}
                    </div>
                  </div>

                  {/* Ürün Detayları Grid */}
                  <div className="grid md:grid-cols-2 gap-8">
                    {/* Sol Kolon: Açıklama ve Özellikler */}
                    <div className="space-y-6">
                      <div>
                        <h3 className="text-lg font-semibold mb-2">Ürün Açıklaması</h3>
                        <p className="text-gray-400 leading-relaxed">{product.description}</p>
                      </div>

                      <div>
                        <h3 className="text-lg font-semibold mb-4">Ürün Özellikleri</h3>
                        <div className="bg-gray-800 rounded-lg p-4 space-y-2">
                          {Object.entries(product.attributes).map(([key, value]: [string, string], i: number) => (
                            <div key={i} className="flex justify-between text-sm">
                              <span className="text-gray-400">{key}</span>
                              <span className="text-gray-200">{value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Sağ Kolon: Fiyat ve Varyantlar */}
                    <div className="space-y-6">
                      <div className="bg-gray-800 rounded-lg p-6">
                        <div className="flex items-baseline justify-between mb-2">
                          <p className="text-3xl font-bold">{product.price} TL</p>
                          <p className="text-lg text-gray-400 line-through">{product.basePrice} TL</p>
                        </div>
                        <p className="text-sm text-gray-400">Kar marjı dahil fiyat</p>
                      </div>

                      <div className="space-y-4">
                        {product.variants.sizes.length > 0 && (
                          <div>
                            <h4 className="text-sm text-gray-400 mb-2">Mevcut Bedenler</h4>
                            <div className="flex flex-wrap gap-2">
                              {product.variants.sizes.map((size: string, i: number) => (
                                <Badge key={i} variant="outline" className="bg-gray-800">
                                  {size}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        {product.variants.colors.length > 0 && (
                          <div>
                            <h4 className="text-sm text-gray-400 mb-2">Mevcut Renkler</h4>
                            <div className="flex flex-wrap gap-2">
                              {product.variants.colors.map((color: string, i: number) => (
                                <Badge key={i} variant="outline" className="bg-gray-800">
                                  {color}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <Button
                        onClick={() => exportMutation.mutate()}
                        disabled={exportMutation.isPending}
                        className="w-full py-6 text-lg"
                      >
                        {exportMutation.isPending ? (
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        ) : null}
                        Shopify CSV'sine Aktar
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}