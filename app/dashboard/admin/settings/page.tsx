'use client'

import { Breadcrumbs } from '@/components/common/Breadcrumbs'
import { PageContainer, PageHeader } from '@/components/common/PageHeader'
import { AdminSettingsPanel } from '@/components/admin/AdminSettingsPanel'

/** Настройки платформы. Доступ (только Lead_SUP) проверяет layout админки и API /api/admin/settings. */
export default function AdminSettingsPage() {
  return (
    <PageContainer size="narrow" className="px-4 sm:px-6">
      <PageHeader
        title="Настройки"
        description="Возможности ролей SUP и ADM, вкладки пространств и контакт для заблокированных пользователей. Изменения применяются сразу."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Админ панель', href: '/dashboard/admin' },
              { label: 'Настройки', current: true },
            ]}
          />
        }
      />
      <AdminSettingsPanel />
    </PageContainer>
  )
}
