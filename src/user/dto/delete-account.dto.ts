import { ApiProperty } from "@nestjs/swagger";
import { IsString, Equals } from "class-validator";

export class DeleteAccountDto {
  @ApiProperty({ description: 'Введите "удалить" для подтверждения' })
  @IsString()
  @Equals("удалить", { message: 'Необходимо ввести "удалить" для подтверждения' })
  confirmation: string;
}
