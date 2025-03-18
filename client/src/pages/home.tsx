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
import { Loader2, Tag } from "lucide-react";

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
    <div className="min-h-screen bg-background text-foreground p-8">
      <div className="max-w-2xl mx-auto space-y-8">
        <motion.div
          initial={false}
          animate={product ? { y: -20, scale: 0.9 } : { y: 0, scale: 1 }}
        >
          <form onSubmit={onSubmit} className="space-y-4">
            <Input
              placeholder="Trendyol ürün URL'sini girin..."
              {...form.register("url")}
              className="text-lg p-6"
            />
            <Button 
              type="submit"
              className="w-full"
              disabled={scrapeMutation.isPending}
            >
              {scrapeMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Ürün Verilerini Çek
            </Button>
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
              <Card>
                <CardContent className="p-6 space-y-6">
                  {/* Kategori ve Etiketler */}
                  <div className="flex flex-wrap gap-2">
                    {product.categories.map((category: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        {category}
                      </Badge>
                    ))}
                    {product.tags.map((tag: string, i: number) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        <Tag className="w-3 h-3 mr-1" />
                        {tag}
                      </Badge>
                    ))}
                  </div>

                  {/* Başlık ve Açıklama */}
                  <div>
                    <h2 className="text-xl font-semibold mb-2">{product.title}</h2>
                    <p className="text-muted-foreground">{product.description}</p>
                  </div>

                  {/* Ürün Özellikleri */}
                  <div className="bg-muted/50 rounded-lg p-4">
                    <h3 className="font-medium mb-2">Ürün Özellikleri</h3>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(product.attributes).map(([key, value]: [string, string], i: number) => (
                        <div key={i} className="text-sm">
                          <span className="text-muted-foreground">{key}:</span>{" "}
                          <span>{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Ürün Görselleri */}
                  <div className="space-y-2">
                    <h3 className="font-medium">Ürün Görselleri</h3>
                    <div className="grid grid-cols-4 gap-2">
                      {product.images.map((img: string, i: number) => (
                        <img 
                          key={i}
                          src={img}
                          alt={`Ürün ${i + 1}`}
                          className="w-full aspect-square object-cover rounded-lg"
                        />
                      ))}
                    </div>
                  </div>

                  {/* Varyantlar ve Fiyat */}
                  <div className="flex justify-between items-start pt-4 border-t">
                    <div className="space-y-2">
                      <p className="text-2xl font-semibold">{product.price} TL</p>
                      <div className="space-y-1">
                        {product.variants.sizes.length > 0 && (
                          <div className="flex gap-2 flex-wrap">
                            <span className="text-sm text-muted-foreground">Bedenler:</span>
                            {product.variants.sizes.map((size: string, i: number) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                {size}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {product.variants.colors.length > 0 && (
                          <div className="flex gap-2 flex-wrap">
                            <span className="text-sm text-muted-foreground">Renkler:</span>
                            {product.variants.colors.map((color: string, i: number) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                {color}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <Button
                      onClick={() => exportMutation.mutate()}
                      disabled={exportMutation.isPending}
                    >
                      {exportMutation.isPending && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      CSV'ye Aktar
                    </Button>
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