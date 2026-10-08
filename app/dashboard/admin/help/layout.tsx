'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Справка отключена: все пути под /dashboard/admin/help ведут на дашборд. */
export default function AdminHelpDisabledLayout() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard');
  }, [router]);
  return (
    <div role="status" className="flex min-h-[30vh] w-full items-center justify-center text-sm text-muted-foreground">
      Перенаправление…
    </div>
  );
}
