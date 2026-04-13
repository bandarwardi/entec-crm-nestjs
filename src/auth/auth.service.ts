import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { LoginRequest } from './login-request.entity';
import { UserStatus } from '../users/user-status.enum';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    @InjectRepository(LoginRequest)
    private loginRequestRepository: Repository<LoginRequest>
  ) {}

  async submitLoginRequest(user: any, data: { lat: number, lng: number, device: string, ip: string }) {
    const request = this.loginRequestRepository.create({
      user: { id: user.id } as any,
      latitude: data.lat,
      longitude: data.lng,
      deviceInfo: data.device,
      ipAddress: data.ip,
      status: 'pending'
    });
    return this.loginRequestRepository.save(request);
  }

  async findApprovedRequest(userId: number) {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    return this.loginRequestRepository.findOne({
      where: {
        user: { id: userId },
        status: 'approved',
        createdAt: MoreThan(fifteenMinutesAgo)
      }
    });
  }

  async getAllPending() {
    return this.loginRequestRepository.find({
      where: { status: 'pending' },
      order: { createdAt: 'DESC' },
      relations: ['user']
    });
  }

  async getAllHistory() {
    return this.loginRequestRepository.find({
      where: [
        { status: 'approved' },
        { status: 'rejected' }
      ],
      order: { createdAt: 'DESC' },
      take: 50,
      relations: ['user']
    });
  }

  async updateRequestStatus(id: number, status: string) {
    return this.loginRequestRepository.update(id, { status });
  }

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.usersService.findOneByEmail(email);
    if (user && await bcrypt.compare(pass, user.passwordHash)) {
      const { passwordHash, ...result } = user;
      return result;
    }
    return null;
  }

  async login(user: any) {
    const payload = { email: user.email, sub: user.id, role: user.role };
    
    // Set user to online when logging in
    await this.usersService.updateStatus(user.id, UserStatus.ONLINE);

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    };
  }

  async logout(userId: number) {
    return this.usersService.updateStatus(userId, UserStatus.OFFLINE);
  }
}
