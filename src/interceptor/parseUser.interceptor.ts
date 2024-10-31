import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';

import { Observable } from 'rxjs';

@Injectable()
export class ParseUserInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    //request.userId = request.headers['x-user-id'];
    request.clientId = request.headers['x-client-id'];
    return next.handle();
  }
}
