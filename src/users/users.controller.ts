import { Controller, Get, Post, Body, UseGuards, Put, Param, Delete, ParseIntPipe, BadRequestException, NotFoundException, Query, Request, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from './roles.enum';
import { PerformanceService } from './performance.service';
import * as bcrypt from 'bcrypt';
import { UserStatus, BreakReason } from './user-status.enum';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly performanceService: PerformanceService,
  ) { }

  @Post('seed')
  async seed() {
    const existing = await this.usersService.findOneByEmail('admin@crm.com');
    if (existing) return { message: 'Seed already exists' };

    const passwordHash = await bcrypt.hash('admin123', 10);
    const user = await this.usersService.create({
      name: 'Super Admin',
      email: 'admin@crm.com',
      passwordHash,
      role: Role.SUPER_ADMIN,
    });
    return { message: 'Super admin created', user: { email: user.email } };
  }

  @Put('status')
  async updateStatus(
    @Request() req: any,
    @Body() body: { status: UserStatus; breakReason?: BreakReason; notes?: string },
  ) {
    return this.usersService.updateStatus(req.user.userId, body.status, body.breakReason, body.notes);
  }

  @Put('change-password')
  async changePassword(@Request() req: any, @Body() body: { password: string }) {
    if (!body.password) throw new BadRequestException('Password is required');
    const passwordHash = await bcrypt.hash(body.password, 10);
    await this.usersService.update(req.user.userId, { passwordHash });
    return { success: true };
  }

  @Post('avatar')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: './uploads',
      filename: (req, file, cb) => {
        const randomName = Array(32).fill(null).map(() => (Math.round(Math.random() * 16)).toString(16)).join('');
        return cb(null, `${randomName}${extname(file.originalname)}`);
      }
    })
  }))
  async uploadAvatar(@Request() req: any, @UploadedFile() file: any) {
    if (!file) throw new BadRequestException('No file uploaded');
    await this.usersService.update(req.user.userId, { avatar: file.filename });
    return { avatar: file.filename };
  }

  @Get('activities')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async getAllActivities(@Query('limit') limit?: number) {
    return this.usersService.getAllUserActivities(limit);
  }

  @Get('my-activities')
  async getMyActivities(@Request() req: any, @Query('limit') limit?: number) {
    return this.usersService.getUserActivities(req.user.userId, limit);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN)
  async create(@Body() createUserDto: any) {
    const existing = await this.usersService.findOneByEmail(createUserDto.email);
    if (existing) throw new BadRequestException('البريد الإلكتروني موجود بالفعل');
    
    let passwordHash = '';
    if (createUserDto.password) {
      passwordHash = await bcrypt.hash(createUserDto.password, 10);
    } else {
      passwordHash = await bcrypt.hash('123456', 10); // default password
    }

    const { password, ...userData } = createUserDto;

    const user = await this.usersService.create({
      ...userData,
      passwordHash,
    });
    
    const { passwordHash: _, ...result } = user;
    return result;
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.AGENT)
  async findAll(@Query('search') search?: string) {
    return this.usersService.findAll(search);
  }

  @Get(':id/performance')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async getMonthlyPerformance(
    @Param('id') id: string,
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
  ) {
    return this.performanceService.getMonthlyPerformance(id, year, month);
  }

  @Get(':id/performance/:date')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async getDailyPerformance(
    @Param('id') id: string,
    @Param('date') date: string,
  ) {
    return this.performanceService.getDailyPerformance(id, date);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.AGENT)
  async findOne(@Param('id') id: string) {
    const user = await this.usersService.findOne(id);
    if (!user) throw new NotFoundException('المستخدم غير موجود');
    return user;
  }

  @Put(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async update(@Param('id') id: string, @Body() updateUserDto: any) {
    const user = await this.usersService.findOne(id);
    if (!user) throw new NotFoundException('المستخدم غير موجود');

    if (updateUserDto.password) {
      updateUserDto.passwordHash = await bcrypt.hash(updateUserDto.password, 10);
      delete updateUserDto.password;
    }
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN)
  async remove(@Param('id') id: string) {
    const user = await this.usersService.findOne(id);
    if (!user) throw new NotFoundException('المستخدم غير موجود');

    await this.usersService.remove(id);
    return { success: true };
  }
}
