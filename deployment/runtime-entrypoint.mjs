import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
if (!process.env.MONGO_URL) {
  const password = readFileSync('/run/secrets/mongo_app_password', 'utf8').trim();
  if (!password) throw new Error('MongoDB application password is empty');
  process.env.MONGO_URL = `mongodb://dicecloud:${encodeURIComponent(password)}@mongo:27017/dicecloud?authSource=dicecloud`;
}
if (!process.env.ROOT_URL) throw new Error('ROOT_URL is required');
createRequire(import.meta.url)('../main.js');
