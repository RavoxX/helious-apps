import React from 'react';
import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Heading,
  Text,
  Button,
  Link,
  Hr,
} from '@react-email/components';
import { render } from '@react-email/render';
import { Resend } from 'resend';
import type { Config } from './config.js';

export type EmailKind = 'verification' | 'password-reset' | 'password-changed' | 'email-changed';
export interface EmailMessage {
  to: string;
  kind: EmailKind;
  subject: string;
  html: string;
  text: string;
}
export interface EmailService {
  send(message: EmailMessage): Promise<void>;
}
export class MemoryEmailService implements EmailService {
  readonly messages: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.messages.push(message);
  }
}
const copy = {
  verification: {
    title: 'A home for your thoughts.',
    subject: 'Verify your Helious email',
    body: 'Confirm your email address to open your Helious workspace. This link expires in exactly 30 minutes and can be used once.',
    button: 'Verify email',
  },
  'password-reset': {
    title: 'A fresh start.',
    subject: 'Reset your Helious password',
    body: 'Use the link below to choose a new password. It expires in exactly 30 minutes and can be used once. If you did not request this, you can ignore this email.',
    button: 'Reset password',
  },
  'password-changed': {
    title: 'Your password was changed.',
    subject: 'Your Helious password was changed',
    body: 'Your password has been updated and every browser session has been signed out. Review any existing agent or MCP tokens. If this was not you, reset your password immediately and contact your instance administrator.',
    button: 'Review your account',
  },
  'email-changed': {
    title: 'Your email was changed.',
    subject: 'Your Helious email address was changed',
    body: 'The email address on your Helious account has been changed. If this was not you, contact your instance administrator immediately.',
    button: 'Open Helious',
  },
};
export async function emailMessage(
  to: string,
  kind: EmailKind,
  url: string,
): Promise<EmailMessage> {
  const content = copy[kind];
  const template = React.createElement(() => (
    <Html lang="en">
      <Head />
      <Preview>{content.subject}</Preview>
      <Body
        style={{
          backgroundColor: '#f4f9fb',
          color: '#111a22',
          fontFamily: 'Arial, sans-serif',
          margin: '0',
          padding: '32px 16px',
        }}
      >
        <Container
          style={{
            maxWidth: '480px',
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            padding: '32px',
          }}
        >
          <Text style={{ color: '#1675db', fontSize: '22px', fontWeight: 700 }}>helious.</Text>
          <Heading style={{ fontSize: '27px', fontWeight: 500, lineHeight: '1.25' }}>
            {content.title}
          </Heading>
          <Text style={{ fontSize: '15px', lineHeight: '1.8', color: '#4d5d6b' }}>
            {content.body}
          </Text>
          <Button
            href={url}
            style={{
              backgroundColor: '#101a24',
              color: '#ffffff',
              borderRadius: '7px',
              padding: '14px 20px',
              fontSize: '14px',
            }}
          >
            {content.button}
          </Button>
          <Text style={{ fontSize: '12px', color: '#4d5d6b', marginTop: '24px' }}>
            Or copy this link into your browser:
          </Text>
          <Link href={url} style={{ fontSize: '12px', color: '#1675db', wordBreak: 'break-all' }}>
            {url}
          </Link>
          <Hr style={{ borderColor: '#e5ebef', marginTop: '28px' }} />
          <Text style={{ fontSize: '11px', lineHeight: '1.6', color: '#4d5d6b' }}>
            Your knowledge. Your choices. Your space.
            <br />
            An account message from your Helious instance.
          </Text>
        </Container>
      </Body>
    </Html>
  ));
  return {
    to,
    kind,
    subject: content.subject,
    html: await render(template),
    text: await render(template, { plainText: true }),
  };
}
export function createEmailService(config: Config): EmailService {
  if (!config.RESEND_API_KEY) {
    if (config.NODE_ENV !== 'development')
      throw new Error(
        'RESEND_API_KEY is required outside development; inject a mocked EmailService in tests',
      );
    return {
      async send(message) {
        console.info(
          `[Helious development email] To: ${message.to}\n${message.subject}\n${message.text}`,
        );
      },
    };
  }
  const client = new Resend(config.RESEND_API_KEY);
  return {
    async send(message) {
      const { error } = await client.emails.send({
        from: config.EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(config.EMAIL_REPLY_TO ? { replyTo: config.EMAIL_REPLY_TO } : {}),
      });
      if (error) throw new Error('Email provider rejected delivery');
    },
  };
}
