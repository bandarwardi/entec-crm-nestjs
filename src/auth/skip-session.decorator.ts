import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_SESSION_KEY = 'isPublicSession';
export const SkipSession = () => SetMetadata(IS_PUBLIC_SESSION_KEY, true);
