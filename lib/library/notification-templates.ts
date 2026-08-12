/**
 * Email templates for library reminders.
 *
 * Plain, self-contained HTML — email clients strip <style> blocks and external
 * CSS, so every rule is inline. Brand green (#0b6d41) matches the app.
 */

const BRAND_GREEN = '#0b6d41'
const BRAND_YELLOW = '#ffde59'

interface Shell {
	heading: string
	accent: string
	body: string
	footer?: string
}

function wrap({ heading, accent, body, footer }: Shell): string {
	return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#f5f5f0;font-family:Arial,Helvetica,sans-serif;color:#15181f;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e3e6ee;">
    <tr>
      <td style="background:${accent};padding:20px 24px;">
        <div style="color:#ffffff;font-size:18px;font-weight:bold;">JKKN Learning Commons</div>
        <div style="color:#ffffff;opacity:.85;font-size:13px;margin-top:2px;">Library System</div>
      </td>
    </tr>
    <tr>
      <td style="padding:24px;">
        <h2 style="margin:0 0 12px;font-size:17px;color:#15181f;">${heading}</h2>
        ${body}
      </td>
    </tr>
    <tr>
      <td style="padding:14px 24px;background:#fafafa;border-top:1px solid #e3e6ee;font-size:12px;color:#5c6472;">
        ${footer ?? 'This is an automated message from the JKKN Library. Please do not reply to this email.'}
      </td>
    </tr>
  </table>
</body>
</html>`
}

function itemRow(label: string, value: string): string {
	return `<tr>
    <td style="padding:6px 12px 6px 0;font-size:13px;color:#5c6472;white-space:nowrap;">${label}</td>
    <td style="padding:6px 0;font-size:13px;font-weight:bold;color:#15181f;">${escapeHtml(value)}</td>
  </tr>`
}

/** Values come from the database and land inside HTML — escape them. */
export function escapeHtml(value: string): string {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

export interface OverdueEmailInput {
	memberName: string
	title: string
	accessionNumber?: string | null
	dueDate: string
	overdueDays: number
	estimatedCharge?: number | null
}

export function overdueReminderEmail(input: OverdueEmailInput): { subject: string; html: string } {
	const { memberName, title, accessionNumber, dueDate, overdueDays, estimatedCharge } = input

	const chargeLine = typeof estimatedCharge === 'number' && estimatedCharge > 0
		? itemRow('Late charge so far', `₹${estimatedCharge.toFixed(2)}`)
		: ''

	const html = wrap({
		heading: `Your borrowed book is ${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue`,
		accent: BRAND_GREEN,
		body: `
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">
        Dear ${escapeHtml(memberName)},<br>
        The following item is past its due date. Please return it to the library at your earliest convenience.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
        ${itemRow('Title', title)}
        ${accessionNumber ? itemRow('Accession no.', accessionNumber) : ''}
        ${itemRow('Due date', dueDate)}
        ${itemRow('Days overdue', String(overdueDays))}
        ${chargeLine}
      </table>
      <p style="margin:0;font-size:13px;color:#5c6472;line-height:1.6;">
        Late charges continue to accrue until the item is returned. If you have already returned it, please ignore this message.
      </p>`,
	})

	return { subject: `Library reminder: "${title}" is ${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue`, html }
}

export interface HoldEmailInput {
	memberName: string
	title: string
	accessionNumber?: string | null
	expiryDate?: string | null
}

export function holdAvailableEmail(input: HoldEmailInput): { subject: string; html: string } {
	const { memberName, title, accessionNumber, expiryDate } = input

	const html = wrap({
		heading: 'The book you reserved is ready for collection',
		accent: BRAND_GREEN,
		body: `
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">
        Dear ${escapeHtml(memberName)},<br>
        The item you placed on hold is now available and has been set aside for you at the circulation desk.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
        ${itemRow('Title', title)}
        ${accessionNumber ? itemRow('Accession no.', accessionNumber) : ''}
        ${expiryDate ? itemRow('Collect before', expiryDate) : ''}
      </table>
      <p style="margin:0;padding:10px 12px;background:${BRAND_YELLOW}33;border-left:3px solid ${BRAND_YELLOW};font-size:13px;line-height:1.6;">
        Please collect it soon — uncollected holds are released to the next member waiting.
      </p>`,
	})

	return { subject: `Ready for collection: "${title}"`, html }
}
