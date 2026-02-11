'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Application error:', error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <div className="text-center space-y-6 max-w-md">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-destructive" />
          </div>
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Что-то пошло не так</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Произошла ошибка. Попробуйте обновить страницу или вернуться на главную.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button onClick={reset} variant="default">
            Попробовать снова
          </Button>
          <Button variant="outline" asChild>
            <a href="/">На главную</a>
          </Button>
        </div>
      </div>
    </div>
  );
}
