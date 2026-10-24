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
 * The reading is done by the browser's own barcode reader where it has one
 * (Chrome on Android, with Google's ML Kit behind it), which copes with the
 * small, slightly soft label a hand-held phone gives; elsewhere ZXing is
 * loaded, only when the camera is first opened. It is around a megabyte, and
 * the great majority of scans are made with a real scanner that costs
 * nothing to support. Where the camera can zoom, a slider lets the label be
 * read from a hand's length away — where the phone can focus — rather than
 * pressed up against the lens.
 *
 * `getUserMedia` needs a secure context: the live site over https, or
 * localhost. On plain http over a LAN address the browser hides the camera
 * altogether, so that is said plainly rather than looking broken.
 *
 * One scan closes the camera, because issuing a book is one book. `continuous`
 * is the other way round, for counting a shelf at a stock check: the camera is
 * opened once, every code is handed over as it is read, a code already read is
 * quietly dropped rather than sent twice, and the person closes it when the
 * shelf is done.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
	Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Camera, Loader2, Lightbulb, SwitchCamera, AlertTriangle, ZoomIn, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Stops the camera and releases it. What every code path here ends with. */
interface ReaderControls {
	stop: () => void
}

/** The browser's own barcode reader, where it has one. Not in the DOM types yet. */
interface NativeDetector {
	detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string; format?: string }>>
}

/**
 * Barcode types a library label is never printed in, and that a camera reads
 * by mistake: EAN and UPC are the publisher's code on the cover, and ITF is
 * known for finding a number in part of some other barcode. A library label
 * 27087 was read as the UPC 616886983100. Where the page can say which
 * numbers are real copies (`isKnown`), these are taken only when they are one.
 */
const UNSURE_FORMATS = new Set(['ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf'])

/** One code the camera found, with the kind of barcode it was. */
interface Read {
	value: string
	format: string
}

/** The formats the library meets, in the names the browser's reader uses. */
const NATIVE_FORMATS = ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'itf', 'codabar']

/**
 * The browser's built-in reader set to the library's formats, or null where
 * the browser has none (desktop Firefox, Safari on most iPhones) — in which
 * case ZXing does the reading.
 */
async function nativeDetector(): Promise<NativeDetector | null> {
	try {
		const Detector = (window as unknown as {
			BarcodeDetector?: {
				new (options: { formats: string[] }): NativeDetector
				getSupportedFormats?: () => Promise<string[]>
			}
		}).BarcodeDetector
		if (!Detector) return null
		const supported = await Detector.getSupportedFormats?.() ?? NATIVE_FORMATS
		const formats = NATIVE_FORMATS.filter(format => supported.includes(format))
		if (formats.length === 0) return null
		return new Detector({ formats })
	} catch {
		return null
	}
}

interface CameraScannerProps {
	/**
	 * What was read. Called once per scan, with the camera already stopped —
	 * unless `continuous` is set, when it is called for each new code and the
	 * picture carries on.
	 */
	onScan: (value: string, format?: string) => void
	disabled?: boolean
	/** Said above the picture, so the person knows what to point it at. */
	label?: string
	className?: string
	/** Shown on the button next to the icon, on wider screens. */
	buttonText?: string
	/**
	 * Keep scanning until the person closes it.
	 *
	 * For counting a shelf rather than issuing one book: the camera is opened
	 * once, every code it reads is handed over straight away, and it is put
	 * down when the person says so. A code already read since the camera was
	 * opened is NOT sent again — the lens keeps coming back to books already
	 * counted, and nobody wants that journey made twice.
	 */
	continuous?: boolean
	/**
	 * Drawn under the picture while scanning. The camera fills a phone's
	 * screen, so whatever the page would have shown about the last few scans
	 * has to be shown in here instead, or the person is counting blind.
	 */
	feed?: ReactNode
	/**
	 * Told when the camera opens and closes. The stock check uses it to stop
	 * asking for counts nobody can see while the camera fills the screen.
	 */
	onOpenChange?: (open: boolean) => void
	/**
	 * Told when a code already read since the camera opened is in front of it
	 * again — once per book, not on every frame it stays in shot — so the page
	 * can say "already scanned" as loudly as it says "counted".
	 */
	onRepeat?: (value: string) => void
	/**
	 * Whether a number is a real copy here. Given, it lets the camera prefer the
	 * library's label when a frame holds more than one barcode, and refuse a
	 * publisher's code or a misread (see UNSURE_FORMATS) that matches nothing.
	 */
	isKnown?: (value: string) => boolean
}

export function CameraScanner({
	onScan,
	disabled = false,
	label = 'Point the camera at the QR code or barcode',
	className,
	buttonText,
	continuous = false,
	feed,
	onOpenChange,
	onRepeat,
	isKnown,
}: CameraScannerProps) {
	const [open, setOpen] = useState(false)

	const isKnownRef = useRef(isKnown)
	useEffect(() => { isKnownRef.current = isKnown }, [isKnown])

	/**
	 * The one code worth handing over from what a frame held — or none, when
	 * all it held was a code a library label is never printed in.
	 */
	const pick = useCallback((reads: Read[]): Read | null => {
		const usable = reads.filter(read => read.value)
		const known = isKnownRef.current
		if (!known) return usable[0] ?? null
		return usable.find(read => known(read.value))
			?? usable.find(read => !UNSURE_FORMATS.has(read.format))
			?? null
	}, [])

	const onRepeatRef = useRef(onRepeat)
	useEffect(() => { onRepeatRef.current = onRepeat }, [onRepeat])
	/** The last repeat told, so a book held still is told about once. */
	const lastRepeatRef = useRef<{ value: string; at: number } | null>(null)

	const onOpenChangeRef = useRef(onOpenChange)
	useEffect(() => { onOpenChangeRef.current = onOpenChange }, [onOpenChange])
	useEffect(() => { onOpenChangeRef.current?.(open) }, [open])
	const [starting, setStarting] = useState(false)
	const [problem, setProblem] = useState<string | null>(null)
	const [cameraCount, setCameraCount] = useState(0)
	const [torchOn, setTorchOn] = useState(false)
	const [hasTorch, setHasTorch] = useState(false)
	/** What the running camera can zoom between, or null where it cannot zoom at all. */
	const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number } | null>(null)
	const [zoom, setZoom] = useState(1)

	const videoRef = useRef<HTMLVideoElement>(null)
	const controlsRef = useRef<ReaderControls | null>(null)
	/** Which camera of the ones found is in use. A ref, so choosing another
	 *  restarts the picture deliberately rather than as a side effect. */
	const cameraIndex = useRef(-1)
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

	/**
	 * Every code read since the camera was opened, while scanning on.
	 *
	 * The reader fires several times a second at whatever is in front of it, so
	 * without this one book held still would be sent twenty times. It is also
	 * the answer to a book scanned again on purpose: it is simply not sent.
	 */
	const seenRef = useRef<Set<string>>(new Set())
	const [readCount, setReadCount] = useState(0)
	/** The code just read that had already been counted, shown for a moment. */
	const [repeated, setRepeated] = useState<string | null>(null)

	/**
	 * The latest `onScan`, so the reading loop — which was started once, when
	 * the camera opened — never calls back into a stale version of the page.
	 */
	const onScanRef = useRef(onScan)
	useEffect(() => { onScanRef.current = onScan }, [onScan])

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
		setZoomRange(null)
	}, [])

	// The camera never outlives the screen it was opened from
	useEffect(() => release, [release])

	// A tab switched away from is a camera nobody is looking at. Counting a
	// shelf, the screen locking or a call coming in only puts it down for the
	// moment: coming back picks it up again, still open and with the count
	// kept, rather than making the person press Scan once more.
	useEffect(() => {
		if (!open) return
		const onVisibility = () => {
			if (document.visibilityState === 'hidden') {
				if (continuous) release()
				else setOpen(false)
			} else if (continuous) {
				setRestartNonce(n => n + 1)
			}
		}
		document.addEventListener('visibilitychange', onVisibility)
		return () => document.removeEventListener('visibilitychange', onVisibility)
	}, [open, continuous, release])

	const finish = useCallback((value: string, format = '') => {
		// Counting a shelf: hand it over and keep the picture. The camera is put
		// down by the person, not by the first book it happens to read.
		if (continuous) {
			if (seenRef.current.has(value)) {
				setRepeated(value)
				const last = lastRepeatRef.current
				if (!last || last.value !== value || Date.now() - last.at > 2_500) {
					lastRepeatRef.current = { value, at: Date.now() }
					onRepeatRef.current?.(value)
				}
				return
			}
			seenRef.current.add(value)
			setReadCount(seenRef.current.size)
			setRepeated(null)
			// A phone held against a shelf is not being watched closely
			try { navigator.vibrate?.(30) } catch { /* not every device has it */ }
			onScanRef.current(value, format)
			return
		}

		if (doneRef.current) return
		doneRef.current = true
		release()
		setOpen(false)
		onScanRef.current(value, format)
	}, [continuous, release])

	// The "already counted" note is a flash, not a state to get stuck in
	useEffect(() => {
		if (!repeated) return
		const timer = setTimeout(() => setRepeated(null), 1_500)
		return () => clearTimeout(timer)
	}, [repeated])

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
			// for above — and let "switch" step on from there. Nothing chosen yet
			// is -1, not 0: the first camera in the list is often not the one the
			// browser opened, and starting on it made the first Switch look like
			// it did nothing.
			if (cameraIndex.current < 0 || !devices[cameraIndex.current]) {
				cameraIndex.current = Math.max(0, devices.findIndex(d => d.deviceId === liveId))
			}
			const chosen = devices[cameraIndex.current] ?? devices[0]

			if (!videoRef.current) return
			const video = videoRef.current

			// A full-size picture with the focus kept moving. The accession label
			// on a book is small, and at the camera's default size its bars are a
			// few pixels wide — nothing can read that.
			const constraints: MediaStreamConstraints = {
				video: {
					...(chosen?.deviceId ? { deviceId: { exact: chosen.deviceId } } : { facingMode: { ideal: 'environment' } }),
					width: { ideal: 1920 },
					height: { ideal: 1080 },
					// `focusMode` is real on Android Chrome but not in the DOM types yet
					advanced: [{ focusMode: 'continuous' } as unknown as MediaTrackConstraintSet],
				},
			}

			// The phone's own reader first. Chrome on Android carries one (Google's
			// ML Kit behind it) that reads a small, slightly soft label a hand-held
			// phone cannot focus on — the case ZXing loses. Where the browser has
			// none, ZXing does the reading as before.
			const native = await nativeDetector()
			if (native) {
				const stream = await navigator.mediaDevices.getUserMedia(constraints)
				video.srcObject = stream
				await video.play()

				let stopped = false
				const stop = () => {
					stopped = true
					for (const track of stream.getTracks()) track.stop()
				}
				controlsRef.current = { stop }

				const look = async () => {
					if (stopped || doneRef.current) return
					let justRead = false
					try {
						// Before the first frame has arrived the picture is 0×0, and
						// the detector refuses it
						if (video.readyState >= 2) {
							const codes = await native.detect(video)
							const hit = pick(codes.map(code => ({
								value: (code.rawValue ?? '').trim(),
								format: (code.format ?? '').toLowerCase(),
							})))
							if (hit) {
								// Counting a shelf: the picture stays, and the next look
								// waits a little longer so the book being lifted away is
								// not read a second time on its way out of shot.
								if (!continuous) {
									stop()
									finish(hit.value, hit.format)
									return
								}
								justRead = true
								finish(hit.value, hit.format)
							}
						}
					} catch {
						// A frame it could not read — the usual case, several times a second
					}
					// A book still in shot is dropped by `finish` as already read, so
				// the pause after a read only has to be long enough to swap books
				if (!stopped) window.setTimeout(look, justRead ? 250 : 120)
				}
				void look()
			} else {
				const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
					import('@zxing/browser'),
					import('@zxing/library'),
				])

				// Only the formats the library actually meets, the slower "try
				// harder" pass that reads bars at an angle or under a lamp, and a
				// fresh attempt several times a second rather than every half one.
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

				const controls = await reader.decodeFromConstraints(
					constraints,
					video,
					(result, _error, ctrl) => {
						// A frame with nothing readable in it is the normal case, several
						// times a second, and arrives here as an error worth ignoring.
						if (!result) return
						const hit = pick([{
							value: result.getText().trim(),
							format: String(BarcodeFormat[result.getBarcodeFormat()] ?? '').toLowerCase(),
						}])
						if (!hit) return
						// Counting a shelf: every code is handed over and the reader
						// is left running; a code already counted is dropped inside
						// `finish`, which is what stops the same book firing on every
						// frame it stays in shot for.
						if (!continuous) ctrl.stop()
						finish(hit.value, hit.format)
					}
				)
				controlsRef.current = controls
			}

			// The torch and the zoom belong to the running track, now that there is one
			const track = (video.srcObject as MediaStream | null)?.getVideoTracks()[0]
			const capabilities = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
				torch?: boolean
				zoom?: { min: number; max: number; step?: number }
			}
			setHasTorch(capabilities.torch === true)
			// Zoom is what lets a label be read from a hand's length away, where
			// the phone can focus, instead of pressed up against the lens
			if (capabilities.zoom && capabilities.zoom.max > capabilities.zoom.min) {
				const current = (track?.getSettings?.() as MediaTrackSettings & { zoom?: number } | undefined)?.zoom
				setZoomRange({ min: capabilities.zoom.min, max: capabilities.zoom.max, step: capabilities.zoom.step || 0.1 })
				setZoom(current ?? capabilities.zoom.min)
			}
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
	}, [finish, release, continuous, pick])

	// Opening starts it, closing puts it down, and a switch restarts it. Nothing
	// else does, so the picture is never taken down mid-scan by a render.
	useEffect(() => {
		if (!open) { release(); return }
		void start()
		return release
	}, [open, restartNonce, start, release])

	/**
	 * To the camera on the other side of the phone.
	 *
	 * A phone lists several back lenses — main, wide, macro — so stepping to
	 * the next one in the list often changed nothing anybody could see, and it
	 * took a second press to reach the front. Where the cameras are named, the
	 * step goes to the next one that faces the other way; where they are not,
	 * it steps through the list as before.
	 */
	const switchCamera = () => {
		const devices = devicesRef.current
		if (devices.length < 2) return
		const facing = (device?: MediaDeviceInfo) => {
			const label = (device?.label ?? '').toLowerCase()
			if (/front|user|facing front|selfie/.test(label)) return 'front'
			if (/back|rear|environment|facing back/.test(label)) return 'back'
			return null
		}
		const current = Math.max(0, cameraIndex.current)
		const here = facing(devices[current])
		let next = (current + 1) % devices.length
		if (here) {
			for (let step = 1; step < devices.length; step++) {
				const candidate = (current + step) % devices.length
				const there = facing(devices[candidate])
				if (there && there !== here) { next = candidate; break }
			}
		}
		cameraIndex.current = next
		setRestartNonce(n => n + 1)
	}

	const changeZoom = async (value: number) => {
		setZoom(value)
		const track = (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks()[0]
		if (!track) return
		try {
			// `zoom` is real on Android Chrome but is not in the DOM types yet
			await track.applyConstraints({ advanced: [{ zoom: value }] } as unknown as MediaTrackConstraints)
		} catch {
			setZoomRange(null)
		}
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
							onClick={() => {
								// A fresh session each time it is opened — and only here,
								// so switching camera or torch mid-shelf keeps the count
								seenRef.current = new Set()
								setReadCount(0)
								setRepeated(null)
								setOpen(true)
							}}
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
				<DialogContent
					className="sm:max-w-[440px]"
					// Counting a shelf, the camera stays open until Done. A thumb
					// brushing the screen beside the picture, or Esc, used to close
					// it between two books.
					onPointerDownOutside={e => { if (continuous) e.preventDefault() }}
					onInteractOutside={e => { if (continuous) e.preventDefault() }}
					onEscapeKeyDown={e => { if (continuous) e.preventDefault() }}
				>
					<DialogHeader>
						<DialogTitle>
							{continuous ? 'Keep scanning' : 'Scan with the camera'}
							{continuous && readCount > 0 && (
								<span className="ml-2 text-sm font-normal text-brand-green dark:text-brand-green-400">
									{readCount} scanned
								</span>
							)}
						</DialogTitle>
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

							{/* A book the camera has already counted this time round */}
							{continuous && repeated && (
								<div className="absolute inset-x-0 bottom-0 bg-amber-500/90 px-3 py-1.5 text-center text-xs font-medium text-white">
									{repeated} — already scanned
								</div>
							)}
						</div>
					)}

					{/* What the page would have shown, shown here: on a phone the
					    camera is the whole screen. */}
					{continuous && feed && !problem && (
						<div className="max-h-[150px] overflow-y-auto rounded-md border p-2">{feed}</div>
					)}

					{zoomRange && !problem && (
						<label className="flex items-center gap-2 text-xs text-muted-foreground">
							<ZoomIn className="h-4 w-4 shrink-0" />
							<span className="shrink-0">Zoom</span>
							<input
								type="range"
								min={zoomRange.min}
								max={zoomRange.max}
								step={zoomRange.step}
								value={zoom}
								onChange={e => { void changeZoom(Number(e.target.value)) }}
								className="h-2 min-w-0 flex-1 accent-brand-green"
								aria-label="Zoom"
							/>
							<span className="w-9 shrink-0 text-right tabular-nums">{zoom.toFixed(1)}×</span>
						</label>
					)}

					<div className="flex flex-wrap items-center gap-2">
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
						{continuous && readCount > 0 && !problem && (
							// Forget what this camera has read, so a book can be read
							// again and answered afresh instead of "already scanned"
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => {
									seenRef.current = new Set()
									lastRepeatRef.current = null
									setReadCount(0)
									setRepeated(null)
								}}
							>
								<RotateCcw className="mr-1.5 h-4 w-4" />
								Clear
							</Button>
						)}
						{continuous ? (
							<Button
								type="button"
								size="sm"
								className="ml-auto bg-brand-green text-white hover:bg-brand-green-600 dark:bg-brand-green-400 dark:text-brand-green-900 dark:hover:bg-brand-green-500"
								onClick={() => setOpen(false)}
							>
								Done{readCount > 0 ? ` (${readCount})` : ''}
							</Button>
						) : (
							<Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => setOpen(false)}>
								Close
							</Button>
						)}
					</div>
				</DialogContent>
			</Dialog>
		</>
	)
}
