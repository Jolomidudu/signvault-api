import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SignatureCategory, SignatureStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSignatureDto } from './dto/create-signature.dto';
import { ListSignaturesQueryDto } from './dto/list-signatures-query.dto';
import { UpdateSignatureDto } from './dto/update-signature.dto';

export const MAX_SIGNATURES_PER_USER = 25;

type SignatureAuditEvent =
  | 'SIGNATURE_CREATED'
  | 'SIGNATURE_UPDATED'
  | 'SIGNATURE_ARCHIVED'
  | 'SIGNATURE_RESTORED'
  | 'SIGNATURE_DELETED';

function toIsoValue(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

@Injectable()
export class SignaturesService {
  constructor(private readonly prisma: PrismaService) {}

  private async recordAudit(
    userId: string,
    signatureId: string,
    event: SignatureAuditEvent,
    metadata: Record<string, unknown> = {},
  ) {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          signatureId,
          event,
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
    } catch {
      // Audit logging must never interrupt the core signature flow.
    }
  }

  private getEffectiveStatus(status: SignatureStatus, expiresAt: Date | null | undefined) {
    if (status === 'REVOKED') {
      return 'REVOKED' as const;
    }

    if (status === 'ARCHIVED') {
      return 'ARCHIVED' as const;
    }

    if (expiresAt && expiresAt.getTime() < Date.now()) {
      return 'EXPIRED' as const;
    }

    return status;
  }

  private serializeSignature(signature: {
    id: string;
    name: string;
    category: SignatureCategory;
    status: SignatureStatus;
    expiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    currentVersion?: {
      id: string;
      versionNumber: number;
      displayText: string;
      style: string;
      design: Prisma.JsonValue;
      createdAt: Date;
    } | null;
    _count?: { versions: number };
  }) {
    const result = {
      id: signature.id,
      name: signature.name,
      category: signature.category,
      status: this.getEffectiveStatus(signature.status, signature.expiresAt),
      expiresAt: toIsoValue(signature.expiresAt),
      createdAt: toIsoValue(signature.createdAt),
      updatedAt: toIsoValue(signature.updatedAt),
    };

    if (signature._count) {
      return {
        ...result,
        currentVersion: signature.currentVersion
          ? {
              id: signature.currentVersion.id,
              versionNumber: signature.currentVersion.versionNumber,
              displayText: signature.currentVersion.displayText,
              style: signature.currentVersion.style,
              design: signature.currentVersion.design,
              createdAt: toIsoValue(signature.currentVersion.createdAt),
            }
          : null,
        versionCount: signature._count.versions,
      };
    }

    return result;
  }

  private async requireOwnedSignature(userId: string, signatureId: string) {
    const signature = await this.prisma.signature.findFirst({
      where: {
        id: signatureId,
        userId,
      },
    });

    if (!signature) {
      throw new NotFoundException({
        message: 'Signature not found.',
        code: 'SIGNATURE_NOT_FOUND',
      });
    }

    return signature;
  }

  private normalizeName(name: string) {
    const trimmed = name.trim();

    if (!trimmed) {
      throw new BadRequestException({
        message: 'Signature name is required.',
        code: 'INVALID_SIGNATURE_NAME',
      });
    }

    if (trimmed.length > 160) {
      throw new BadRequestException({
        message: 'Signature name must be 160 characters or fewer.',
        code: 'INVALID_SIGNATURE_NAME',
      });
    }

    return trimmed;
  }

  private normalizeExpiry(expiresAt?: string | null) {
    if (expiresAt === undefined || expiresAt === null) {
      return undefined;
    }

    const parsed = new Date(expiresAt);

    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException({
        message: 'expiresAt must be a valid ISO date string.',
        code: 'INVALID_SIGNATURE_EXPIRY',
      });
    }

    if (parsed.getTime() <= Date.now()) {
      throw new BadRequestException({
        message: 'expiresAt must be in the future for new signatures.',
        code: 'INVALID_SIGNATURE_EXPIRY',
      });
    }

    return parsed;
  }

  private buildListWhere(userId: string, query: ListSignaturesQueryDto): Prisma.SignatureWhereInput {
    const where: Prisma.SignatureWhereInput = {
      userId,
    };

    if (query.category) {
      where.category = query.category;
    }

    if (query.search) {
      where.name = {
        contains: query.search.trim(),
        mode: 'insensitive',
      };
    }

    if (query.status) {
      if (query.status === 'ACTIVE') {
        where.status = 'ACTIVE';
        where.OR = [{ expiresAt: null }, { expiresAt: { gte: new Date() } }];
      } else if (query.status === 'EXPIRED') {
        where.OR = [
          { status: 'EXPIRED' },
          { status: 'ACTIVE', expiresAt: { lt: new Date() } },
        ];
      } else {
        where.status = query.status;
      }
    }

    return where;
  }

  async create(userId: string, dto: CreateSignatureDto) {
    const expiresAt = this.normalizeExpiry(dto.expiresAt);
    const name = this.normalizeName(dto.name);
    const signature = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;

      const signatureCount = await transaction.signature.count({ where: { userId } });

      if (signatureCount >= MAX_SIGNATURES_PER_USER) {
        throw new ConflictException({
          message: `Signature vault limit reached. You can have up to ${MAX_SIGNATURES_PER_USER} signatures.`,
          code: 'SIGNATURE_LIMIT_REACHED',
        });
      }

      return transaction.signature.create({
        data: {
          userId,
          name,
          category: dto.category,
          status: 'ACTIVE',
          expiresAt,
        },
      });
    });

    await this.recordAudit(userId, signature.id, 'SIGNATURE_CREATED', {
      category: signature.category,
    });

    return this.serializeSignature(signature);
  }

  async list(userId: string, query: ListSignaturesQueryDto) {
    const page = Number(query.page ?? 1);
    const limit = Number(query.limit ?? 10);
    const sort = query.sort ?? 'createdAt';
    const order = query.order ?? 'desc';
    const where = this.buildListWhere(userId, query);

    const total = await this.prisma.signature.count({ where });
    const items = await this.prisma.signature.findMany({
      where,
      orderBy: { [sort]: order },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        currentVersion: {
          select: {
            id: true,
            versionNumber: true,
            displayText: true,
            style: true,
            design: true,
            createdAt: true,
          },
        },
        _count: { select: { versions: true } },
      },
    });

    return {
      items: items.map((signature) => this.serializeSignature(signature)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async summary(userId: string) {
    const signatures = await this.prisma.signature.findMany({
      where: { userId },
      select: {
        status: true,
        expiresAt: true,
      },
    });

    const counts = {
      total: signatures.length,
      active: 0,
      archived: 0,
      revoked: 0,
      expired: 0,
    };

    for (const signature of signatures) {
      const status = this.getEffectiveStatus(signature.status, signature.expiresAt);

      if (status === 'ACTIVE') counts.active += 1;
      if (status === 'ARCHIVED') counts.archived += 1;
      if (status === 'REVOKED') counts.revoked += 1;
      if (status === 'EXPIRED') counts.expired += 1;
    }

    return {
      total: counts.total,
      active: counts.active,
      archived: counts.archived,
      revoked: counts.revoked,
      expired: counts.expired,
      limit: MAX_SIGNATURES_PER_USER,
      remaining: Math.max(0, MAX_SIGNATURES_PER_USER - counts.total),
    };
  }

  async getById(userId: string, signatureId: string) {
    const signature = await this.prisma.signature.findFirst({
      where: { id: signatureId, userId },
      include: {
        currentVersion: {
          select: {
            id: true,
            versionNumber: true,
            displayText: true,
            style: true,
            design: true,
            createdAt: true,
          },
        },
        _count: { select: { versions: true } },
      },
    });

    if (!signature) {
      throw new NotFoundException({
        message: 'Signature not found.',
        code: 'SIGNATURE_NOT_FOUND',
      });
    }

    return this.serializeSignature(signature);
  }

  async update(userId: string, signatureId: string, dto: UpdateSignatureDto) {
    const existing = await this.requireOwnedSignature(userId, signatureId);

    const updateData: Prisma.SignatureUpdateInput = {};

    if (dto.name !== undefined) {
      updateData.name = this.normalizeName(dto.name);
    }

    if (dto.category !== undefined) {
      updateData.category = dto.category;
    }

    if (dto.expiresAt !== undefined) {
      if (dto.expiresAt === null) {
        updateData.expiresAt = null;
      } else {
        const nextExpiry = this.normalizeExpiry(dto.expiresAt);
        if (nextExpiry) {
          updateData.expiresAt = nextExpiry;
        }
      }
    }

    if (Object.keys(updateData).length === 0) {
      return this.serializeSignature(existing);
    }

    const updated = await this.prisma.signature.update({
      where: { id: signatureId },
      data: updateData,
    });

    await this.recordAudit(userId, updated.id, 'SIGNATURE_UPDATED', {
      changedFields: Object.keys(updateData),
    });

    return this.serializeSignature(updated);
  }

  async archive(userId: string, signatureId: string) {
    const existing = await this.requireOwnedSignature(userId, signatureId);

    if (existing.status === 'REVOKED') {
      throw new ConflictException({
        message: 'Revoked signatures cannot be archived as ordinary vault entries.',
        code: 'INVALID_SIGNATURE_STATUS',
      });
    }

    if (existing.status === 'ARCHIVED') {
      throw new ConflictException({
        message: 'Signature is already archived.',
        code: 'SIGNATURE_ALREADY_ARCHIVED',
      });
    }

    const updated = await this.prisma.signature.update({
      where: { id: signatureId },
      data: { status: 'ARCHIVED' },
    });

    await this.recordAudit(userId, updated.id, 'SIGNATURE_ARCHIVED', {
      previousStatus: existing.status,
    });

    return this.serializeSignature(updated);
  }

  async restore(userId: string, signatureId: string) {
    const existing = await this.requireOwnedSignature(userId, signatureId);

    if (existing.status === 'REVOKED') {
      throw new ConflictException({
        message: 'Revoked signatures cannot be restored as active profiles.',
        code: 'INVALID_SIGNATURE_STATUS',
      });
    }

    if (existing.status !== 'ARCHIVED') {
      throw new ConflictException({
        message: 'Signature is not archived and cannot be restored.',
        code: 'SIGNATURE_NOT_ARCHIVED',
      });
    }

    const updated = await this.prisma.signature.update({
      where: { id: signatureId },
      data: { status: 'ACTIVE' },
    });

    await this.recordAudit(userId, updated.id, 'SIGNATURE_RESTORED', {
      previousStatus: existing.status,
    });

    return this.serializeSignature(updated);
  }

  async remove(userId: string, signatureId: string) {
    const existing = await this.requireOwnedSignature(userId, signatureId);

    if (existing.status === 'REVOKED') {
      throw new ConflictException({
        message: 'Revoked signatures cannot be deleted as ordinary vault profiles.',
        code: 'INVALID_SIGNATURE_STATUS',
      });
    }

    const updated = await this.prisma.signature.update({
      where: { id: signatureId },
      data: { status: 'ARCHIVED' },
    });

    await this.recordAudit(userId, updated.id, 'SIGNATURE_DELETED', {
      strategy: 'archive-soft-delete',
    });

    return this.serializeSignature(updated);
  }
}
