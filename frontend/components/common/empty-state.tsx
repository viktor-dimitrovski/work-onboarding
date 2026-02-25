export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className='rounded-lg border border-dashed bg-white/80 p-8 text-center'>
      <h3 className='text-base font-semibold'>{title}</h3>
      <p className='mt-2 text-sm text-muted-foreground'>{description}</p>
    </div>
  );
}
