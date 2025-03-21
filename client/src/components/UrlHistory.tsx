import { useQuery } from "@tanstack/react-query";
import { Button } from "./ui/button";
import { History } from "lucide-react";

interface Props {
  onSelect: (url: string) => void;
}

export function UrlHistory({ onSelect }: Props) {
  const { data: history = [] } = useQuery({
    queryKey: ['/api/history'],
    refetchInterval: 1000 // Her saniye güncelle
  });

  if (history.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 mt-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <History className="w-3 h-3" />
        <span>Son kullanılan URL'ler</span>
      </div>
      <div className="flex flex-col gap-1">
        {history.map((url: string) => (
          <Button
            key={url}
            variant="ghost"
            className="text-left justify-start h-auto py-1 px-2 text-xs truncate bg-gray-900/50"
            onClick={() => onSelect(url)}
          >
            {url}
          </Button>
        ))}
      </div>
    </div>
  );
}