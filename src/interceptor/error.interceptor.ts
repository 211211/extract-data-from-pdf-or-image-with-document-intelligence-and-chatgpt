import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, catchError } from 'rxjs';

import { HttpException } from '@nestjs/common/exceptions/http.exception';

export interface Response<T> {
  statusCode: number;
  data: T;
}

@Injectable()
export class ErrorInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError((error) => {
        console.log(error);
        throw new HttpException({ message: error.message, status_code: error.name }, 500);
      }),
    );
  }
}
