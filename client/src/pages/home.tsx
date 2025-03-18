import { useState, useEffect } from "react";
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
import { Loader2, Tag, Package, ArrowRight, FileText } from "lucide-react";

export default function Home() {
  const [product, setProduct] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const form = useForm({
    resolver: zodResolver(urlSchema),
    defaultValues: {
      url: ""
    }
  });

  useEffect(() => {
    const subscription = form.watch((value, { name, type }) => {
      if (type === "change" && name === "url") {
        setError(null);
      }
    });
    return () => subscription.unsubscribe();
  }, [form.watch]);

  const scrapeMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await apiRequest("POST", "/api/scrape", { url });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      return data;
    },
    onSuccess: (data) => {
      setProduct(data);
      setError(null);
      toast({
        title: "Başarılı",
        description: "Ürün verileri başarıyla çekildi"
      });
    },
    onError: (error: Error) => {
      setError(error.message);
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
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message);
      }
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
    onError: (error: Error) => {
      toast({
        title: "Hata",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const onSubmit = form.handleSubmit((data) => {
    setError(null);
    scrapeMutation.mutate(data.url);
  });

  return (
    <div className="min-h-screen bg-black text-white p-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <motion.div
          initial={false}
          animate={product ? { y: -20, scale: 0.95, opacity: 0.8 } : { y: 0, scale: 1, opacity: 1 }}
          className="transition-all duration-500"
        >
          <div className="text-center mb-6">
            <Package className="w-10 h-10 mx-auto mb-3 text-primary" />
            <h1 className="text-2xl font-bold mb-2">Trendyol Ürün Aktarıcı</h1>
            <p className="text-sm text-gray-400">Ürün verilerini Shopify'a uyumlu formata dönüştürün</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="relative">
              <Input
                placeholder="Trendyol ürün URL'sini girin..."
                {...form.register("url")}
                className="text-sm p-4 bg-gray-900 border-gray-800 rounded-lg"
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
            >
              <Card className="bg-gray-900 border-gray-800">
                <CardContent className="p-4 space-y-4">
                  {/* Başlık ve Fiyat */}
                  <div className="space-y-3 border-b border-gray-800 pb-4">
                    <h2 className="text-lg font-semibold">{product.title}</h2>
                    <div className="flex items-baseline gap-2">
                      <span className="text-base font-bold">{product.price} TL</span>
                      <span className="text-xs text-gray-400 line-through">{product.basePrice} TL</span>
                    </div>
                  </div>

                  {/* Ürün Özellikleri */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-gray-400" />
                      <h3 className="text-xs font-semibold text-gray-400">Ürün Özellikleri</h3>
                    </div>
                    <div className="bg-gray-800/50 rounded p-3">
                      <div className="space-y-2">
                        {Object.entries(product.attributes).map(([key, value]) => (
                          <div key={key} className="flex text-xs">
                            <span className="text-gray-400 w-1/2">{key}</span>
                            <span className="text-gray-300 w-1/2">{value as string}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* CSV Önizleme */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-gray-400" />
                      <h3 className="text-xs font-semibold text-gray-400">CSV Önizleme</h3>
                    </div>
                    <div className="bg-gray-800/50 rounded p-3">
                      <div className="space-y-2 text-xs">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <span className="text-gray-400">Title:</span>
                            <span className="text-gray-300 ml-2">{product.title}</span>
                          </div>
                          <div>
                            <span className="text-gray-400">Vendor:</span>
                            <span className="text-gray-300 ml-2">{product.brand}</span>
                          </div>
                          <div>
                            <span className="text-gray-400">Type:</span>
                            <span className="text-gray-300 ml-2">Clothing</span>
                          </div>
                          <div>
                            <span className="text-gray-400">Price:</span>
                            <span className="text-gray-300 ml-2">{product.price} TL</span>
                          </div>
                          {product.variants.sizes.length > 0 && (
                            <div>
                              <span className="text-gray-400">Size Options:</span>
                              <span className="text-gray-300 ml-2">{product.variants.sizes.join(', ')}</span>
                            </div>
                          )}
                          {product.variants.colors.length > 0 && (
                            <div>
                              <span className="text-gray-400">Color Options:</span>
                              <span className="text-gray-300 ml-2">{product.variants.colors.join(', ')}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Ürün Görselleri */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-gray-400">Ürün Görselleri</h3>
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {product.images.map((image: string, index: number) => (
                        <img
                          key={index}
                          src={image}
                          alt={`${product.title} - Görsel ${index + 1}`}
                          className="w-20 h-20 object-cover rounded-md flex-shrink-0"
                        />
                      ))}
                    </div>
                  </div>

                  {/* Varyantlar */}
                  <div className="space-y-3">
                    {product.variants.sizes.length > 0 && (
                      <div className="space-y-2">
                        <h3 className="text-xs font-semibold text-gray-400">Bedenler</h3>
                        <div className="flex flex-wrap gap-1">
                          {product.variants.sizes.map((size: string, i: number) => (
                            <Badge key={i} variant="outline" className="text-xs bg-gray-800">
                              {size}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {product.variants.colors.length > 0 && (
                      <div className="space-y-2">
                        <h3 className="text-xs font-semibold text-gray-400">Renkler</h3>
                        <div className="flex flex-wrap gap-1">
                          {product.variants.colors.map((color: string, i: number) => (
                            <Badge key={i} variant="outline" className="text-xs bg-gray-800">
                              {color}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Export Button */}
                  <Button
                    onClick={() => exportMutation.mutate()}
                    disabled={exportMutation.isPending}
                    className="w-full py-2 text-sm mt-4"
                  >
                    {exportMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Shopify CSV'sine Aktar
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}