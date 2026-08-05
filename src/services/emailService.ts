import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: false,
  auth: process.env.SMTP_USER
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
    : undefined,
});

export async function sendMagicLinkEmail(toEmail: string, link: string): Promise<void> {
  const ttl = process.env.MAGIC_LINK_TTL_MINUTES ?? '15';
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: toEmail,
    subject: 'Your RyderCup Bets sign-in link',
    text: `Click to sign in: ${link}\n\nThis link expires in ${ttl} minutes.`,
    html: `<p><a href="${link}">Click here to sign in</a></p><p>This link expires in ${ttl} minutes.</p>`,
  });
}
