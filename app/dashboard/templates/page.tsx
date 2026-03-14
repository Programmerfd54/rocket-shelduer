'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function TemplatesRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/dashboard/admin/templates')
  }, [router])
  return null
}
