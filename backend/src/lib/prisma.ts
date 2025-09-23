import { PrismaClient } from '../../prisma/generated/prisma';

declare const globalThis: {
    prismaGlobal: PrismaClient;
  } & typeof global;
  
  // Create a new PrismaClient instance if one doesn't already exist globally
export const prisma = globalThis.prismaGlobal || new PrismaClient();