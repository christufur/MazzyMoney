import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import { AnalyticsService } from '../services/analyticsService';

const router = Router();
router.use(authenticateToken);

/**
 * GET /api/analytics/trends
 * Get spending trends over time
 */
router.get('/trends', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const months = parseInt(req.query.months as string) || 12;
    
    const trends = await AnalyticsService.getSpendingTrends(userId, months);
    res.json({ trends });
  } catch (error: any) {
    console.error('Error fetching trends:', error);
    res.status(500).json({ error: 'Failed to fetch trends' });
  }
});

/**
 * GET /api/analytics/insights
 * Get spending insights and anomalies
 */
router.get('/insights', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const insights = await AnalyticsService.getSpendingInsights(userId);
    res.json({ insights });
  } catch (error: any) {
    console.error('Error fetching insights:', error);
    res.status(500).json({ error: 'Failed to fetch insights' });
  }
});

/**
 * GET /api/analytics/merchants
 * Get top merchants analysis
 */
router.get('/merchants', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const limit = parseInt(req.query.limit as string) || 10;
    
    const merchants = await AnalyticsService.getTopMerchants(userId, limit);
    res.json({ merchants });
  } catch (error: any) {
    console.error('Error fetching merchants:', error);
    res.status(500).json({ error: 'Failed to fetch merchants' });
  }
});

/**
 * GET /api/analytics/day-of-week
 * Get spending patterns by day of week
 */
router.get('/day-of-week', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const patterns = await AnalyticsService.getSpendingByDayOfWeek(userId);
    res.json({ patterns });
  } catch (error: any) {
    console.error('Error fetching day patterns:', error);
    res.status(500).json({ error: 'Failed to fetch day patterns' });
  }
});

/**
 * GET /api/analytics/monthly-summary
 * Get monthly spending summary for a year
 */
router.get('/monthly-summary', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    
    const summary = await AnalyticsService.getMonthlySummary(userId, year);
    res.json({ summary });
  } catch (error: any) {
    console.error('Error fetching monthly summary:', error);
    res.status(500).json({ error: 'Failed to fetch monthly summary' });
  }
});

/**
 * GET /api/analytics/forecast
 * Get spending forecast
 */
router.get('/forecast', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const forecast = await AnalyticsService.getSpendingForecast(userId);
    res.json(forecast);
  } catch (error: any) {
    console.error('Error fetching forecast:', error);
    res.status(500).json({ error: 'Failed to fetch forecast' });
  }
});

export default router;
