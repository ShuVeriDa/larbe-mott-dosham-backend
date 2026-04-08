import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { User as UserPrisma } from "@prisma/client";

export const User = createParamDecorator(
  (data: keyof UserPrisma, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user: UserPrisma }>();
    const user: UserPrisma = request.user;
    return data ? user[data] : user;
  },
);
