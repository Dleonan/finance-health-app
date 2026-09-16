import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { CreateCategoryDto } from './dto/create-category.dto';
import type { CreateCategoryRuleDto } from './dto/create-category-rule.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.category.findMany({
      where: { OR: [{ isSystem: true }, { userId }] },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, parentId: true, isSystem: true },
    });
  }

  async create(userId: string, dto: CreateCategoryDto) {
    if (dto.parentId) await this.assertCategoryVisible(userId, dto.parentId);
    try {
      return await this.prisma.category.create({
        data: { userId, name: dto.name.trim(), parentId: dto.parentId },
        select: { id: true, name: true, parentId: true, isSystem: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Category already exists');
      }
      throw error;
    }
  }

  listRules(userId: string) {
    return this.prisma.categoryRule.findMany({
      where: { userId },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        categoryId: true,
        field: true,
        operator: true,
        value: true,
        priority: true,
        enabled: true,
      },
    });
  }

  async createRule(userId: string, dto: CreateCategoryRuleDto) {
    await this.assertCategoryVisible(userId, dto.categoryId);
    return this.prisma.categoryRule.create({
      data: {
        userId,
        categoryId: dto.categoryId,
        field: dto.field,
        operator: dto.operator,
        value: dto.value.trim(),
        priority: dto.priority,
      },
      select: {
        id: true,
        categoryId: true,
        field: true,
        operator: true,
        value: true,
        priority: true,
        enabled: true,
      },
    });
  }

  async removeRule(userId: string, id: string) {
    const result = await this.prisma.categoryRule.deleteMany({ where: { id, userId } });
    if (!result.count) throw new NotFoundException('Category rule not found');
    return { success: true };
  }

  private async assertCategoryVisible(userId: string, id: string) {
    const category = await this.prisma.category.findFirst({
      where: { id, OR: [{ isSystem: true }, { userId }] },
      select: { id: true },
    });
    if (!category) throw new NotFoundException('Category not found');
  }
}
