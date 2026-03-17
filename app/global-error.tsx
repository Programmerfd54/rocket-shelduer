'use client';

import { useEffect } from 'react';
import { ErrorPage } from '@/components/_components/ErrorPage';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global error:', error);
  }, [error]);

  return (
    <html lang="ru">
      <body>
        <ErrorPage
          type="server-error"
          errorDetails={error.message}
          errorStack={error.stack}
          showRefreshButton
          showBackButton={false}
          showHomeButton
          autoDetectAdmin={false}
          logError={false}
          onReset={reset}
        />
      </body>
    </html>
  );
}
