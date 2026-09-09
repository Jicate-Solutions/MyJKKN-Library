'use client'

/**
 * Keeps the cursor sitting in the scan box — the gate's, and the desk's.
 *
 * A barcode scanner is only a keyboard: whatever has focus receives the card
 * number. At the door there is a queue, one scanner and no free hand for the
 * mouse, so the box must take the next card without anybody putting the cursor
 * back — after a scan, after the Record button was clicked, after the register
 * refreshed, after a stray click on the page. The circulation desk is the same
 * job with a queue of books instead.
 *
 * It gives the cursor up willingly, though. If the librarian is typing in the
 * search box, picking a date, or answering a dialog, that field keeps the
 * cursor until they are done with it.
 */

import { useCallback, useEffect, useRef } from 'react'

/** Fields that own the cursor while they are being used — never taken from. */
const OWNS_CURSOR = 'input, textarea, select, [contenteditable="true"]'

/** While one of these is open the cursor belongs to it, not to the door. */
const OPEN_OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

/**
 * Long enough for a dialog or menu to have claimed the cursor before we check
 * whether it is ours to take, short enough that nobody at the door notices.
 */
const SETTLE_MS = 60

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

	// Focus that drifts anywhere else comes back on its own
	useEffect(() => {
		if (!active) return

		let timer: ReturnType<typeof setTimeout> | undefined
		const restore = () => {
			if (timer) clearTimeout(timer)
			timer = setTimeout(focusScanBox, SETTLE_MS)
		}

		const box = inputRef.current
		box?.addEventListener('blur', restore)
		document.addEventListener('click', restore)
		window.addEventListener('focus', restore)
		// Tabs are also switched from the keyboard (Alt+1/2/3, F1–F3), which no
		// click ever sees. Any key is enough of a signal to put the cursor back
		// where cards are typed — and a key pressed inside a field somebody is
		// using is refused above, so typing a name is never interrupted.
		document.addEventListener('keydown', restore)

		return () => {
			if (timer) clearTimeout(timer)
			box?.removeEventListener('blur', restore)
			document.removeEventListener('click', restore)
			window.removeEventListener('focus', restore)
			document.removeEventListener('keydown', restore)
		}
	}, [active, focusScanBox])

	return { inputRef, focusScanBox }
}
