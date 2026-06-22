import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

/** SAM 预测接口会传 base64 图像，单张可能数 MB，默认 100kb 会 413/PayloadTooLarge */
const BODY_LIMIT = '50mb';

/** 请求/响应监控：在 bat 打开的 API 窗口打印每条请求与状态，便于排查 */
function requestLogger(req: any, res: any, next: () => void) {
  const start = Date.now();
  const method = req.method;
  const url = req.originalUrl || req.url;
  console.log(`[REQ] ${method} ${url}`);
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[RES] ${res.statusCode} ${method} ${url} ${ms}ms`);
  });
  next();
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: BODY_LIMIT }));
  app.use(urlencoded({ limit: BODY_LIMIT, extended: true }));
  app.setGlobalPrefix('api');
  app.use(requestLogger);
  app.use(helmet());
  // CORS：放行本地开发、CORS_ORIGIN（可逗号分隔多个），并自动放行所有 *.vercel.app
  // （Vercel 每次部署会生成新的预览子域名，固定单一 origin 会频繁被拦）
  const allowList = (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: (origin, callback) => {
      // 无 origin（同源 / curl / 服务端调用）直接放行
      if (!origin) return callback(null, true);
      if (allowList.includes(origin)) return callback(null, true);
      if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return callback(null, true);
      if (/^http:\/\/localhost(:\d+)?$/i.test(origin)) return callback(null, true);
      return callback(new Error(`Not allowed by CORS: ${origin}`));
    },
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}/api`);
}
bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
