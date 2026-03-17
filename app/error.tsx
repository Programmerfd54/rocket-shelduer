'use client';

import { ErrorPage } from '@/components/_components/ErrorPage';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorPage
      type="server-error"
      errorDetails={error.message}
      errorStack={error.stack}
      showRefreshButton
      showBackButton
      showHomeButton
      logError
      onReset={reset}
    />
  );
}
