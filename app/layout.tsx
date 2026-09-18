import type { Metadata, Viewport } from 'next'
import { Figtree } from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/providers'

/*
  The brand wordmark is Gilroy-Black, which we hold no web licence for. Figtree
  is the closest free geometric grotesque — same broad proportions and a true
  800 weight — so headings and the wordmark stay on-brand.
*/
const figtree = Figtree({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'Innovalanga Hub',
    template: '%s · Innovalanga Hub',
  },
  description:
    'Innovation readiness tracking, mentorship and programme reporting for the Innovalanga innovation ecosystem.',
  applicationName: 'Innovalanga Hub',
}

export const viewport: Viewport = {
  themeColor: '#1F1D1E',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en-ZA" className={figtree.variable}>
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
