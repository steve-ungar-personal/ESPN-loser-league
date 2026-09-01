import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Juan Pena Memorial Loser League',
  description: 'Draft board built from players still undrafted in the ESPN league.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0f1216',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // suppressHydrationWarning: Edge and other browsers let extensions inject
  // attributes onto <html>/<body> before React hydrates, which otherwise
  // reports as a mismatch. Scoped to these two elements only, so genuine
  // mismatches deeper in the tree still surface.
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
