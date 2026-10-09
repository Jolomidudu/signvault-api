import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

type ErrorResponseBody =
  | {
      message?: string | string[];
      code?: string;
      error?: string;
    }
  | string
  | undefined;

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const status = exception.getStatus();
    const payload = exception.getResponse() as ErrorResponseBody;
    const message =
      typeof payload === 'object' && payload && Array.isArray(payload.message)
        ? payload.message[0]
        : typeof payload === 'object' && payload && typeof payload.message === 'string'
          ? payload.message
          : exception.message;
    const code =
      typeof payload === 'object' && payload && typeof payload.code === 'string'
        ? payload.code
        : typeof payload === 'object' && payload && typeof payload.error === 'string'
          ? payload.error
          : exception.name;

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      error: code,
      code,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();

    if (exception instanceof HttpException) {
      const filter = new HttpExceptionFilter();
      return filter.catch(exception, host);
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'INTERNAL_SERVER_ERROR',
      code: 'INTERNAL_SERVER_ERROR',
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
