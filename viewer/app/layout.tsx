import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'flAImegraph · Context explorer',
  description:
    'Inspect agent request cost, context provenance and harness profiles.',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
