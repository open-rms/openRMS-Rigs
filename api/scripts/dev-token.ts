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
// --key: an Accounts-style API key instead (identity.md §5.1):
//   pnpm dev-token --key [sub] [callsign] ["scope scope"] [jti]
if (process.argv[2] === "--key") {
  const [sub = "dev-user-1", callsign = "N0CALL", scope = "profiles:write", jti = `dev-${Date.now()}`] = process.argv.slice(3);
  const jwt = await new SignJWT({ scope, token_use: "api_key", callsign })
    .setProtectedHeader({ alg: "ES256", kid: jwk.kid, typ: "openrms-key+jwt" })
    .setIssuer(process.env.OPENRMS_ISSUER ?? "http://localhost:8789")
    .setAudience(process.env.OPENRMS_AUDIENCE ?? process.env.PUBLIC_URL ?? "http://localhost:8790")
    .setSubject(sub)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime("90d")
    .sign(key);
  console.log(`ormk_${jwt}`);
  process.exit(0);
}
const [sub = "dev-user-1", callsign = "N0CALL", role = "user"] = process.argv.slice(2);
// RADIOS="RIG_MODEL_FTDX10,RIG_MODEL_IC7300" adds the `radios` claim (identity.md §4).
const radios = process.env.RADIOS ? { radios: process.env.RADIOS.split(",").filter(Boolean) } : {};
const token = await new SignJWT({ callsign, callsign_verified: role !== "user", callsign_verified_method: "moderator", clubs: [], role, ...radios })
  .setProtectedHeader({ alg: "ES256", kid: jwk.kid })
  .setIssuer(process.env.OPENRMS_ISSUER ?? "http://localhost:8789")
  .setAudience(process.env.OPENRMS_AUDIENCE ?? process.env.PUBLIC_URL ?? "http://localhost:8790")
  .setSubject(sub)
  .setIssuedAt()
  .setExpirationTime("12h")
  .sign(key);
console.log(token);
