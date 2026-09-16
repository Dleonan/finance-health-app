import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateCategoryRuleDto } from './dto/create-category-rule.dto';
import { CategoriesService } from './categories.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get('categories')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.categories.list(user.id);
  }

  @Post('categories')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCategoryDto) {
    return this.categories.create(user.id, dto);
  }

  @Get('category-rules')
  listRules(@CurrentUser() user: AuthenticatedUser) {
    return this.categories.listRules(user.id);
  }

  @Post('category-rules')
  createRule(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCategoryRuleDto) {
    return this.categories.createRule(user.id, dto);
  }

  @Delete('category-rules/:id')
  removeRule(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.categories.removeRule(user.id, id);
  }
}
