// Development stand-in for openRMS-Accounts until AC1: makes a local signing key (once) and
// prints an access token with the identity.md §4 claims.
//   pnpm dev-token [sub] [callsign] [role]
//   then run the API with DEV_JWKS_FILE=.dev/jwks.json OPENRMS_ISSUER=http://localhost:8789
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { exportJWK, generateKeyPair, importJWK, SignJWT } from "jose";

const dir = new URL("../.dev/", import.meta.url);
const priv = new URL("private.jwk.json", dir), pub = new URL("jwks.json", dir);
if (!existsSync(priv)) {
  mkdirSync(dir, { recursive: true });
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const kid = "dev-1";
  writeFileSync(priv, JSON.stringify({ ...(await exportJWK(privateKey)), kid, alg: "ES256" }));
  writeFileSync(pub, JSON.stringify({ keys: [{ ...(await exportJWK(publicKey)), kid, alg: "ES256", use: "sig" }] }));
}
const jwk = JSON.parse(readFileSync(priv, "utf8"));
const key = await importJWK(jwk, "ES256");
const [sub = "dev-user-1", callsign = "N0CALL", role = "user"] = process.argv.slice(2);
const token = await new SignJWT({ callsign, callsign_verified: role !== "user", callsign_verified_method: "moderator", clubs: [], role })
  .setProtectedHeader({ alg: "ES256", kid: jwk.kid })
  .setIssuer(process.env.OPENRMS_ISSUER ?? "http://localhost:8789")
  .setAudience(process.env.OPENRMS_AUDIENCE ?? process.env.PUBLIC_URL ?? "http://localhost:8790")
  .setSubject(sub)
  .setIssuedAt()
  .setExpirationTime("12h")
  .sign(key);
console.log(token);
