function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveNumber(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function boundedPositiveInteger(name: string, fallback: number, maximum: number): number {
  const value = positiveInteger(name, fallback);
  if (value > maximum) throw new Error(`${name} must be at most ${maximum}`);
  return value;
}

export const env = {
  get port() {
    return positiveInteger("PORT", 4000);
  },
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get appOrigin() {
    return process.env.APP_ORIGIN ?? "http://localhost:3000";
  },
  get sessionCookieName() {
    return process.env.SESSION_COOKIE_NAME ?? "family_frame_session";
  },
  get sessionTtlDays() {
    return positiveNumber("SESSION_TTL_DAYS", 7);
  },
  get signedUrlTtl() {
    return positiveInteger("SIGNED_URL_TTL_SECONDS", 300);
  },
  get maxActiveUploadsPerUser() {
    return boundedPositiveInteger("MAX_ACTIVE_UPLOADS_PER_USER", 5, 20);
  },
  get s3() {
    return {
      endpoint: required("S3_ENDPOINT"),
      region: process.env.S3_REGION ?? "us-east-1",
      bucket: required("S3_BUCKET"),
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
      signedUrlTtl: env.signedUrlTtl
    };
  }
};
