import './globals.css';
import { Analytics } from '@vercel/analytics/next';
import { Instrument_Serif, JetBrains_Mono } from 'next/font/google';

const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--serif' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--mono' });

export const metadata = {
  title: 'Sphinx — you can outsource your thinking, but not your understanding',
  description: 'A Git hook for agent-assisted development. Before your agent’s code ships, Sphinx asks you a question about what it actually does.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${serif.variable} ${mono.variable}`}>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
