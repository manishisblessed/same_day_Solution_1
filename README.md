# Same Day Solution Pvt. Ltd. - Fintech Website

A modern, clean, and responsive fintech website built with Next.js, TypeScript, and Tailwind CSS.

## Features

- 🚀 **Next.js 14** with App Router
- 💅 **Tailwind CSS** for styling
- 📱 **Fully Responsive** (desktop, tablet, mobile)
- 🔍 **SEO-friendly** structure with meta tags
- 🎨 **Modern UI/UX** with professional fintech design
- ⚡ **Fast Performance** with optimized components

## Pages

- **Home** - Hero section, services overview, why choose us, and trust & security
- **About Us** - Company introduction, mission, vision, and core values
- **Services** - Detailed service pages (Payments, Lending, Merchant Services, APIs, KYC)
- **Compliance & Security** - Security measures and compliance information
- **Contact** - Contact form and company information

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables for email functionality:
   Create a `.env.local` file in the root directory with the following variables:
   
   **For Titan Mail (GoDaddy) - Recommended:**
   ```env
   SMTP_HOST=smtpout.secureserver.net
   SMTP_PORT=465
   SMTP_SECURE=true
   SMTP_USER=info@samedaysolution.in
   SMTP_PASSWORD=your-email-password
   SMTP_FROM=info@samedaysolution.in
   ```
   
   **For Gmail:**
   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=your-email@gmail.com
   SMTP_PASSWORD=your-app-password
   SMTP_FROM=your-email@gmail.com
   ```
   
   **Note:** 
   - For Titan Mail: Use your email account password
   - For Gmail: You'll need to use an "App Password" instead of your regular password. Generate one at: https://myaccount.google.com/apppasswords

3. Run the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for Production

```bash
npm run build
npm start
```

## Project Structure

```
same_day/
├── app/                    # Next.js App Router pages
│   ├── about/             # About Us page
│   ├── services/          # Services page
│   ├── compliance/        # Compliance & Security page
│   ├── contact/           # Contact page
│   ├── layout.tsx         # Root layout
│   ├── page.tsx           # Home page
│   └── globals.css        # Global styles
├── app/
│   └── api/
│       └── contact/       # Contact form API endpoint
│           └── route.ts   # Email sending handler
├── components/            # Reusable components
│   ├── Header.tsx         # Navigation header
│   ├── Footer.tsx         # Footer component
│   ├── Hero.tsx           # Hero section
│   └── ServiceCard.tsx    # Service card component
├── public/                # Static assets
│   └── LOGO_Same_Day.jpeg # Company logo
└── package.json           # Dependencies
```

## Design Theme

The website uses a professional fintech color scheme:
- **Primary Colors**: Orange/Red gradients (matching logo)
- **Secondary Colors**: Green gradients (matching logo)
- **Accent Colors**: Teal/Blue for highlights
- **Background**: Clean white with subtle gradients

## Customization

### Colors

Edit `tailwind.config.ts` to customize the color scheme.

### Content

All content is in the page components. Edit the respective files in the `app/` directory to update content.

### Logo

Replace `public/LOGO_Same_Day.jpeg` with your logo file (keep the same filename or update references in `components/Header.tsx` and `components/Footer.tsx`).

## Contact Form Email Setup

The contact form sends emails to `info@samedaysolution.in` when users submit the form. To enable this functionality:

1. Create a `.env.local` file in the root directory
2. Add your SMTP configuration (see Getting Started section above)
3. The form will automatically send emails when submitted

**Email Service Options:**
- **Titan Mail (GoDaddy)** - Default configuration: `smtpout.secureserver.net` on port 465 with SSL
- **Gmail**: Use SMTP settings with an App Password
- **Outlook/Office 365**: Use SMTP settings with your account credentials
- **Custom SMTP**: Configure with your email provider's SMTP settings

## Notes

- All content is static/dummy content - replace with actual company information
- No hardcoded regulatory claims (RBI approval, etc.) as per requirements
- SEO meta tags are included in all pages

## License

This project is proprietary software for Same Day Solution Pvt. Ltd.

