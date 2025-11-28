import './globals.css'
import { Inter, Satisfy } from 'next/font/google'
import { Providers } from './providers'
import Script from 'next/script'

const inter = Inter({ subsets: ['latin'] })
const satisfy = Satisfy({ subsets: ['latin'], weight: '400', variable: '--font-satisfy' })

export const metadata = {
  title: 'Hathor Playground',
  description: 'Development environment for Hathor Nano Contracts',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="h-full">
      <head>
        {/* Google Analytics */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-289QLXBN2M"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-289QLXBN2M');
          `}
        </Script>
      </head>
      <body className={`${inter.className} ${satisfy.variable} h-full bg-gray-50`}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}
