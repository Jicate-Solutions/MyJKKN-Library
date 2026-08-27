'use client'

/**
 * The last net.
 *
 * `app/(lib)/error.tsx` catches anything a library page throws and keeps the
 * sidebar. It cannot catch a failure in the root layout itself — the providers,
 * the fonts, the theme — because by then there is no shell left to draw into.
 * Without this file those failures fall through to Next.js's own bare "This
 * page couldn't load", which is the screen this whole change exists to remove.
 *
 * Deliberately plain. It brings its own `<html>` and `<body>`, uses no
 * component from the design system and no Tailwind class, because the most
 * likely reason to be here is that something below the styling broke — a card
 * that needs the theme provider is no use when the theme provider is what
 * failed. Inline styles always render.
 */

import { useEffect } from 'react'

export default function GlobalError({
	error,
	reset,
}: {
	error: Error & { digest?: string }
	reset: () => void
}) {
	useEffect(() => {
		console.error('[library] The application failed to start a page:', error)
	}, [error])

	return (
		<html lang="en">
			<body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif' }}>
				<div
					style={{
						minHeight: '100vh',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						padding: '24px',
						background: '#fbfbee',
						color: '#1a1a1a',
					}}
				>
					<div
						style={{
							maxWidth: '520px',
							width: '100%',
							background: '#ffffff',
							border: '1px solid #e5e5e5',
							borderLeft: '4px solid #b91c1c',
							borderRadius: '12px',
							padding: '32px',
							textAlign: 'center',
							boxShadow: '0 2px 8px -2px rgba(0,0,0,0.1)',
						}}
					>
						<h1 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 600 }}>
							The library could not open this screen
						</h1>
						<p style={{ margin: '0 0 20px', fontSize: '14px', lineHeight: 1.6, color: '#555' }}>
							Nothing has been lost and nothing was saved incorrectly. Try again, and if it
							keeps happening send the line below to whoever looks after the system.
						</p>

						{(error.message || error.digest) && (
							<div
								style={{
									background: '#f6f6f2',
									border: '1px solid #e5e5e5',
									borderRadius: '6px',
									padding: '12px',
									marginBottom: '20px',
									textAlign: 'left',
									fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
									fontSize: '12px',
									wordBreak: 'break-word',
								}}
							>
								{error.message}
								{error.digest && (
									<div style={{ marginTop: '6px', fontSize: '10px', color: '#777' }}>
										Reference: {error.digest}
									</div>
								)}
							</div>
						)}

						<button
							type="button"
							onClick={reset}
							style={{
								background: '#0b6d41',
								color: '#ffffff',
								border: 'none',
								borderRadius: '8px',
								padding: '10px 20px',
								fontSize: '14px',
								fontWeight: 500,
								cursor: 'pointer',
							}}
						>
							Try again
						</button>
					</div>
				</div>
			</body>
		</html>
	)
}
