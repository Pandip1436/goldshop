/**
 * Creates an admin account, or promotes an existing account to admin.
 *
 *   npm run create-admin -- --email you@store.in --name "Your Name"
 *
 * The password is read from the ADMIN_PASSWORD environment variable or prompted for,
 * so it never ends up in shell history.
 */
import readline from 'node:readline/promises';
import bcrypt from 'bcryptjs';
import { emailSchema } from '@goldshop/shared';
import { connectDb, disconnectDb } from '../src/db';
import { User } from '../src/models';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = emailSchema.parse(arg('email') ?? '');
  const name = arg('name') ?? 'Store admin';
  await connectDb();
  const existing = await User.findOne({ email });
  if (existing) {
    existing.role = 'admin';
    existing.isActive = true;
    existing.tokenVersion = (existing.tokenVersion ?? 0) + 1;
    await existing.save();
    console.log(`${email} is now an admin.`);
  } else {
    let password = process.env.ADMIN_PASSWORD;
    if (!password) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      password = await rl.question('Password (min 10 characters): ');
      rl.close();
    }
    if (!password || password.length < 10) throw new Error('Password must be at least 10 characters.');
    await User.create({ name, email, role: 'admin', passwordHash: await bcrypt.hash(password, 12) });
    console.log(`Created admin ${email}.`);
  }
  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
