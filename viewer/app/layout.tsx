import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'flAImegraph · Usage & delivery efficiency',
  description:
    'Inspect AI resource usage, model settings, session efficiency and delivery runway.',
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
