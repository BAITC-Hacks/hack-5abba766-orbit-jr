import type { Metadata } from "next";
import "./globals.css";
import "./halyk-theme.css";
import "./comfort-theme.css";
import "./apple-workspace.css";
import "./visual-experience.css";
import "./profile-workspace.css";
import "@/components/quest/career-journey.css";
import "@/components/quest/learning.css";
import "./compact-workspace.css";
import "./controls.css";
import "./responsive-workspace.css";
import "./hr-workspace.css";
import { ThemeControl } from "@/components/quest/theme-control";
const themeBootstrap = `(function(){try{var t=localStorage.getItem('career-quest-theme');if(t==='system')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';if(t!=='light'&&t!=='dark')t='dark';document.documentElement.dataset.theme=t;localStorage.setItem('career-quest-theme',t)}catch(e){if(!document.documentElement.dataset.theme)document.documentElement.dataset.theme='dark'}})()`;
export const metadata: Metadata = {
  title: "Career Quest × Halyk — пространство роста",
  description:
    "Ваш потенциал. Новые горизонты. Пространство развития сотрудников и команд.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" data-theme="dark" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBootstrap }} /></head>
      <body>{children}<ThemeControl /></body>
    </html>
  );
}
