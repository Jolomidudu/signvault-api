import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AccountStatus, type User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type PublicUser = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  accountStatus: AccountStatus;
  avatarUrl: string | null;
  createdAt: Date;
  role: string;
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async ensureAccountAllowed(user: Pick<User, 'accountStatus' | 'emailVerified'>) {
    if (user.accountStatus === 'SUSPENDED' || user.accountStatus === 'DISABLED') {
      throw new UnauthorizedException('This account is not active.');
    }

    return user;
  }

  toPublicUser(user: Partial<User> & { role?: string }): PublicUser {
    return {
      id: user.id as string,
      firstName: user.firstName as string,
      lastName: user.lastName as string,
      displayName: user.displayName as string,
      email: user.email as string,
      emailVerified: Boolean(user.emailVerified),
      accountStatus: (user.accountStatus as AccountStatus) ?? 'PENDING_VERIFICATION',
      avatarUrl: user.avatarUrl ?? null,
      createdAt: user.createdAt as Date,
      role: String(user.role ?? 'USER'),
    };
  }
}
