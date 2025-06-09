import { ApiProperty } from '@nestjs/swagger';

export class DocumentDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  pageContent: string;

  @ApiProperty({ type: [Number], required: false })
  embedding?: number[];

  @ApiProperty()
  user: string;

  @ApiProperty()
  chatThreadId: string;

  @ApiProperty()
  metadata: string;
}
