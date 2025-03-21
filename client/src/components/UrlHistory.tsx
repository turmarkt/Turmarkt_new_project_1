import { useQuery } from "@tanstack/react-query";
import { Button } from "./ui/button";

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
      <div className="text-sm text-muted-foreground">Son kullanılan URL'ler:</div>
      <div className="flex flex-col gap-1">
        {history.map((url: string) => (
          <Button
            key={url}
            variant="ghost"
            className="text-left justify-start h-auto py-1 px-2 text-xs truncate"
            onClick={() => onSelect(url)}
          >
            {url}
          </Button>
        ))}
      </div>
    </div>
  );
}