import type { RedisOptions } from "ioredis";

/** Trust the instance CA while retaining certificate and hostname validation. */
export function redisTlsOptions(): Pick<RedisOptions, "tls"> {
  if (!process.env.REDIS_URL?.startsWith("rediss://")) return {};
  const ca = process.env.REDIS_TLS_CA_BASE64;
  return {
    tls: {
      ...(ca ? { ca: Buffer.from(ca, "base64").toString("utf8") } : {}),
      ...(process.env.REDIS_TLS_SERVERNAME
        ? { servername: process.env.REDIS_TLS_SERVERNAME }
        : {}),
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    },
  };
}
