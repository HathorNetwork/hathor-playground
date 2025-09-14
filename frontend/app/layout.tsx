import './globals.css'
import { Inter, Satisfy } from 'next/font/google'
import { Providers } from './providers'

const inter = Inter({ subsets: ['latin'] })
const satisfy = Satisfy({ subsets: ['latin'], weight: '400', variable: '--font-satisfy' })

export const metadata = {
  title: 'Nano Contracts IDE',
  description: 'Development environment for Hathor Nano Contracts',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} ${satisfy.variable} h-full bg-gray-50`}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}