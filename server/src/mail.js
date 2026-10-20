import nodemailer from 'nodemailer';

// When SMTP_URL is unset nothing is sent; the dashboard shows the signing links instead.
export function createMailer({ smtpUrl, from }) {
  const transport = smtpUrl ? nodemailer.createTransport(smtpUrl) : null;
  return {
    configured: !!transport,
    async send({ to, subject, text, attachments, replyTo }) {
      if (!transport) {
        console.log(`mail not configured; would send "${subject}" to ${to}`);
        return false;
      }
      await transport.sendMail({ from, to, subject, text, attachments, replyTo: replyTo || undefined });
      return true;
    }
  };
}

export function signingRequestMail({ senderName, title, message, url }) {
  return {
    subject: `${senderName || 'Someone'} sent you a document to sign: ${title}`,
    text: [
      `${senderName || 'The sender'} has asked you to review and sign "${title}".`,
      '',
      message ? message + '\n' : '',
      `Open your signing link: ${url}`,
      '',
      'This link is personal to you and expires 30 days after it was issued. Do not forward it.'
    ].join('\n')
  };
}

export function completionMail({ title, envelopeId }) {
  return {
    subject: `Completed: ${title}`,
    text: [
      `Every signer has completed "${title}".`,
      `The completed document is attached. Envelope ID: ${envelopeId}.`
    ].join('\n')
  };
}
