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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Loader2,
  Package,
  ArrowRight,
  FileText,
  AlertTriangle,
  XCircle,
  AlertCircle,
  RefreshCcw,
  Image as ImageIcon
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UrlHistory } from "@/components/UrlHistory";

export default function Home() {
  const [product, setProduct] = useState<any>(null);
  const [error, setError] = useState<{
    message: string;
    status?: number;
    details?: string;
    solution?: string;
  } | null>(null);

  const { toast } = useToast();

  const form = useForm({
    resolver: zodResolver(urlSchema),
    defaultValues: {
      url: ""
    }
  });

  // Watch for URL changes from history selection
  useEffect(() => {
    const subscription = form.watch((value, { name, type }) => {
      if (type === "change" && name === "url") {
        setError(null);
      }
    });
    return () => subscription.unsubscribe();
  }, [form.watch]);

  // Update form when URL is selected from history
  const updateUrl = (url: string) => {
    form.setValue("url", url);
  };

  const getErrorSolution = (status?: number, details?: string) => {
    switch (status) {
      case 403:
        return "Birkaç dakika bekleyip tekrar deneyin veya farklı bir tarayıcı kullanın.";
      case 404:
        return "URL'nin doğru olduğundan emin olun ve ürünün hala satışta olup olmadığını kontrol edin.";
      case 429:
        return "Çok fazla istek yapıldı. Lütfen birkaç dakika bekleyip tekrar deneyin.";
      case 500:
        if (details?.includes('Firefox driver')) {
          return "Sistem yöneticinize başvurun veya farklı bir tarayıcı ile deneyin.";
        }
        return "Teknik bir hata oluştu. Lütfen daha sonra tekrar deneyin.";
      default:
        return "Sayfayı yenileyip tekrar deneyin veya farklı bir ürün URL'si ile tekrar deneyin.";
    }
  };

  const scrapeMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await apiRequest("POST", "/api/scrape", { url });
      const data = await res.json();
      if (!res.ok) throw { ...data, status: res.status };
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
    onError: (error: any) => {
      setError({
        message: error.message,
        status: error.status,
        details: error.details,
        solution: getErrorSolution(error.status, error.details)
      });
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

  const getErrorIcon = (status?: number) => {
    switch (status) {
      case 403:
        return <XCircle className="h-5 w-5" />;
      case 404:
        return <AlertTriangle className="h-5 w-5" />;
      case 429:
        return <RefreshCcw className="h-5 w-5" />;
      default:
        return <AlertCircle className="h-5 w-5" />;
    }
  };

  const getErrorTitle = (status?: number) => {
    switch (status) {
      case 403:
        return "Erişim Engellendi";
      case 404:
        return "Ürün Bulunamadı";
      case 429:
        return "İstek Limiti Aşıldı";
      case 500:
        return "Sistem Hatası";
      default:
        return "Hata Oluştu";
    }
  };

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

          {error && (
            <div className="mb-4">
              <Alert variant="destructive">
                {getErrorIcon(error.status)}
                <AlertTitle>{getErrorTitle(error.status)}</AlertTitle>
                <AlertDescription className="mt-2 space-y-2">
                  <p>{error.message}</p>
                  {error.solution && (
                    <p className="text-sm mt-2 p-2 bg-red-900/50 rounded-md">
                      <strong>Çözüm önerisi:</strong> {error.solution}
                    </p>
                  )}
                  {error.details && (
                    <p className="text-xs mt-1 text-gray-400">
                      Teknik detay: {error.details}
                    </p>
                  )}
                </AlertDescription>
              </Alert>
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="relative">
              <Input
                placeholder="Trendyol ürün URL'sini girin..."
                {...form.register("url")}
                className="text-xs p-4 bg-gray-900 border-gray-800 rounded-lg w-full truncate"
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

            <UrlHistory onSelect={(url) => {
              form.setValue("url", url);
              setError(null);
            }} />
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
                  <div className="text-xs text-gray-400 mb-2">
                    {["Trendyol", ...product.categories].join(" / ")}
                  </div>

                  <div className="space-y-3 border-b border-gray-800 pb-4">
                    <h2 className="text-lg font-semibold">{product.title}</h2>
                    <div className="flex items-baseline gap-2">
                      <span className="text-base font-bold">{product.price} TL</span>
                      {/*<span className="text-xs text-gray-400 line-through">{product.basePrice} TL</span>*/}
                    </div>
                  </div>

                  {/* Ürün Görselleri Bölümü */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <ImageIcon className="w-4 h-4" />
                      <span>Ürün Görselleri ({product.images.length})</span>
                    </div>
                    <ScrollArea className="h-[200px] rounded-md border border-gray-800 p-2">
                      <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
                        {product.images.map((image: string, index: number) => (
                          <div key={index} className="relative aspect-square group">
                            <img
                              src={image}
                              alt={`${product.title} - Görsel ${index + 1}`}
                              className="w-full h-full object-cover rounded-md transition-transform group-hover:scale-105"
                              onError={(e) => {
                                const img = e.target as HTMLImageElement;
                                // Zoom versiyonu yüklenmezse normal versiyonu dene
                                if (img.src.includes('_org_zoom')) {
                                  img.src = image.replace('_org_zoom', '');
                                } else if (!img.src.includes('cdn.dsmcdn.com') && img.src.includes('/ty')) {
                                  // CDN URL'sini dene
                                  img.src = `https://cdn.dsmcdn.com${new URL(image).pathname}`;
                                } else {
                                  // Farklı formatları dene
                                  const formats = ['jpg', 'jpeg', 'png', 'webp'];
                                  const currentFormat = img.src.split('.').pop() || '';
                                  const nextFormat = formats.find(f => f !== currentFormat) || 'jpg';
                                  img.src = image.replace(new RegExp(`\\.${currentFormat}$`), `.${nextFormat}`);
                                }
                              }}
                            />
                            <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">
                              {index + 1}
                            </div>
                            <a 
                              href={image}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <span className="text-white text-[10px]">Orijinal</span>
                            </a>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>

                  <div className="space-y-2">
                    <Accordion type="single" collapsible className="w-full mt-4">
                      <AccordionItem value="features">
                        <AccordionTrigger className="text-sm hover:no-underline">
                          <div className="flex items-center gap-2">
                            <Package className="w-4 h-4 text-gray-400" />
                            <span className="font-semibold text-gray-400">Ürün Özellikleri</span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="bg-gray-800/50 rounded p-3">
                            <div className="grid grid-cols-1 gap-2">
                              {Object.entries(product.attributes).map(([key, value]) => (
                                <div key={key} className="flex items-center py-2 border-b border-gray-700/50 last:border-0">
                                  <span className="text-xs text-gray-400 w-1/3 font-medium">{key}</span>
                                  <span className="text-xs text-gray-300 w-2/3">{value as string}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>

                      <AccordionItem value="csv-preview">
                        <AccordionTrigger className="text-sm hover:no-underline">
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-gray-400" />
                            <span className="font-semibold text-gray-400">CSV Önizleme</span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="bg-gray-800/50 rounded p-3 overflow-x-auto">
                            <table className="min-w-full text-xs">
                              <thead>
                                <tr className="border-b border-gray-700">
                                  <th className="text-left p-2">Handle</th>
                                  <th className="text-left p-2">Title</th>
                                  <th className="text-left p-2">Description</th>
                                  <th className="text-left p-2">Vendor</th>
                                  <th className="text-left p-2">Price</th>
                                  <th className="text-left p-2">Images</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr>
                                  <td className="p-2">{product?.title?.toLowerCase().replace(/\s+/g, '-')}</td>
                                  <td className="p-2">{product?.title}</td>
                                  <td className="p-2">{product?.description || '-'}</td>
                                  <td className="p-2">{product?.categories[0] || 'Trendyol'}</td>
                                  <td className="p-2">{product?.price} TL</td>
                                  <td className="p-2">
                                    {product?.images?.length || 0} görsel
                                    <div className="text-xs text-gray-500">
                                      {product?.images?.map((url: string) => (
                                        <div key={url} className="truncate max-w-[200px]">{url}</div>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>

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