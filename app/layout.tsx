import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'REITs 行业周报工作台',
  description: '自动跟踪上交所、深交所 REITs 一级市场项目动态。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
