import { Injectable } from "@nestjs/common";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env } from "../common/env.js";

const MAX_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_UPLOAD_BYTES = 200 * 1024 * 1024;
const STORAGE_REQUEST_TIMEOUT_MS = 30_000;
const VIDEO_TRANSFER_TIMEOUT_MS = 5 * 60_000;

export class StorageObjectError extends Error {
  constructor(readonly code: "FILE_TOO_LARGE" | "EMPTY_OBJECT" | "INVALID_CONTENT_TYPE") {
    super(code);
    this.name = "StorageObjectError";
  }
}

@Injectable()
export class StorageService {
  private readonly config = env.s3;
  private readonly client = new S3Client({
    endpoint: this.config.endpoint,
    region: this.config.region,
    forcePathStyle: this.config.forcePathStyle,
    credentials: {
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey
    }
  });

  presignUpload(key: string, contentType: string, contentLength: number) {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: contentLength
      }),
      { expiresIn: this.config.signedUrlTtl }
    );
  }

  presignDownload(key: string, filename?: string) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ResponseContentDisposition: filename ? `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` : undefined
      }),
      { expiresIn: this.config.signedUrlTtl }
    );
  }

  async read(key: string): Promise<{ bytes: Buffer; contentType?: string }> {
    const head = await this.client.send(
      new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(STORAGE_REQUEST_TIMEOUT_MS) }
    );
    const maxUploadBytes = head.ContentType === "video/mp4"
      ? MAX_VIDEO_UPLOAD_BYTES
      : MAX_IMAGE_UPLOAD_BYTES;
    if ((head.ContentLength ?? 0) > maxUploadBytes) throw new StorageObjectError("FILE_TOO_LARGE");
    if (head.ContentLength === 0) throw new StorageObjectError("EMPTY_OBJECT");
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      {
        abortSignal: AbortSignal.timeout(
          head.ContentType === "video/mp4" ? VIDEO_TRANSFER_TIMEOUT_MS : STORAGE_REQUEST_TIMEOUT_MS
        )
      }
    );
    if (!response.Body) throw new StorageObjectError("EMPTY_OBJECT");
    const body = response.Body as AsyncIterable<Uint8Array> & { destroy?: () => void };
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of body) {
      size += chunk.byteLength;
      if (size > maxUploadBytes) {
        body.destroy?.();
        throw new StorageObjectError("FILE_TOO_LARGE");
      }
      chunks.push(Buffer.from(chunk));
    }
    if (size === 0) throw new StorageObjectError("EMPTY_OBJECT");
    return { bytes: Buffer.concat(chunks, size), contentType: head.ContentType };
  }

  put(key: string, body: Buffer, contentType: string) {
    return this.client.send(
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: body, ContentType: contentType }),
      {
        abortSignal: AbortSignal.timeout(
          contentType === "video/mp4" ? VIDEO_TRANSFER_TIMEOUT_MS : STORAGE_REQUEST_TIMEOUT_MS
        )
      }
    );
  }

  delete(key: string) {
    return this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(STORAGE_REQUEST_TIMEOUT_MS) }
    );
  }

  async readVideo(key: string): Promise<{
    path: string;
    contentType: "video/mp4";
    cleanup: () => Promise<void>;
  }> {
    const head = await this.client.send(
      new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(STORAGE_REQUEST_TIMEOUT_MS) }
    );
    if (head.ContentType !== "video/mp4") throw new StorageObjectError("INVALID_CONTENT_TYPE");
    if ((head.ContentLength ?? 0) > MAX_VIDEO_UPLOAD_BYTES) throw new StorageObjectError("FILE_TOO_LARGE");
    if (head.ContentLength === 0) throw new StorageObjectError("EMPTY_OBJECT");

    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(VIDEO_TRANSFER_TIMEOUT_MS) }
    );
    if (!response.Body) throw new StorageObjectError("EMPTY_OBJECT");

    const directory = await mkdtemp(join(tmpdir(), "family-frame-video-"));
    const path = join(directory, "input.mp4");
    let size = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.byteLength;
        if (size > MAX_VIDEO_UPLOAD_BYTES) callback(new StorageObjectError("FILE_TOO_LARGE"));
        else callback(null, chunk);
      }
    });

    try {
      await pipeline(Readable.from(response.Body as AsyncIterable<Uint8Array>), limit, createWriteStream(path));
      if (size === 0) throw new StorageObjectError("EMPTY_OBJECT");
      return {
        path,
        contentType: "video/mp4",
        cleanup: () => rm(directory, { recursive: true, force: true })
      };
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  copy(sourceKey: string, destinationKey: string, contentType: string) {
    return this.client.send(
      new CopyObjectCommand({
        Bucket: this.config.bucket,
        Key: destinationKey,
        CopySource: encodeURIComponent(`${this.config.bucket}/${sourceKey}`),
        ContentType: contentType,
        MetadataDirective: "REPLACE"
      }),
      { abortSignal: AbortSignal.timeout(VIDEO_TRANSFER_TIMEOUT_MS) }
    );
  }

  async check(): Promise<void> {
    await this.client.send(
      new HeadBucketCommand({ Bucket: this.config.bucket }),
      { abortSignal: AbortSignal.timeout(STORAGE_REQUEST_TIMEOUT_MS) }
    );
  }
}
