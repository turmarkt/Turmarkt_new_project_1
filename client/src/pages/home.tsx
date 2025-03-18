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
import { Loader2 } from "lucide-react";

export default function Home() {
  const [product, setProduct] = useState(null);
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
        title: "Success",
        description: "Product data fetched successfully"
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
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
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to export CSV",
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
              placeholder="Enter Trendyol product URL..."
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
              Fetch Product Data
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
                <CardContent className="p-6 space-y-4">
                  <h2 className="text-xl font-semibold">{product.title}</h2>
                  <p className="text-muted-foreground">{product.description}</p>
                  <div className="flex gap-4 overflow-x-auto py-2">
                    {product.images.map((img, i) => (
                      <img 
                        key={i}
                        src={img}
                        alt={`Product ${i + 1}`}
                        className="w-24 h-24 object-cover rounded-lg"
                      />
                    ))}
                  </div>
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-lg font-semibold">{product.price} TL</p>
                      <p className="text-sm text-muted-foreground">
                        {product.variants.sizes.length} sizes, {product.variants.colors.length} colors
                      </p>
                    </div>
                    <Button
                      onClick={() => exportMutation.mutate()}
                      disabled={exportMutation.isPending}
                    >
                      {exportMutation.isPending && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Export to CSV
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
