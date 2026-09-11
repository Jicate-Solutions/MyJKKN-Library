'use client'

/**
 * Scanning with the camera, where there is no scanner.
 *
 * The gate and the desk are built around a handheld scanner typing into a box,
 * and that does not change. This is for the places a scanner is not: a
 * librarian walking the stacks with a tablet, a second gate opened for an exam
 * week, a phone standing in while a scanner is away being repaired. The camera
 * reads the same two things the scanner reads — the QR on the new ID cards and
 * the barcode on a book — and hands the value to exactly the same code, so
 * nothing downstream knows or cares which one was used.
 *
 * Four things this has to get right, because they are what makes camera
 * scanning either useful or infuriating:
 *
 *   * The BACK camera. A tablet's front camera points at the librarian's face.
 *     `environment` is asked for first, and the picker is there for the rest.
 *   * One camera stream, not two. Asking for a picture while the reader
 *     already holds the camera fails outright on plenty of Android devices, so
 *     the permission is settled and let go of before the reader starts, and
 *     the torch is worked from the reader's own track afterwards.
 *   * The torch, where the device has one. A book's barcode under a desk lamp
 *     at 6pm is the case that fails without it.
 *   * Letting go. A camera left running eats the battery and blocks every
 *     other app that wants it, so it is stopped on close, on unmount, and when
 *     the tab is hidden.
 *
 * The reader itself is loaded only when the camera is first opened. It is
 * around a megabyte, and the great majority of scans are made with a real
 * scanner that costs nothing to support.
 *
 * `getUserMedia` needs a secure context: the live site over https, or
 * localhost. On plain http over a LAN address the browser hides the camera
 * altogether, so that is said plainly rather than looking broken.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
	Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Camera, Loader2, Lightbulb, SwitchCamera, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Stops the camera and releases it. What every code path here ends with. */
interface ReaderControls {
	stop: () => void
}

interface CameraScannerProps {
	/** What was read. Called once per scan, with the camera already stopped. */
	onScan: (value: string) => void
	disabled?: boolean
	/** Said above the picture, so the person knows what to point it at. */
	label?: string
	className?: string
	/** Shown on the button next to the icon, on wider screens. */
	buttonText?: string
}

export function CameraScanner({
	onScan,
	disabled = false,
	label = 'Point the camera at the QR code or barcode',
	className,
	buttonText,
}: CameraScannerProps) {
	const [open, setOpen] = useState(false)
	const [starting, setStarting] = useState(false)
	const [problem, setProblem] = useState<string | null>(null)
	const [cameraCount, setCameraCount] = useState(0)
	const [torchOn, setTorchOn] = useState(false)
	const [hasTorch, setHasTorch] = useState(false)

	const videoRef = useRef<HTMLVideoElement>(null)
	const controlsRef = useRef<ReaderControls | null>(null)
	/** Which camera of the ones found is in use. A ref, so choosing another
	 *  restarts the picture deliberately rather than as a side effect. */
	const cameraIndex = useRef(0)
	const devicesRef = useRef<MediaDeviceInfo[]>([])
	/**
	 * Bumped to take the picture down and set it up again — the only thing that
	 * restarts a running camera, so a switch is one restart and not two.
	 */
	const [restartNonce, setRestartNonce] = useState(0)
	/**
	 * ZXing calls back on every frame it can decode, which for a card held
	 * still is many times a second. The first result closes the camera; this
	 * stops the frames already behind it from firing a second lookup.
	 */
	const doneRef = useRef(false)

	/** Everything the camera holds, put down. Safe to call more than once. */
	const release = useCallback(() => {
		try { controlsRef.current?.stop() } catch { /* already stopped */ }
		controlsRef.current = null

		// ZXing stops the tracks it started, but a picture it never got as far
		// as starting is still ours to end — and a half-released camera keeps
		// its light on.
		const stream = videoRef.current?.srcObject as MediaStream | null
		for (const track of stream?.getTracks() ?? []) {
			try { track.stop() } catch { /* already stopped */ }
		}
		if (videoRef.current) videoRef.current.srcObject = null

		setTorchOn(false)
		setHasTorch(false)
	}, [])

	// The camera never outlives the screen it was opened from
	useEffect(() => release, [release])

	// A tab switched away from is a camera nobody is looking at
	useEffect(() => {
		if (!open) return
		const onVisibility = () => { if (document.visibilityState === 'hidden') setOpen(false) }
		document.addEventListener('visibilitychange', onVisibility)
		return () => document.removeEventListener('visibilitychange', onVisibility)
	}, [open])

	const finish = useCallback((value: string) => {
		if (doneRef.current) return
		doneRef.current = true
		release()
		setOpen(false)
		onScan(value)
	}, [onScan, release])

	/** Starts the picture and keeps reading until something decodes. */
	const start = useCallback(async () => {
		setProblem(null)
		setStarting(true)
		doneRef.current = false

		try {
			if (typeof window !== 'undefined' && !window.isSecureContext) {
				setProblem('The camera only works over https. Open the library on its web address rather than an IP address, or use the handheld scanner.')
				return
			}
			if (!navigator.mediaDevices?.getUserMedia) {
				setProblem('This browser will not give a web page its camera. Use the handheld scanner, or open the library in Chrome or Safari.')
				return
			}

			// Settle the permission first, and let the camera go again straight
			// away. This is what makes the device labels readable below, and
			// asking for a second picture while this one is open is exactly what
			// fails on Android — so it is never held while the reader runs.
			const probe = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } })
			const liveId = probe.getVideoTracks()[0]?.getSettings?.().deviceId
			for (const track of probe.getTracks()) track.stop()

			const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput')
			devicesRef.current = devices
			setCameraCount(devices.length)

			// Start on the camera the browser just gave us — the back one, asked
			// for above — and let "switch" step on from there.
			if (!devices[cameraIndex.current]) {
				cameraIndex.current = Math.max(0, devices.findIndex(d => d.deviceId === liveId))
			}
			const chosen = devices[cameraIndex.current] ?? devices[0]

			const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
				import('@zxing/browser'),
				import('@zxing/library'),
			])

			// Left to itself the reader tries every format it knows at the camera's
			// default picture size, once every half second. That reads a QR — which
			// is large and forgiving — and almost never a printed accession label,
			// whose bars are a few pixels wide at that size. So: only the formats
			// the library actually meets, the slower "try harder" pass that reads
			// bars at an angle or under a lamp, a full-size picture with the focus
			// kept moving, and a fresh attempt several times a second.
			const hints = new Map()
			hints.set(DecodeHintType.POSSIBLE_FORMATS, [
				BarcodeFormat.QR_CODE,
				BarcodeFormat.CODE_128,
				BarcodeFormat.CODE_39,
				BarcodeFormat.EAN_13,
				BarcodeFormat.EAN_8,
				BarcodeFormat.ITF,
				BarcodeFormat.CODABAR,
			])
			hints.set(DecodeHintType.TRY_HARDER, true)
			const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 })

			if (!videoRef.current) return

			const controls = await reader.decodeFromConstraints(
				{
					video: {
						...(chosen?.deviceId ? { deviceId: { exact: chosen.deviceId } } : { facingMode: { ideal: 'environment' } }),
						width: { ideal: 1920 },
						height: { ideal: 1080 },
						// `focusMode` is real on Android Chrome but not in the DOM types yet
						advanced: [{ focusMode: 'continuous' } as unknown as MediaTrackConstraintSet],
					},
				},
				videoRef.current,
				(result, _error, ctrl) => {
					// A frame with nothing readable in it is the normal case, several
					// times a second, and arrives here as an error worth ignoring.
					if (!result) return
					const text = result.getText().trim()
					if (!text) return
					ctrl.stop()
					finish(text)
				}
			)
			controlsRef.current = controls

			// The torch belongs to the reader's own track, now that it has one
			const track = (videoRef.current.srcObject as MediaStream | null)?.getVideoTracks()[0]
			const capabilities = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean }
			setHasTorch(capabilities.torch === true)
		} catch (err) {
			const name = err instanceof Error ? err.name : ''
			if (name === 'NotAllowedError' || name === 'SecurityError') {
				setProblem('The camera was blocked. Allow camera access for this site in the browser, then try again.')
			} else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
				setProblem('No camera was found on this device.')
			} else if (name === 'NotReadableError') {
				setProblem('The camera is being used by another app. Close it and try again.')
			} else {
				setProblem('The camera could not be started. Use the handheld scanner, or try again.')
			}
			release()
		} finally {
			setStarting(false)
		}
	}, [finish, release])

	// Opening starts it, closing puts it down, and a switch restarts it. Nothing
	// else does, so the picture is never taken down mid-scan by a render.
	useEffect(() => {
		if (!open) { release(); return }
		void start()
		return release
	}, [open, restartNonce, start, release])

	const switchCamera = () => {
		if (devicesRef.current.length < 2) return
		cameraIndex.current = (cameraIndex.current + 1) % devicesRef.current.length
		setRestartNonce(n => n + 1)
	}

	const toggleTorch = async () => {
		const track = (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks()[0]
		if (!track) return
		try {
			const next = !torchOn
			// `torch` is real on Android Chrome but is not in the DOM types yet
			await track.applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints)
			setTorchOn(next)
		} catch {
			setHasTorch(false)
		}
	}

	return (
		<>
			<TooltipProvider delayDuration={300}>
				<Tooltip>
					<TooltipTrigger asChild>
						{/* Brand green, not an outline: beside a wide scan box a grey
						    square reads as part of the border and nobody finds it.
						    Every camera button in the library is this one, so they
						    are all the same green — the same green as Record at the
						    gate, which is the other button that starts a scan. */}
						<Button
							type="button"
							onClick={() => setOpen(true)}
							disabled={disabled}
							className={cn(
								'shrink-0 bg-brand-green text-white hover:bg-brand-green-600',
								'dark:bg-brand-green-400 dark:text-brand-green-900 dark:hover:bg-brand-green-500',
								className
							)}
							aria-label="Scan with the camera"
						>
							<Camera className="h-4 w-4" />
							{buttonText && <span className="ml-1.5 hidden sm:inline">{buttonText}</span>}
						</Button>
					</TooltipTrigger>
					<TooltipContent>Scan with this device&apos;s camera — QR card or book barcode</TooltipContent>
				</Tooltip>
			</TooltipProvider>

			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="sm:max-w-[440px]">
					<DialogHeader>
						<DialogTitle>Scan with the camera</DialogTitle>
						<DialogDescription>{label}</DialogDescription>
					</DialogHeader>

					{problem ? (
						<div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
							<AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
							<p className="text-sm text-muted-foreground">{problem}</p>
						</div>
					) : (
						<div className="relative overflow-hidden rounded-md bg-black">
							{/* muted and playsInline together are what let iOS play it
							    inline instead of taking over the whole screen */}
							<video
								ref={videoRef}
								className="h-[280px] w-full object-cover"
								muted
								playsInline
								autoPlay
							/>

							{/* The window to hold the code in. Nothing enforces it — it is
							    there so people hold the card still, and close enough. */}
							<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
								<div className="h-40 w-56 rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
							</div>

							{starting && (
								<div className="absolute inset-0 flex items-center justify-center bg-black/60">
									<Loader2 className="h-6 w-6 animate-spin text-white" />
								</div>
							)}
						</div>
					)}

					<div className="flex items-center gap-2">
						{hasTorch && !problem && (
							<Button type="button" variant="outline" size="sm" onClick={toggleTorch}>
								<Lightbulb className={cn('mr-1.5 h-4 w-4', torchOn && 'text-brand-yellow-700')} />
								{torchOn ? 'Light off' : 'Light on'}
							</Button>
						)}
						{cameraCount > 1 && !problem && (
							<Button type="button" variant="outline" size="sm" onClick={switchCamera}>
								<SwitchCamera className="mr-1.5 h-4 w-4" />
								Switch camera
							</Button>
						)}
						<Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => setOpen(false)}>
							Close
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</>
	)
}
