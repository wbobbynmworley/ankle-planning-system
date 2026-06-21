import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: unknown =
      exception instanceof HttpException
        ? exception.getResponse()
        : exception instanceof Error
          ? exception.message
          : 'Internal server error';

    if (status === HttpStatus.INTERNAL_SERVER_ERROR && exception instanceof Error) {
      const err = exception as Error & { code?: string };
      if (err.code === 'ECONNREFUSED' || err.message?.includes('connect')) {
        message = '数据库连接失败，请确认 MySQL 已启动且 DATABASE_URL 正确';
      } else if (err.name === 'PrismaClientInitializationError' || err.message?.includes('Prisma')) {
        message = '数据库异常: ' + (err.message || '请检查 DATABASE_URL 与数据库服务');
      }
    }

    this.logger.warn(
      `${request.method} ${request.url} ${status} - ${JSON.stringify(message)}`,
    );
    if (status === HttpStatus.INTERNAL_SERVER_ERROR && exception instanceof Error && exception.stack) {
      this.logger.error(exception.stack);
    }

    response.status(status).json({
      statusCode: status,
      message: typeof message === 'object' && message && 'message' in message
        ? (message as { message: string | string[] }).message
        : message,
      error: exception instanceof HttpException
        ? (exception.getResponse() as { error?: string }).error
        : undefined,
    });
  }
}
