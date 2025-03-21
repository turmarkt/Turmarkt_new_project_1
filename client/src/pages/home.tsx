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
  RefreshCcw
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";

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
                  <div className="text-xs text-gray-400 mb-2">
                    {["Trendyol", ...product.categories].join(" / ")}
                  </div>

                  <div className="space-y-3 border-b border-gray-800 pb-4">
                    <h2 className="text-lg font-semibold">{product.title}</h2>
                    <div className="flex items-baseline gap-2">
                      <span className="text-base font-bold">{product.price} TL</span>
                      <span className="text-xs text-gray-400 line-through">{product.basePrice} TL</span>
                    </div>
                  </div>

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

                  <div className="space-y-2">
                    <Accordion type="single" collapsible className="w-full mt-4">
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
                                  <th className="text-left p-2">Compare Price</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr>
                                  <td className="p-2">{product?.title?.toLowerCase().replace(/\s+/g, '-')}</td>
                                  <td className="p-2">{product?.title}</td>
                                  <td className="p-2">{product?.description || '-'}</td>
                                  <td className="p-2">{product?.categories[0] || 'Trendyol'}</td>
                                  <td className="p-2">{product?.price} TL</td>
                                  <td className="p-2">{product?.basePrice} TL</td>
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