import type { Metadata } from 'next'
import { Inter, Space_Grotesk } from 'next/font/google'
import '@/styles/globals.css'
import { AuthProvider } from '@/lib/auth/auth-context-parent'
import { ThemeProvider } from '@/components/common/theme-provider'
import { Toaster } from '@/components/ui/toaster'

const inter = Inter({
	subsets: ['latin'],
	display: 'swap',
	variable: '--font-inter',
	weight: ['400', '500', '600'],
})

const spaceGrotesk = Space_Grotesk({
	subsets: ['latin'],
	display: 'swap',
	variable: '--font-space-grotesk',
	weight: ['300', '400', '500', '600', '700'],
})

export const metadata: Metadata = {
	title: 'JKKN | Learning Commons',
	icons: {
		icon: '/jkkn_1.svg',
	},
}

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode
}>) {
	return (
		<html lang="en" suppressHydrationWarning className={`${inter.variable} ${spaceGrotesk.variable}`}>
			<head>
				<link rel="preconnect" href={process.env.NEXT_PUBLIC_PARENT_APP_URL} crossOrigin="anonymous" />
				<link rel="dns-prefetch" href={process.env.NEXT_PUBLIC_PARENT_APP_URL} />
				<link rel="preconnect" href="https://fonts.googleapis.com" crossOrigin="anonymous" />
				<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
			</head>
			<body className={`${spaceGrotesk.className} ${inter.variable} ${spaceGrotesk.variable} antialiased`} suppressHydrationWarning>
				<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
					<AuthProvider autoValidate={false}>
						{children}
					</AuthProvider>
				</ThemeProvider>
				<Toaster />
			</body>
		</html>
	)
}
