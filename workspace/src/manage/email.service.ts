import { Injectable, OnModuleInit } from '@nestjs/common';
import { AccessRequestPayload } from 'hide-common';
import { createTransport, Transporter } from 'nodemailer';

@Injectable()
export class EmailService implements OnModuleInit {
  transporter: Transporter;

  constructor() {}

  onModuleInit() {
    this.setupMail();
  }

  setupMail() {
    this.transporter = createTransport({
      host: 'smtp.azurecomm.net',
      port: 587,
      secure: false,
      auth: {
        user: process.env.AZURE_COMM_EMAIL_USERNAME!,
        pass: process.env.AZURE_CS_SMTP_SECRET!,
      },
    });
  }

  async sendAccessRequestEmail(to: string, req: AccessRequestPayload, token: string) {
    const text = `H-IDE: Request from @${req.username} for a dedicated workspace`;
    const html = `
    <h2>Request for access code</h2>
    <span>Username: ${req.username}</span><br/>
    <span>Name: ${req.name}</span><br/>
    <span>Reason: <br/>${req.reason ?? 'NA'}</span>
    <br/>
    <br/>
    <a href="${process.env.WEBHOOK_URL}/access-fulfill?action=approve&token=${token}"><button>Approve</button></a>&nbsp;
    <a href="${process.env.WEBHOOK_URL}/access-fulfill?action=reject&token=${token}"><button>Reject</button></a>
    `;

    const mailOptions = {
      from: '"H-IDE" <DoNotReply@hide.saurabhagat.me>',
      to,
      subject: 'H-IDE: Access request received',
      text,
      html,
    };

    await this.transporter.sendMail(mailOptions);
  }
}
