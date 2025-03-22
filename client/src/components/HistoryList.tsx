import { Card } from "@/components/ui/card";

export function HistoryList({ history }: { history: string[] }) {
  if (!history || history.length === 0) {
    return null;
  }

  return (
    <Card className="p-4 mt-4">
      <h2 className="text-lg font-semibold mb-2">Son Kullanılan URL'ler</h2>
      <ul className="space-y-2">
        {history.map((url, i) => (
          <li key={i} className="text-sm text-gray-600">
            {url}
          </li>
        ))}
      </ul>
      <div className="mt-4 text-xs text-gray-400 text-right">
        Erdem Çalışgan
      </div>
    </Card>
  );
}