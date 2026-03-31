import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
	host: process.env.SMTP_HOST || 'smtp.gmail.com',
	port: Number(process.env.SMTP_PORT) || 587,
	secure: false,
	auth: {
		user: process.env.SMTP_USER,
		pass: process.env.SMTP_PASS,
	},
})

export async function sendVerificationEmail(email: string, code: string): Promise<void> {
	await transporter.sendMail({
		from: process.env.SMTP_FROM || 'noreply@jkkn.edu.in',
		to: email,
		subject: 'Email Verification - JKKN Learning Commons',
		html: `<p>Your verification code is: <strong>${code}</strong></p><p>This code expires in 10 minutes.</p>`,
	})
}

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
	await transporter.sendMail({
		from: process.env.SMTP_FROM || 'noreply@jkkn.edu.in',
		to,
		subject,
		html,
	})
}
