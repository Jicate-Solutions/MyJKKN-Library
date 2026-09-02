'use client'

/**
 * Lets the bug button be dragged out of the way.
 *
 * The button sits bottom-right on every page, which is also where a page's own
 * last control tends to be — the Save button of a form, the last row's menu on
 * the register. A librarian who finds it in the way can now pick it up and put
 * it anywhere on the screen, with a mouse or a finger. A plain click still
 * opens the reporter: a press that moves less than a few pixels is a click, and
 * only a real drag moves the button.
 *
 * Where it was put is kept in memory and nowhere else — deliberately. Moving
 * between pages keeps it where it was left, because the layout that holds the
 * button never unmounts on the way; a page refresh starts over in the corner,
 * which is what was asked for and also what makes "where did it go" impossible.
 *
 * The button itself is drawn by the bug-reporter SDK, which offers no way to
 * place or drag it. So this reaches for the element the SDK draws and handles
 * the pointer on it directly, and touches nothing inside the SDK:
 *
 *   * Placed with `left`/`top` rather than `transform`, because the SDK's own
 *     hover style sets `transform: scale(1.1) !important` — a translate would
 *     be thrown away the moment the mouse arrived, and the button would jump
 *     back to the corner on every hover.
 *   * Written as inline `!important`, because the SDK's phone stylesheet pins
 *     `bottom`/`right` with `!important` of its own, and only an inline
 *     `!important` outranks that.
 *   * Found by a MutationObserver, because the SDK draws the button after the
 *     app has signed the person in, and can draw it again after that.
 */

import { useEffect } from 'react'

/** The SDK's own class on the floating button — the same one the user menu clicks. */
const BUTTON_SELECTOR = '.bug-reporter-floating-btn'

/** A press that travels less than this is a click, not a drag. */
const DRAG_THRESHOLD_PX = 6

/** Kept off the very edge, so it can always be picked up again. */
const EDGE_MARGIN_PX = 8

/** Marks a button this has already taken hold of, so a re-render is not wired twice. */
const WIRED = 'dragWired'

interface Spot {
	left: number
	top: number
}

/**
 * Where the button was left. Module-level on purpose: it lives exactly as long
 * as the loaded page — across every client-side navigation, and not one
 * refresh longer.
 */
let placed: Spot | null = null

/** Keeps the whole button on screen, whatever the window is now. */
function clamp(spot: Spot, button: HTMLElement): Spot {
	const maxLeft = window.innerWidth - button.offsetWidth - EDGE_MARGIN_PX
	const maxTop = window.innerHeight - button.offsetHeight - EDGE_MARGIN_PX
	return {
		left: Math.min(Math.max(EDGE_MARGIN_PX, spot.left), Math.max(EDGE_MARGIN_PX, maxLeft)),
		top: Math.min(Math.max(EDGE_MARGIN_PX, spot.top), Math.max(EDGE_MARGIN_PX, maxTop)),
	}
}

/** Puts the button where `placed` says, or leaves it in the SDK's corner when nothing was placed. */
function apply(button: HTMLElement) {
	if (!placed) return
	const spot = clamp(placed, button)
	placed = spot
	button.style.setProperty('left', `${spot.left}px`, 'important')
	button.style.setProperty('top', `${spot.top}px`, 'important')
	button.style.setProperty('right', 'auto', 'important')
	button.style.setProperty('bottom', 'auto', 'important')
}

function wire(button: HTMLElement) {
	if (button.dataset[WIRED]) return
	button.dataset[WIRED] = 'yes'

	// The browser must not scroll the page while a finger drags the button
	button.style.touchAction = 'none'

	let pointerId: number | null = null
	let startX = 0
	let startY = 0
	let originLeft = 0
	let originTop = 0
	let dragging = false
	/** Set by a drag, read once by the click that follows it, then cleared. */
	let swallowNextClick = false

	const onPointerDown = (event: PointerEvent) => {
		// Only the main button, and only one pointer at a time
		if (event.button !== 0 || pointerId !== null) return
		pointerId = event.pointerId
		startX = event.clientX
		startY = event.clientY
		const rect = button.getBoundingClientRect()
		originLeft = rect.left
		originTop = rect.top
		dragging = false
		// Capture keeps the moves coming even when the pointer outruns the button.
		// Guarded: a browser that will not grant it still gets a working drag,
		// just one that lets go if the pointer leaves the button.
		try { button.setPointerCapture(event.pointerId) } catch { /* see above */ }
	}

	const onPointerMove = (event: PointerEvent) => {
		if (event.pointerId !== pointerId) return
		const dx = event.clientX - startX
		const dy = event.clientY - startY

		if (!dragging) {
			if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return
			dragging = true
			// The SDK eases every style change over 0.3s, which would make the
			// button trail the finger. Off for the drag, back afterwards.
			button.style.setProperty('transition', 'none', 'important')
			button.style.cursor = 'grabbing'
		}

		placed = { left: originLeft + dx, top: originTop + dy }
		apply(button)
	}

	const finish = (event: PointerEvent) => {
		if (event.pointerId !== pointerId) return
		pointerId = null
		try { button.releasePointerCapture(event.pointerId) } catch { /* never held */ }
		if (dragging) {
			dragging = false
			swallowNextClick = true
			button.style.removeProperty('transition')
			button.style.cursor = ''
		}
	}

	// Runs before the SDK's own click handler, which listens higher up the
	// tree. A drag ends with a click the browser makes on its own; letting it
	// through would open the reporter every time the button was moved.
	const onClick = (event: MouseEvent) => {
		if (!swallowNextClick) return
		swallowNextClick = false
		event.preventDefault()
		event.stopPropagation()
	}

	button.addEventListener('pointerdown', onPointerDown)
	button.addEventListener('pointermove', onPointerMove)
	button.addEventListener('pointerup', finish)
	button.addEventListener('pointercancel', finish)
	button.addEventListener('click', onClick, true)

	apply(button)
}

export function BugButtonDrag() {
	useEffect(() => {
		const lookForButton = () => {
			const button = document.querySelector<HTMLElement>(BUTTON_SELECTOR)
			if (button) wire(button)
		}

		lookForButton()

		// The SDK draws the button once the person is signed in, and may draw it
		// again — a new element each time, which needs taking hold of again.
		const observer = new MutationObserver(lookForButton)
		observer.observe(document.body, { childList: true, subtree: true })

		// A window made smaller must not leave the button off-screen
		const onResize = () => {
			const button = document.querySelector<HTMLElement>(BUTTON_SELECTOR)
			if (button) apply(button)
		}
		window.addEventListener('resize', onResize)

		return () => {
			observer.disconnect()
			window.removeEventListener('resize', onResize)
		}
	}, [])

	return null
}
