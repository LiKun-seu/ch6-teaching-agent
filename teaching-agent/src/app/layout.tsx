import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "第六章 · 引导式学习",
  description: "钢筋混凝土梁承载力计算原理 — 引导式教学 Agent 与自学天地",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="h-full">{children}</body>
    </html>
  );
}
