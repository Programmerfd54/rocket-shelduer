'use client';

import { Suspense } from 'react';
import { WorkspacesExplorer } from '@/components/dashboard/WorkspacesExplorer';
import { PageLoading } from '@/components/common/PageLoading';

export default function WorkspacesPage() {
  return (
    <Suspense fallback={<PageLoading variant="list" />}>
      <WorkspacesExplorer />
    </Suspense>
  );
}
