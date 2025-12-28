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

2. Run the development server:
```bash
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000) in your browser.

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

## Notes

- The contact form is UI-only (no backend integration)
- All content is static/dummy content - replace with actual company information
- No hardcoded regulatory claims (RBI approval, etc.) as per requirements
- SEO meta tags are included in all pages

## License

This project is proprietary software for Same Day Solution Pvt. Ltd.

