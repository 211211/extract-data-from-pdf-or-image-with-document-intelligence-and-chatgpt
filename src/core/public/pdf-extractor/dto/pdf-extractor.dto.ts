import { ValidationOptions, registerDecorator } from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';

interface IsFileOptions {
  mime: ('image/jpg' | 'image/png' | 'image/jpeg' | 'application/pdf')[];
}

export function IsFile(options: IsFileOptions, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    return registerDecorator({
      name: 'isFile',
      target: object.constructor,
      propertyName: propertyName,
      constraints: [],
      options: validationOptions,
      validator: {
        validate(value: any) {
          if (value?.mimetype && (options?.mime ?? []).includes(value?.mimetype)) {
            return true;
          }
          return false;
        },
      },
    });
  };
}

export class PdfExtractorDto {
  @ApiProperty()
  @IsFile({ mime: ['image/jpg', 'image/png', 'image/jpeg', 'application/pdf'] })
  file: Express.Multer.File;
}
