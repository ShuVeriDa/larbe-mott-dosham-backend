import { ApiProperty } from "@nestjs/swagger";
import { IsString, Equals } from "class-validator";

export class DeleteAccountDto {
  @ApiProperty({ description: 'Enter "delete" to confirm' })
  @IsString()
  @Equals("delete", { message: 'You must enter "delete" to confirm' })
  confirmation: string;
}
