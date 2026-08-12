'use client'

/**
 * "Send Reminders" — librarian-triggered reminder emails.
 *
 * Confirms first (showing how many members will actually be emailed), then
 * sends and reports what happened, including anyone skipped for having no
 * email address on record.
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
	AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
	AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/common/use-toast'
import { Mail, Loader2 } from 'lucide-react'

interface SendRemindersButtonProps {
	institutionId: string | null
	type: 'overdue' | 'hold_available'
	/** Refresh the page data after sending */
	onSent?: () => void
	disabled?: boolean
}

interface SendResult {
	sent?: number
	failed?: number
	skipped?: number
	would_send?: number
	message?: string
	results?: { member: string; email: string; status: string; reason?: string }[]
}

export function SendRemindersButton({ institutionId, type, onSent, disabled }: SendRemindersButtonProps) {
	const { toast } = useToast()
	const [confirmOpen, setConfirmOpen] = useState(false)
	const [checking, setChecking] = useState(false)
	const [sending, setSending] = useState(false)
	const [preview, setPreview] = useState<SendResult | null>(null)

	const label = type === 'overdue' ? 'Send Overdue Reminders' : 'Notify Hold Members'

	const post = async (dryRun: boolean): Promise<SendResult> => {
		const res = await fetch('/api/lib/notifications/send-reminders', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ institution_id: institutionId, type, dry_run: dryRun }),
		})
		const json = await res.json()
		if (!res.ok) throw new Error(json.error || 'Failed to send reminders')
		return json
	}

	// Count recipients before sending anything
	const handleOpen = async () => {
		if (!institutionId) {
			toast({ title: 'Select an institution first', variant: 'destructive' })
			return
		}
		try {
			setChecking(true)
			setPreview(await post(true))
			setConfirmOpen(true)
		} catch (err) {
			toast({
				title: '❌ ' + (err instanceof Error ? err.message : 'Could not check recipients'),
				variant: 'destructive',
			})
		} finally {
			setChecking(false)
		}
	}

	const handleSend = async () => {
		try {
			setSending(true)
			const result = await post(false)
			const sent = result.sent ?? 0
			const failed = result.failed ?? 0
			const skipped = result.skipped ?? 0

			if (sent > 0) {
				toast({
					title: `✅ ${sent} reminder${sent === 1 ? '' : 's'} sent`,
					description: [
						failed > 0 ? `${failed} failed` : '',
						skipped > 0 ? `${skipped} skipped (no email on record)` : '',
					].filter(Boolean).join(' · ') || undefined,
					className: 'bg-brand-green-50 border-brand-green-200 text-brand-green-800 dark:bg-brand-green-900/30 dark:border-brand-green-700 dark:text-brand-green-300',
				})
			} else {
				// Nothing sent — surface the first real reason rather than a bare failure
				const reason = result.results?.find(r => r.reason)?.reason
				toast({
					title: '❌ No reminders were sent',
					description: reason || result.message,
					variant: 'destructive',
				})
			}

			setConfirmOpen(false)
			onSent?.()
		} catch (err) {
			toast({
				title: '❌ ' + (err instanceof Error ? err.message : 'Failed to send reminders'),
				variant: 'destructive',
			})
		} finally {
			setSending(false)
		}
	}

	const wouldSend = preview?.would_send ?? 0
	const wouldSkip = preview?.skipped ?? 0

	return (
		<>
			<Button
				variant="outline"
				size="sm"
				className="h-8 text-sm"
				onClick={handleOpen}
				disabled={disabled || checking || !institutionId}
			>
				{checking
					? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
					: <Mail className="h-4 w-4 mr-1.5" />}
				<span className="hidden sm:inline">{label}</span>
				<span className="sm:hidden">Remind</span>
			</Button>

			<AlertDialog open={confirmOpen} onOpenChange={o => { if (!sending) setConfirmOpen(o) }}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle className="font-heading">{label}</AlertDialogTitle>
						<AlertDialogDescription>
							{wouldSend === 0 ? (
								wouldSkip > 0
									? `Nobody can be emailed — ${wouldSkip} member${wouldSkip === 1 ? ' has' : 's have'} no email address on record.`
									: 'There is nobody to remind right now.'
							) : (
								<>
									This will email <strong>{wouldSend}</strong> member{wouldSend === 1 ? '' : 's'}.
									{wouldSkip > 0 && ` ${wouldSkip} will be skipped for having no email address on record.`}
								</>
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={sending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={e => { e.preventDefault(); handleSend() }}
							disabled={sending || wouldSend === 0}
							className="bg-brand-green hover:bg-brand-green-600 text-white dark:bg-brand-green-400 dark:hover:bg-brand-green-500 dark:text-brand-green-900"
						>
							{sending ? 'Sending...' : `Send ${wouldSend || ''}`.trim()}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}
