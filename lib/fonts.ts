import { Inter, JetBrains_Mono } from 'next/font/google';

/** Основной UI: Inter — нейтральный, плотный, хорошая кириллица (как в Notion / Linear / Supabase) */
export const fontSans = Inter({
  subsets: ['latin', 'cyrillic'],
  display: 'swap',
  variable: '--font-inter',
});

/** Моноширинный для кода, URL, логинов и технических полей */
export const fontMono = JetBrains_Mono({
  subsets: ['latin', 'cyrillic'],
  display: 'swap',
  weight: ['400', '500'],
  variable: '--font-jetbrains',
});
