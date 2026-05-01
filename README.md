# Same Day Solution Pvt. Ltd. - Fintech Platform

A comprehensive fintech platform built with Next.js, TypeScript, and Tailwind CSS, featuring BBPS (Bharat Bill Payment System) integration, payment processing, and multi-role user management.

## 🚀 Features

- **Modern Tech Stack**: Next.js 14 with App Router, TypeScript, Tailwind CSS
- **BBPS Integration**: Complete Bharat Bill Payment System integration with multiple biller categories
- **Payment Processing**: Razorpay integration for secure transactions
- **Multi-Role System**: Admin, Master Distributor, Distributor, and Retailer roles
- **Admin Features**: 
  - Sub-admin management with department-based permissions
  - Admin impersonation (login as any user)
  - Password reset for any user
  - Wallet push/pull operations
- **Wallet System**: Integrated wallet for transactions and balance management
- **Responsive Design**: Fully responsive across desktop, tablet, and mobile
- **SEO Optimized**: Comprehensive meta tags and SEO-friendly structure
- **Secure Authentication**: Supabase-based authentication with role-based access control

## 📋 Prerequisites

- Node.js 18+ 
- npm or yarn
- Supabase account (for authentication and database)
- BBPS API credentials (for bill payment services)
- Razorpay account (for payment processing)

## 🛠️ Installation

1. **Clone the repository:**
```bash
git clone <repository-url>
cd same_day_solution
```

2. **Install dependencies:**
```bash
npm install
```

3. **Set up environment variables:**
   Create a `.env.local` file in the root directory:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# BBPS API Configuration
BBPS_API_BASE_URL=https://api.sparkuptech.in/api/ba
BBPS_PARTNER_ID=your_partner_id
BBPS_CONSUMER_KEY=your_consumer_key
BBPS_CONSUMER_SECRET=your_consumer_secret
USE_BBPS_MOCK=false

# Razorpay Configuration
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret

# Email Configuration (SMTP)
SMTP_HOST=smtpout.secureserver.net
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=info@samedaysolution.in
SMTP_PASSWORD=your_email_password
SMTP_FROM=info@samedaysolution.in

# Application URL
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

4. **Set up the database:**
   - Run the SQL migration files in your Supabase database in this order:
     - `supabase-schema.sql` (main schema)
     - `supabase-schema-bbps.sql` (BBPS tables)
     - `supabase-schema-razorpay.sql` (Razorpay tables)
     - `supabase-aeps-schema.sql` (AEPS transactions and merchants)
     - `supabase-schema-wallet-ledger-integration.sql` (Wallet and ledger system)
     - `supabase-admin-sub-admin-impersonation-migration.sql` (Admin system)
     - `supabase-multiple-departments-migration.sql` (Sub-admin departments)
     - `supabase-aeps-deposit-migration.sql` (AEPS deposit support — run on existing DBs)

5. **Create an admin user:**
```bash
npm run create-admin
```

6. **Run the development server:**
```bash
npm run dev
```

7. **Open [http://localhost:3000](http://localhost:3000)** in your browser.

## 📁 Project Structure

```
same_day_solution/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   │   ├── admin/        # Admin API endpoints
│   │   ├── bbps/         # BBPS API endpoints
│   │   ├── razorpay/     # Razorpay webhooks
│   │   ├── wallet/       # Wallet operations
│   │   └── transactions/ # Transaction management
│   ├── admin/            # Admin dashboard
│   ├── dashboard/        # User dashboards (retailer, distributor, etc.)
│   ├── services/         # Service pages
│   └── ...              # Other pages
├── components/           # Reusable React components
├── contexts/            # React contexts (Auth, etc.)
├── hooks/               # Custom React hooks
├── lib/                 # Utility libraries
│   ├── bbps/           # BBPS service integration
│   ├── razorpay/       # Razorpay integration
│   └── supabase/       # Supabase client setup
├── services/            # Business logic services
│   └── bbps/           # BBPS service implementations
├── types/               # TypeScript type definitions
├── public/              # Static assets
└── scripts/            # Utility scripts
```

## 🔧 Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run create-admin` - Create an admin user

## 🌐 Deployment

### AWS Amplify (Frontend)

1. Connect your GitHub repository to AWS Amplify
2. Set environment variables in Amplify console
3. Deploy automatically on push to main branch

### EC2 (Backend API)

1. Set up EC2 instance with Node.js
2. Configure Nginx as reverse proxy
3. Set up PM2 for process management
4. Configure environment variables
5. Set up SSL with Let's Encrypt

### CloudFront Configuration

- Configure CloudFront to route `/api/*` to EC2
- Route `/*` to AWS Amplify for frontend
- Set cache policies appropriately

## 🔐 Security

- All API keys and secrets are stored in environment variables
- Never commit `.env.local` or any files containing credentials
- Use Supabase Row Level Security (RLS) for database access
- Implement proper authentication and authorization checks
- Use HTTPS in production

## 📚 Key Integrations

### BBPS (Bharat Bill Payment System)
- Biller categories and listing
- Bill fetching and payment
- Transaction status tracking
- Complaint registration and tracking

### Razorpay
- Payment gateway integration
- Webhook handling
- Transaction management

### Supabase
- User authentication
- Database management
- Row Level Security

## 🧪 Testing

The application includes:
- BBPS API integration tests
- Transaction flow testing
- User role-based access testing

## 📝 Environment Variables

See `.env.example` (if available) or refer to the Installation section above for required environment variables.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is proprietary software for Same Day Solution Pvt. Ltd.

## 📞 Support

For support, email info@samedaysolution.in or visit [https://www.samedaysolution.in](https://www.samedaysolution.in)

## 🙏 Acknowledgments

- Next.js team for the amazing framework
- Supabase for authentication and database services
- Tailwind CSS for the utility-first CSS framework

---

**Built with ❤️ by Same Day Solution Pvt. Ltd.**
