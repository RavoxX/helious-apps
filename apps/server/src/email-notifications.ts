import { ObjectId, type Db } from 'mongodb';
import { emailMessage, type EmailService } from './email.js';
import { EmailTokens } from './email-tokens.js';

type Kind = 'password-changed' | 'email-changed';
interface Notification {
  _id: ObjectId;
  to: string;
  kind: Kind;
  url: string;
  createdAt: Date;
  nextAttemptAt: Date;
  leaseUntil?: Date;
}

/** Durable security notices contain no verification/reset token or password. */
export class EmailNotifications {
  private running: Promise<void> | null = null;
  constructor(
    private readonly db: Db,
    private readonly mail: EmailService,
    private readonly failed: () => void,
  ) {}
  async initialize() {
    await this.db.collection<Notification>('email_notifications').createIndex({ nextAttemptAt: 1 });
  }
  async send(to: string, kind: Kind, url: string) {
    const now = new Date();
    const notice: Notification = {
      _id: new ObjectId(),
      to,
      kind,
      url,
      createdAt: now,
      nextAttemptAt: now,
    };
    await this.db.collection<Notification>('email_notifications').insertOne(notice);
    return this.attempt(notice._id, now);
  }
  private async attempt(id: ObjectId, now: Date): Promise<boolean> {
    const collection = this.db.collection<Notification>('email_notifications');
    const notice = await collection.findOneAndUpdate(
      {
        _id: id,
        nextAttemptAt: { $lte: now },
        $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }],
      },
      { $set: { leaseUntil: new Date(now.getTime() + 60_000) } },
      { returnDocument: 'after' },
    );
    if (!notice) return true;
    if (!(await new EmailTokens(this.db).allowEmail(notice.to, now))) {
      await collection.updateOne(
        { _id: id },
        { $set: { nextAttemptAt: new Date(now.getTime() + 60_000) }, $unset: { leaseUntil: '' } },
      );
      return true;
    }
    try {
      await this.mail.send(await emailMessage(notice.to, notice.kind, notice.url));
      await collection.deleteOne({ _id: id });
      return true;
    } catch {
      this.failed();
      await collection.updateOne(
        { _id: id },
        { $set: { nextAttemptAt: new Date(now.getTime() + 60_000) }, $unset: { leaseUntil: '' } },
      );
      return false;
    }
  }
  async flush(now = new Date()) {
    if (this.running) return this.running;
    const work = (async () => {
      const notices = await this.db
        .collection<Notification>('email_notifications')
        .find({ nextAttemptAt: { $lte: now } })
        .sort({ createdAt: 1 })
        .limit(30)
        .toArray();
      for (const notice of notices) await this.attempt(notice._id, now);
    })();
    this.running = work;
    try {
      await work;
    } finally {
      this.running = null;
    }
  }
}
