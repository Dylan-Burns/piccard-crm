# Ridge Roofing CRM — Production V1

A multi-tenant roofing CRM for lead-to-job operations. React/Vite frontend + FastAPI + PostgreSQL.

## Included
- Secure workspace bootstrap and login (PBKDF2 password hashing, signed expiring bearer sessions)
- Organization-scoped customers and opportunities
- Kanban pipeline: New Lead → Contacted → Inspection → Estimate Sent → Won/Lost
- Automatic job creation on Won
- Jobs, appointments/calendar, notes and activity history
- Per-opportunity document upload/download (25 MB cap)
- Estimates and invoices with sequential numbers
- Dashboard/reporting API and lead-source tracking
- Audit log for important mutations
- Authenticated REST API for future mobile/automation clients
- Secured website lead-ingestion webhook
- Docker deployment with PostgreSQL and persistent volumes
- Integration-ready environment for Google Calendar and QuickBooks OAuth credentials

## Production deployment
1. Copy `.env.example` to `.env`.
2. Generate a strong `APP_SECRET`, e.g. `openssl rand -hex 48`.
3. Change the PostgreSQL password in both `.env` and `docker-compose.yml`, or point `DATABASE_URL` at managed Postgres.
4. Set `PUBLIC_URL` and `CORS_ORIGINS` to the final HTTPS hostname.
5. Set `LEAD_WEBHOOK_SECRET` if website forms will post directly to `/api/webhooks/leads/{org_id}`.
6. Run `docker compose up -d --build` behind an HTTPS reverse proxy/load balancer.
7. Open the app and choose **First time? Initialize workspace**. The bootstrap endpoint disables itself after the first user exists.
8. Back up the Postgres volume/database and uploaded-file volume on a schedule.

## Local development
Backend:
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
APP_SECRET=dev-secret uvicorn server.main:app --reload
```
Frontend:
```bash
npm install
npm run dev
```
Vite runs on 5173. For a single-origin production build, Docker compiles the frontend and FastAPI serves `dist/`.

## Website lead webhook
`POST /api/webhooks/leads/{org_id}` with header `X-Webhook-Secret` matching `LEAD_WEBHOOK_SECRET`.

Example JSON:
```json
{"name":"Jane Homeowner","address":"123 Main St","phone":"415-555-0100","email":"jane@example.com","source":"Google Ads","service":"Roof Replacement","value":0}
```

## Integrations
QuickBooks and Google Calendar require customer-owned OAuth apps/credentials. Credential placeholders are in `.env.example`; secrets are intentionally not embedded in source. The CRM remains fully usable without either integration. QuickBooks should remain the accounting system of record; this CRM owns customer/job context, estimates and operational invoice state.

## Production hardening checklist
- Use managed PostgreSQL with point-in-time recovery.
- Put the app behind HTTPS; never expose port 8000 directly to the public internet.
- Store `APP_SECRET`, database credentials and OAuth credentials in the hosting provider's secret manager.
- Use S3-compatible object storage for multi-instance deployments; the included local volume backend is appropriate for a single durable app instance.
- Configure database and file backups and test restoration.
- Add your company-specific retention policy and legal/privacy notices before collecting customer data.
- Create separate admin and sales/field users before broad rollout; the schema supports roles, while V1 mutations currently require authenticated membership rather than granular permission rules.

## Verification performed
The backend was compiled and smoke-tested on a fresh SQLite database for bootstrap/auth, lead creation/listing, Won → job creation, notes, events, estimates, invoices and reporting.
