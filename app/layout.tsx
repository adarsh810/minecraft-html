import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Minecraft HTML',
  description: 'A Minecraft-style voxel game built with Three.js',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
