// Turns the support code a gym reads out ("Forgot PIN?" → "Lost the key?") into the unlock code that lets the
// owner set a new PIN. Must match `support_unlock_code` in crates/core/src/recovery.rs.
//
//   npm run support:unlock -- ABCDE-FGHJK    print the unlock code for a support code
//   npm run support:unlock -- --init         create the secret (once, on the PC that builds the installer)
//
// The secret comes from DANISH_SUPPORT_SECRET or %USERPROFILE%\.danish-fitness\support-secret.txt. It is baked
// into the app at build time (src-tauri/build.rs) and must never be committed. Keep a copy somewhere safe:
// installed apps only accept codes made with the secret they were built with.
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CONTEXT = "danish-fitness:pin-reset:v1:";
const CODE_LEN = 10;
export const SECRET_FILE = join(homedir(), ".danish-fitness", "support-secret.txt");

const normalize = (code) => code.replace(/[^a-z0-9]/gi, "").toUpperCase();
const format = (raw) => raw.match(/.{1,5}/g)?.join("-") ?? "";

export function readSecret() {
  const secret = (
    process.env.DANISH_SUPPORT_SECRET ?? (existsSync(SECRET_FILE) ? readFileSync(SECRET_FILE, "utf8") : "")
  ).trim();
  return secret.length >= 32 ? secret : null;
}

/** First 64 bits of HMAC-SHA256(secret, context + code) as 10 alphabet symbols, least significant first. */
export function unlockCode(secret, supportCode) {
  const digest = createHmac("sha256", secret)
    .update(CONTEXT + normalize(supportCode))
    .digest();
  let n = digest.readBigUInt64BE(0);
  const base = BigInt(ALPHABET.length);
  let code = "";
  for (let i = 0; i < CODE_LEN; i++) {
    code += ALPHABET[Number(n % base)];
    n /= base;
  }
  return format(code);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const arg = process.argv[2] ?? "";
  if (arg === "--init") {
    if (readSecret()) {
      console.log(
        `A secret already exists (${process.env.DANISH_SUPPORT_SECRET ? "DANISH_SUPPORT_SECRET" : SECRET_FILE}).`,
      );
    } else {
      mkdirSync(dirname(SECRET_FILE), { recursive: true });
      writeFileSync(SECRET_FILE, `${randomBytes(32).toString("hex")}\n`, { flag: "wx" });
      console.log(`Created ${SECRET_FILE}\nBack it up (e.g. in a password manager), then rebuild the app.`);
    }
  } else if (normalize(arg).length === CODE_LEN) {
    const secret = readSecret();
    if (!secret) {
      console.error(
        `No secret: set DANISH_SUPPORT_SECRET or create ${SECRET_FILE} (npm run support:unlock -- --init).`,
      );
      process.exit(1);
    }
    console.log(`Unlock code: ${unlockCode(secret, arg)}`);
  } else {
    console.error("Usage: npm run support:unlock -- ABCDE-FGHJK   (or --init to create the secret)");
    process.exit(1);
  }
}
