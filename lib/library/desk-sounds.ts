/**
 * The two sounds a counter with a scanner runs on.
 *
 * A short high beep when a scan went through and a low buzz when it was
 * refused. The librarian is looking at the book or the learner, not the
 * screen, and a toast is gone before they look up — the sound is what tells
 * them whether to reach for the next book or read the screen.
 *
 * Made with the Web Audio API rather than a sound file, so there is nothing
 * to load and nothing the content policy can block. The context is created on
 * the first sound, which always follows a key press or a click, so browsers
 * that require a gesture before audio are satisfied.
 */

const MUTE_KEY = 'lib:desk:sound'

let context: AudioContext | null = null

function audio(): AudioContext | null {
	if (typeof window === 'undefined') return null
	try {
		if (!context) {
			const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
			if (!Ctor) return null
			context = new Ctor()
		}
		if (context.state === 'suspended') void context.resume().catch(() => {})
		return context
	} catch {
		return null
	}
}

function tone(frequency: number, ms: number, type: OscillatorType, startAt = 0, gain = 0.08) {
	const ctx = audio()
	if (!ctx) return
	try {
		const oscillator = ctx.createOscillator()
		const volume = ctx.createGain()
		oscillator.type = type
		oscillator.frequency.value = frequency
		volume.gain.value = gain
		oscillator.connect(volume)
		volume.connect(ctx.destination)
		const start = ctx.currentTime + startAt
		oscillator.start(start)
		// Fade out over the last few milliseconds so the tone does not click off
		volume.gain.setValueAtTime(gain, start + ms / 1000 - 0.01)
		volume.gain.linearRampToValueAtTime(0, start + ms / 1000)
		oscillator.stop(start + ms / 1000)
	} catch {
		// A sound that cannot play is not an error the desk needs to hear about
	}
}

export function isDeskMuted(): boolean {
	try {
		return window.localStorage.getItem(MUTE_KEY) === 'off'
	} catch {
		return false
	}
}

export function setDeskMuted(muted: boolean): void {
	try {
		window.localStorage.setItem(MUTE_KEY, muted ? 'off' : 'on')
	} catch {
		// Storage refused: the choice lasts for this visit only
	}
}

/** Went through. */
export function deskBeep(): void {
	if (isDeskMuted()) return
	tone(1318, 90, 'sine')
}

/** Refused, or failed. */
export function deskBuzz(): void {
	if (isDeskMuted()) return
	tone(220, 160, 'square', 0, 0.05)
	tone(196, 200, 'square', 0.17, 0.05)
}
