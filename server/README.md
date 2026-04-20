# FamilyCrate Server

Backend API for FamilyCrate — Node.js + Express + Supabase + Stripe

## Setup

### 1. Install dependencies
```bash
cd server
npm install
```

### 2. Set up Supabase
1. Go to supabase.com and open your project
2. Go to SQL Editor
3. Paste the contents of `schema.sql` and run it
4. Go to Settings → API and copy:
   - Project URL → `SUPABASE_URL`
   - Service role key → `SUPABASE_SERVICE_KEY`

### 3. Set up Stripe
1. Go to stripe.com → Products → Create product
   - Name: FamilyCrate
   - Price: $19/month recurring
   - Copy the Price ID → `STRIPE_PRICE_ID`
2. Copy your Secret Key → `STRIPE_SECRET_KEY`
3. Go to Developers → Webhooks → Add endpoint
   - URL: `https://your-railway-url.railway.app/api/webhooks/stripe`
   - Events: select all `customer.subscription.*` and `invoice.*`
   - Copy signing secret → `STRIPE_WEBHOOK_SECRET`

### 4. Set up Resend
1. Go to resend.com → API Keys → Create key
2. Add domain `familycrate.co`
3. Copy key → `RESEND_API_KEY`

### 5. Environment variables
```bash
cp .env.example .env
# Fill in all values
```

### 6. Run locally
```bash
npm run dev
```

### 7. Deploy to Railway
- Push to GitHub — Railway auto-deploys
- Add all env variables in Railway → Variables tab

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/register | Create family account |
| POST | /api/auth/login | Login |
| GET  | /api/auth/me | Get current family |
| POST | /api/auth/reset-password | Password reset |
| GET  | /api/family | Get all family data |
| POST | /api/family/members | Add member |
| PUT  | /api/family/members/:id | Update member |
| DELETE | /api/family/members/:id | Delete member |
| POST | /api/family/items | Add item |
| PUT  | /api/family/items/:id | Update item |
| DELETE | /api/family/items/:id | Delete item |
| POST | /api/family/events | Add event |
| PUT  | /api/family/events/:id | Update event |
| DELETE | /api/family/events/:id | Delete event |
| POST | /api/family/done | Toggle done |
| POST | /api/family/rewards | Add reward |
| PUT  | /api/family/rewards/:id | Update reward |
| DELETE | /api/family/rewards/:id | Delete reward |
| POST | /api/family/redeem | Request redemption |
| PUT  | /api/family/redeem/:id/approve | Approve redemption |
| PUT  | /api/family/redeem/:id/decline | Decline redemption |
| PUT  | /api/family/settings | Update settings |
| POST | /api/stripe/checkout | Start subscription |
| POST | /api/stripe/portal | Manage subscription |
| GET  | /api/stripe/status | Get subscription status |
| POST | /api/webhooks/stripe | Stripe webhook handler |
| POST | /api/notify/welcome | Send welcome email |
| POST | /api/notify/chore-reminder | Send chore reminder |
| POST | /api/notify/reward-approved | Send reward approved email |
