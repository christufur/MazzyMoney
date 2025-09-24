import { prisma } from '../../lib/prisma';
import { Request, Response } from 'express';

describe('Transactions Routes', () => {
    beforeEach(async () => {
        await prisma.transaction.deleteMany({});
    });
});