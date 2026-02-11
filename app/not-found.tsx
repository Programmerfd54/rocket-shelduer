import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { FileQuestion } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <div className="text-center space-y-6 max-w-md">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
            <FileQuestion className="w-8 h-8 text-muted-foreground" />
          </div>
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Страница не найдена</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Запрашиваемая страница не существует или была перемещена.
          </p>
        </div>
        <Button asChild>
          <Link href="/">На главную</Link>
        </Button>
      </div>
    </div>
  );
}
