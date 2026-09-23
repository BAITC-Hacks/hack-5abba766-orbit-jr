import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Career Quest — ваше следующее достижение', description: 'Осознанное развитие. Один шаг за другим.' };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="ru"><body>{children}</body></html>; }
