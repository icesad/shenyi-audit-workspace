import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "审迹 · 审计工作台",
  description: "保留平台登录，以稳定平台身份保存账号资料；现有业务仍由本机浏览器保管。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
