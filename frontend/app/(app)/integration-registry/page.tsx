'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function IntegrationRegistryRoot() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/integration-registry/overview');
  }, [router]);
  return null;
}
