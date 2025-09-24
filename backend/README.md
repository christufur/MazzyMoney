# Backend Overview

## Budget Alert Notifications

Budget alerts allow users to receive notifications when spending approaches or exceeds configured thresholds.

### Setup

Add the following environment variables to enable SMTP delivery:

```
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM="Money App <alerts@moneyapp.com>"
```

If SMTP credentials are not provided, the backend falls back to printing email payloads to the console (useful for development).

### Default Alerts

When a new budget is created, two alerts are created automatically:

- **Approaching**: Triggered at 80% of the budget
- **Exceeded**: Triggered at 100% of the budget

Both alerts can be managed via the `POST /api/budgets/:id/alerts` endpoints or inside the Budget page in the frontend.

### Trigger Points

Budget alerts are evaluated during:

- Transaction syncs
- Budget creation and updates
- Manual alert evaluation routines

When an alert fires, a record is inserted into `budget_alert_notifications` and an email is sent if enabled.


