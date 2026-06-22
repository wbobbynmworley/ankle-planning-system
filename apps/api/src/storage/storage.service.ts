import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

/**
 * 统一文件存储层（任意 S3 兼容对象存储：Supabase / Backblaze B2 / Tencent COS / MinIO / R2 …）：
 * - 配置了 S3_*（或兼容的 R2_*）环境变量时走对象存储，重启不丢；
 * - 否则回退到本地磁盘 FILE_STORAGE_PATH（本地开发 / 同机部署）。
 *
 * `key` 统一用正斜杠的相对路径（如 `cases/<caseId>/STL/123-foo.stl`），
 * 既是对象键，也是磁盘相对路径；`File.path` 保存的就是这个 key。
 *
 * 通用变量：S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET,
 *           S3_FORCE_PATH_STYLE（Supabase/B2/MinIO 需 true）。
 * R2 便捷变量：R2_ACCOUNT_ID（自动拼 endpoint）+ R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET。
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private s3: S3Client | null = null;
  private bucket = '';
  private diskRoot: string;

  constructor() {
    this.diskRoot = process.env.FILE_STORAGE_PATH ?? path.join(process.cwd(), 'storage');
    const r2Account = process.env.R2_ACCOUNT_ID;
    const endpoint =
      process.env.S3_ENDPOINT ||
      (r2Account ? `https://${r2Account}.r2.cloudflarestorage.com` : '');
    const accessKeyId = process.env.S3_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY;
    this.bucket = process.env.S3_BUCKET || process.env.R2_BUCKET || '';
    const region = process.env.S3_REGION || 'auto';
    // R2 用 virtual-hosted 风格；其它 S3 兼容（Supabase/B2/MinIO）通常需 path-style
    const forcePathStyle = process.env.S3_FORCE_PATH_STYLE
      ? process.env.S3_FORCE_PATH_STYLE === 'true'
      : !r2Account;
    if (endpoint && accessKeyId && secretAccessKey && this.bucket) {
      this.s3 = new S3Client({
        region,
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle,
      });
      this.logger.log(`Storage: S3-compatible enabled (endpoint=${endpoint}, bucket=${this.bucket}, pathStyle=${forcePathStyle})`);
    } else {
      this.logger.log(`Storage: local disk at ${this.diskRoot} (object storage not configured)`);
    }
  }

  get usingObjectStore(): boolean {
    return this.s3 !== null;
  }

  /** 规范化为正斜杠相对 key（防止 Windows 反斜杠混入对象键） */
  private normKey(key: string): string {
    return key.replace(/\\/g, '/').replace(/^\/+/, '');
  }

  async put(key: string, buf: Buffer, contentType?: string): Promise<void> {
    const k = this.normKey(key);
    if (this.s3) {
      await this.s3.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: k, Body: buf, ContentType: contentType }),
      );
      return;
    }
    const full = path.resolve(this.diskRoot, k);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buf);
  }

  async get(key: string): Promise<Buffer> {
    const k = this.normKey(key);
    if (this.s3) {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: k }));
      const body = res.Body as
        | (AsyncIterable<Uint8Array> & { transformToByteArray?: () => Promise<Uint8Array> })
        | undefined;
      if (!body) throw new Error(`Empty body for key ${k}`);
      // AWS SDK v3 推荐：优先用 transformToByteArray，避免不同运行时下流迭代的边界问题
      if (typeof body.transformToByteArray === 'function') {
        return Buffer.from(await body.transformToByteArray());
      }
      const chunks: Buffer[] = [];
      for await (const chunk of body) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    }
    const full = path.resolve(this.diskRoot, k);
    return fs.readFileSync(full);
  }

  async exists(key: string): Promise<boolean> {
    const k = this.normKey(key);
    if (this.s3) {
      try {
        await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: k }));
        return true;
      } catch {
        return false;
      }
    }
    return fs.existsSync(path.resolve(this.diskRoot, k));
  }

  async delete(key: string): Promise<void> {
    const k = this.normKey(key);
    if (this.s3) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: k }));
      return;
    }
    const full = path.resolve(this.diskRoot, k);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  }
}
