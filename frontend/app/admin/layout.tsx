import { TopHeader } from '@/components/layout/top-header';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className='min-h-screen'>
      <TopHeader />
      <main className='p-6'>{children}</main>
    </div>
  );
}
