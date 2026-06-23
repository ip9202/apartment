import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "아이뜨락 아파트 커뮤니티",
  description: "아이뜨락 아파트 입주민을 위한 커뮤니티 서비스 - 공지사항, 건의사항, 주차 추첨",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
