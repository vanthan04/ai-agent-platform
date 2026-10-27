import {
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AUTHENTICATOR, type AuthenticationRequest, type Authenticator } from "../application/authenticator";
import type { AuthUser } from "../domain/auth-user";

const IS_PUBLIC = "isPublic";

interface AuthenticatedRequest extends AuthenticationRequest {
  user?: AuthUser;
}

/** Routes require a user by default; only a route marked `@Public()` is open. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
  const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) throw new UnauthorizedException();
  return user;
});

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(AUTHENTICATOR) private readonly authenticator: Authenticator,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = this.authenticator.authenticate(request);
    if (!user) throw new UnauthorizedException();
    request.user = user;
    return true;
  }
}
