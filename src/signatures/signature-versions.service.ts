import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSignatureVersionDto } from './dto/create-signature-version.dto';
import { ListSignatureVersionsQueryDto } from './dto/list-signature-versions-query.dto';

type VersionAuditEvent =
  | 'SIGNATURE_VERSION_CREATED'
  | 'SIGNATURE_VERSION_DUPLICATED'
  | 'SIGNATURE_VERSION_SELECTED'
  | 'SIGNATURE_VERSION_ARCHIVED';

type DesignerValues = {
  displayText: string;
  style: string;
  design: Prisma.InputJsonValue;
};

@Injectable()
export class SignatureVersionsService {
  constructor(private readonly prisma: PrismaService) {}

  private async recordAudit(
    userId: string,
    signatureId: string,
    event: VersionAuditEvent,
    metadata: Record<string, unknown>,
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

  private notFound() {
    return new NotFoundException({
      message: 'Signature or version not found.',
      code: 'SIGNATURE_VERSION_NOT_FOUND',
    });
  }

  private async requireOwnedSignature(
    transaction: Prisma.TransactionClient,
    userId: string,
    signatureId: string,
  ) {
    const signature = await transaction.signature.findFirst({
      where: { id: signatureId, userId },
      select: { id: true, currentVersionId: true },
    });

    if (!signature) {
      throw this.notFound();
    }

    return signature;
  }

  private async lockVersionSequence(transaction: Prisma.TransactionClient, signatureId: string) {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${signatureId}, 0))`;
  }

  private async createNextVersion(
    transaction: Prisma.TransactionClient,
    signatureId: string,
    values: DesignerValues,
  ) {
    const latest = await transaction.signatureVersion.findFirst({
      where: { signatureId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    const version = await transaction.signatureVersion.create({
      data: {
        signatureId,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        displayText: values.displayText.trim(),
        style: values.style,
        design: values.design,
      },
    });
    const selected = await transaction.signature.updateMany({
      where: { id: signatureId, currentVersionId: null },
      data: { currentVersionId: version.id },
    });

    return { version, isCurrent: selected.count === 1 };
  }

  private serializeVersion(
    version: {
      id: string;
      signatureId: string;
      versionNumber: number;
      displayText: string;
      style: string;
      design: Prisma.JsonValue;
      archivedAt: Date | null;
      createdAt: Date;
    },
    isCurrent: boolean,
  ) {
    return {
      id: version.id,
      signatureId: version.signatureId,
      versionNumber: version.versionNumber,
      displayText: version.displayText,
      style: version.style,
      design: version.design,
      isCurrent,
      archivedAt: version.archivedAt?.toISOString() ?? null,
      createdAt: version.createdAt.toISOString(),
    };
  }

  async create(userId: string, signatureId: string, dto: CreateSignatureVersionDto) {
    const created = await this.prisma.$transaction(async (transaction) => {
      await this.requireOwnedSignature(transaction, userId, signatureId);
      await this.lockVersionSequence(transaction, signatureId);
      return this.createNextVersion(transaction, signatureId, {
        displayText: dto.displayText,
        style: dto.style,
        design: { ...dto.design },
      });
    });

    await this.recordAudit(userId, signatureId, 'SIGNATURE_VERSION_CREATED', {
      versionNumber: created.version.versionNumber,
      style: created.version.style,
    });

    return this.serializeVersion(created.version, created.isCurrent);
  }

  async list(userId: string, signatureId: string, query: ListSignatureVersionsQueryDto) {
    await this.prisma.signature.findFirstOrThrow({
      where: { id: signatureId, userId },
      select: { id: true },
    }).catch(() => {
      throw this.notFound();
    });

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = { signatureId };
    const [total, signature, versions] = await Promise.all([
      this.prisma.signatureVersion.count({ where }),
      this.prisma.signature.findUnique({
        where: { id: signatureId },
        select: { currentVersionId: true },
      }),
      this.prisma.signatureVersion.findMany({
        where,
        orderBy: { versionNumber: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items: versions.map((version) =>
        this.serializeVersion(version, signature?.currentVersionId === version.id),
      ),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getOne(userId: string, signatureId: string, versionId: string) {
    const signature = await this.prisma.signature.findFirst({
      where: { id: signatureId, userId },
      select: { id: true, currentVersionId: true },
    });
    if (!signature) {
      throw this.notFound();
    }

    const version = await this.prisma.signatureVersion.findFirst({
      where: { id: versionId, signatureId },
    });
    if (!version) {
      throw this.notFound();
    }

    return this.serializeVersion(version, signature.currentVersionId === version.id);
  }

  async duplicate(userId: string, signatureId: string, versionId: string) {
    const created = await this.prisma.$transaction(async (transaction) => {
      await this.requireOwnedSignature(transaction, userId, signatureId);
      await this.lockVersionSequence(transaction, signatureId);
      const source = await transaction.signatureVersion.findFirst({
        where: { id: versionId, signatureId, archivedAt: null },
      });
      if (!source) {
        throw this.notFound();
      }

      return this.createNextVersion(transaction, signatureId, {
        displayText: source.displayText,
        style: source.style,
        design: source.design as Prisma.InputJsonValue,
      });
    });

    await this.recordAudit(userId, signatureId, 'SIGNATURE_VERSION_DUPLICATED', {
      versionNumber: created.version.versionNumber,
      sourceVersionId: versionId,
    });

    return this.serializeVersion(created.version, created.isCurrent);
  }

  async selectCurrent(userId: string, signatureId: string, versionId: string) {
    const selected = await this.prisma.$transaction(async (transaction) => {
      await this.requireOwnedSignature(transaction, userId, signatureId);
      const version = await transaction.signatureVersion.findFirst({
        where: { id: versionId, signatureId, archivedAt: null },
      });
      if (!version) {
        throw this.notFound();
      }

      await transaction.signature.update({
        where: { id: signatureId },
        data: { currentVersionId: version.id },
      });
      return version;
    });

    await this.recordAudit(userId, signatureId, 'SIGNATURE_VERSION_SELECTED', {
      versionNumber: selected.versionNumber,
    });

    return this.serializeVersion(selected, true);
  }

  async archive(userId: string, signatureId: string, versionId: string) {
    const archived = await this.prisma.$transaction(async (transaction) => {
      const signature = await this.requireOwnedSignature(transaction, userId, signatureId);
      const version = await transaction.signatureVersion.findFirst({
        where: { id: versionId, signatureId },
      });
      if (!version) {
        throw this.notFound();
      }
      if (version.archivedAt) {
        throw new ConflictException({
          message: 'Signature version is already archived.',
          code: 'SIGNATURE_VERSION_ALREADY_ARCHIVED',
        });
      }

      if (signature.currentVersionId === version.id) {
        await transaction.signature.update({
          where: { id: signatureId },
          data: { currentVersionId: null },
        });
      }

      return transaction.signatureVersion.update({
        where: { id: version.id },
        data: { archivedAt: new Date() },
      });
    });

    await this.recordAudit(userId, signatureId, 'SIGNATURE_VERSION_ARCHIVED', {
      versionNumber: archived.versionNumber,
    });

    return this.serializeVersion(archived, false);
  }
}