import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken } from '../middleware/auth';

const router = Router({ mergeParams: true });
router.use(authenticateToken);

router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { budgetId } = req.params;

    const alerts = await prisma.budgetAlert.findMany({
      where: { budgetId, userId }
    });

    res.json({ alerts });
  } catch (error) {
    console.error('Error fetching budget alerts:', error);
    res.status(500).json({ error: 'Failed to fetch budget alerts' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { budgetId } = req.params;
    const { thresholdPercent, alertType, emailEnabled = true, isEnabled = true } = req.body;

    if (!thresholdPercent || !alertType) {
      return res.status(400).json({ error: 'thresholdPercent and alertType are required' });
    }

    const budget = await prisma.budget.findFirst({
      where: { id: budgetId, userId }
    });

    if (!budget) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    const alert = await prisma.budgetAlert.create({
      data: {
        userId,
        budgetId,
        thresholdPercent: typeof thresholdPercent === 'string' ? parseFloat(thresholdPercent) : thresholdPercent,
        alertType,
        emailEnabled,
        isEnabled
      }
    });

    res.status(201).json({ alert });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Alert already exists for this budget and alert type' });
    }

    console.error('Error creating budget alert:', error);
    res.status(500).json({ error: 'Failed to create budget alert' });
  }
});

router.put('/:alertId', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { budgetId, alertId } = req.params;
    const { thresholdPercent, alertType, emailEnabled, isEnabled } = req.body;

    const alert = await prisma.budgetAlert.findFirst({
      where: { id: alertId, budgetId, userId }
    });

    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    const updatedAlert = await prisma.budgetAlert.update({
      where: { id: alertId },
      data: {
        thresholdPercent: thresholdPercent !== undefined
          ? (typeof thresholdPercent === 'string' ? parseFloat(thresholdPercent) : thresholdPercent)
          : alert.thresholdPercent,
        alertType: alertType || alert.alertType,
        emailEnabled: emailEnabled !== undefined ? emailEnabled : alert.emailEnabled,
        isEnabled: isEnabled !== undefined ? isEnabled : alert.isEnabled,
        updatedAt: new Date()
      }
    });

    res.json({ alert: updatedAlert });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Alert already exists for this budget and alert type' });
    }

    console.error('Error updating budget alert:', error);
    res.status(500).json({ error: 'Failed to update budget alert' });
  }
});

router.delete('/:alertId', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { budgetId, alertId } = req.params;

    const alert = await prisma.budgetAlert.findFirst({
      where: { id: alertId, budgetId, userId }
    });

    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    await prisma.budgetAlert.delete({
      where: { id: alertId }
    });

    res.json({ message: 'Alert deleted successfully' });
  } catch (error) {
    console.error('Error deleting budget alert:', error);
    res.status(500).json({ error: 'Failed to delete budget alert' });
  }
});

export default router;

