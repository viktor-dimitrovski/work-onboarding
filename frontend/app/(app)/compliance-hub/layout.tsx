/**
 * Compliance Hub layout: consistent content width and reduced outer padding.
 * Main content uses max-w-7xl on each page; this layout trims main's default
 * padding to p-4 for tighter space usage across all hub pages.
 */
export default function ComplianceHubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="-m-6 p-4 min-h-0">{children}</div>;
}
