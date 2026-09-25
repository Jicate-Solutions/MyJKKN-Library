'use client'

/**
 * Keeps the cursor sitting in the scan box — the gate's, and the desk's.
 *
 * A barcode scanner is only a keyboard: whatever has focus receives the card
 * number. At the door there is a queue, one scanner and no free hand for the
 * mouse, so the box must take the next card without anybody putting the cursor
 * back — after a scan, after the Record button was clicked, after the register
 * refreshed. The circulation desk is the same job with a queue of books.
 *
 * It gives the cursor up willingly, though, and this is where the first version
 * went wrong: it put the cursor back sixty milliseconds after EVERY click and
 * EVERY keystroke anywhere on the page. Clicking a line to read it, or double
 * clicking a roll number to copy it, threw the cursor into the scan box and
 * cleared the selection — the screen could not be used for anything but
 * scanning.
 *
 * So the cursor is taken back on two occasions only:
 *
 *   * a button, link or tab was pressed — the work is done and the next card is
 *     what comes next; and
 *   * the cursor is sitting on nothing at all, which is what a stray click on
 *     empty space leaves behind.
 *
 * And never while a dialog is open, while text is selected, while somebody is
 * typing in another field, or when the click was a double click — that is
 * somebody selecting a word, not asking for the scan box.
 */

import { useCallback, useEffect, useRef } from 'react'

/** Fields that own the cursor while they are being used — never taken from. */
const OWNS_CURSOR = 'input, textarea, select, [contenteditable="true"]'

/** While one of these is open the cursor belongs to it, not to the door. */
const OPEN_OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

/** Pressing one of these ends a piece of work; the next card comes after it. */
const ACTIONS = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], summary'

/**
 * Long enough for a dialog or menu to have claimed the cursor before we check
 * whether it is ours to take, short enough that nobody at the door notices.
 */
const SETTLE_MS = 60

/**
 * The wait after a click that landed on nothing.
 *
 * Longer than the browser's double-click window, so the second click of
 * somebody selecting a roll number to copy it arrives first and the selection
 * it makes is seen. Nobody waiting to scan notices a third of a second.
 */
const IDLE_MS = 350

export function useScanFocus(active: boolean) {
	const inputRef = useRef<HTMLInputElement>(null)

	const focusScanBox = useCallback(() => {
		if (!active) return
		const box = inputRef.current
		if (!box || box.disabled) return

		// A box on a tab that is not showing.
		//
		// The desk keeps all three tabs mounted so switching between them loses
		// nothing, which means Issue, Return and Renew each have a scan box in
		// the page at once and only one of them is on screen. Without this they
		// would take the cursor from each other and the card would be typed into
		// a hidden box. `offsetParent` is null exactly when the box, or anything
		// it sits inside, is display:none — which is how the hidden tabs are
		// hidden. A box that is always visible, like the gate's, never sees this.
		if (box.offsetParent === null) return

		// Something is open on top of the page — leave its cursor alone
		if (document.querySelector(OPEN_OVERLAY)) return

		const current = document.activeElement
		if (current === box) return
		// Somebody is typing somewhere else on purpose
		if (current instanceof HTMLElement && current.closest(OWNS_CURSOR)) return
		// Text is being selected to copy — taking the cursor would clear it
		const selection = window.getSelection()
		if (selection && selection.toString().trim()) return

		box.focus()
		const end = box.value.length
		box.setSelectionRange(end, end)
	}, [active])

	// On arrival, and again the moment scanning becomes possible
	useEffect(() => { focusScanBox() }, [focusScanBox])

	// The two occasions the cursor comes back on its own
	useEffect(() => {
		if (!active) return

		let timer: ReturnType<typeof setTimeout> | undefined
		const soon = (wait = SETTLE_MS) => {
			if (timer) clearTimeout(timer)
			timer = setTimeout(focusScanBox, wait)
		}

		/** True while the cursor is on nothing — the page body, or lost entirely. */
		const onNothing = () => {
			const current = document.activeElement
			return !current || current === document.body || current === document.documentElement
		}

		const onClick = (event: MouseEvent) => {
			// A double click is somebody selecting a word to copy it. Any pending
			// restore is dropped as well, or it would clear that selection.
			if (event.detail > 1) { if (timer) clearTimeout(timer); return }
			const target = event.target instanceof HTMLElement ? event.target : null
			if (target?.closest(OWNS_CURSOR)) return
			if (target?.closest(ACTIONS)) { soon(); return }
			// A click on plain text, a card or a table row leaves the cursor
			// nowhere; only then is it ours to take back, and not before the
			// second click of a double click would have arrived.
			soon(IDLE_MS)
		}

		// The box losing the cursor to nothing at all — a line that vanished from
		// under it, say — brings it back. Losing it to a button or another field
		// does not: that is where the work is, and the click above decides.
		const onBlur = () => { if (onNothing()) soon(IDLE_MS) }

		// Coming back to this browser tab with cards still to scan
		const onWindowFocus = () => { if (onNothing()) soon() }

		const box = inputRef.current
		box?.addEventListener('blur', onBlur)
		document.addEventListener('click', onClick)
		window.addEventListener('focus', onWindowFocus)

		return () => {
			if (timer) clearTimeout(timer)
			box?.removeEventListener('blur', onBlur)
			document.removeEventListener('click', onClick)
			window.removeEventListener('focus', onWindowFocus)
		}
	}, [active, focusScanBox])

	return { inputRef, focusScanBox }
}
