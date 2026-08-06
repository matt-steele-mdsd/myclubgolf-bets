import nodemailer from 'nodemailer';

const smtpPort = Number(process.env.SMTP_PORT ?? 587);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: smtpPort,
  secure: smtpPort === 465, // implicit TLS on 465; STARTTLS (secure: false) on 587/others
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

export async function sendBetAcceptedEmail(toEmail: string, description: string, amount: string): Promise<void> {
  const betsUrl = `${process.env.APP_BASE_URL}/bets`;
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: toEmail,
    subject: 'Your bet was accepted',
    text: `Someone accepted your bet: "${description}" for $${amount}.\n\nView it: ${betsUrl}`,
    html: `<p>Someone accepted your bet: <strong>${description}</strong> for $${amount}.</p><p><a href="${betsUrl}">View it</a></p>`,
  });
}

export async function sendApprovedEmail(toEmail: string): Promise<void> {
  const loginUrl = `${process.env.APP_BASE_URL}/login`;
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: toEmail,
    subject: "You're approved for RyderCup Bets",
    text: `You're approved to place bets. Sign in here: ${loginUrl}`,
    html: `<p>You're approved to place bets.</p><p><a href="${loginUrl}">Sign in here</a></p>`,
  });
}

export async function sendBetSettledEmail(
  toEmail: string,
  description: string,
  amount: string,
  winner: 'requester' | 'accepter' | 'push',
  perspective: 'requester' | 'accepter'
): Promise<void> {
  const outcome = winner === 'push' ? 'Pushed — no winner.' : winner === perspective ? 'You won!' : 'You lost.';
  const betsUrl = `${process.env.APP_BASE_URL}/bets`;
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: toEmail,
    subject: `Bet settled: ${outcome}`,
    text: `Your bet "${description}" for $${amount} has been settled.\n\n${outcome}\n\nView it: ${betsUrl}`,
    html: `<p>Your bet <strong>${description}</strong> for $${amount} has been settled.</p><p><strong>${outcome}</strong></p><p><a href="${betsUrl}">View it</a></p>`,
  });
}
