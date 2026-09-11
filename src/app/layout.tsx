import type { Metadata, Viewport } from 'next';
import { Space_Grotesk, Inter } from 'next/font/google';
import './globals.css';

const grotesk = Space_Grotesk({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-display' });
const inter = Inter({ subsets: ['latin'], weight: ['400', '600', '700'], variable: '--font-body' });

export const metadata: Metadata = {
  title: 'Counter Slop 6',
  description: 'A first-person arena shooter. Tactical, allegedly.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#131a26',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${grotesk.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
