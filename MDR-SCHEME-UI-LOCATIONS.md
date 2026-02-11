# MDR Scheme UI Locations

## ✅ UI Created Successfully!

The MDR scheme management UI has been created. Here's where to find it:

---

## 📍 Admin: Global MDR Schemes

**Location**: `/admin/mdr-schemes`

**Access**:
1. Login as Admin
2. Go to Admin Dashboard
3. Click **"MDR Schemes"** in the left sidebar
4. Or navigate directly to: `https://your-domain.com/admin/mdr-schemes`

**Features**:
- ✅ View all global MDR schemes
- ✅ Create new global schemes
- ✅ Edit existing schemes
- ✅ Delete schemes
- ✅ Search and filter schemes
- ✅ Auto-calculate T+0 MDR (T+1 + 1%)
- ✅ Support for CARD and UPI modes
- ✅ Support for card types (CREDIT, DEBIT, PREPAID)
- ✅ Support for brand types (VISA, MasterCard, etc.)

**What Admin Can Do**:
- Set default MDR rates for all retailers
- Define schemes by payment mode (CARD/UPI)
- Define schemes by card type and brand
- Activate/deactivate schemes
- T+0 MDR automatically calculated as T+1 + 1%

---

## 📍 Distributor: Retailer MDR Schemes

**Location**: `/dashboard/distributor?tab=mdr-schemes`

**Access**:
1. Login as Distributor
2. Go to Distributor Dashboard
3. Click **"MDR Schemes"** tab
4. Or navigate directly to: `https://your-domain.com/dashboard/distributor?tab=mdr-schemes`

**Features**:
- ✅ View all custom schemes for retailers
- ✅ Create custom schemes for specific retailers
- ✅ Edit existing retailer schemes
- ✅ Delete schemes
- ✅ Search and filter by retailer
- ✅ Set both T+1 and T+0 MDR rates
- ✅ Validation: Retailer MDR must be >= Distributor MDR
- ✅ Support for CARD and UPI modes

**What Distributor Can Do**:
- Create custom MDR schemes for their retailers
- Override global schemes with retailer-specific rates
- Set different rates for T+1 and T+0 settlements
- Manage schemes per retailer, mode, card type, and brand

---

## 🎯 How It Works

### Global Schemes (Admin)
1. Admin creates a global scheme
2. Sets Retailer MDR T+1 and Distributor MDR T+1
3. System auto-calculates T+0 rates (T+1 + 1%)
4. Scheme applies to all retailers by default

### Custom Schemes (Distributor)
1. Distributor selects a retailer
2. Creates a custom scheme for that retailer
3. Sets both T+1 and T+0 rates (manually)
4. Custom scheme overrides global scheme for that retailer

### Scheme Priority
1. **First**: Check if retailer has a custom scheme
2. **Fallback**: Use global scheme
3. **If none**: Transaction fails (no scheme found)

---

## 📋 Quick Access Guide

### For Admin:
```
Admin Dashboard → Left Sidebar → "MDR Schemes"
URL: /admin/mdr-schemes
```

### For Distributor:
```
Distributor Dashboard → Tabs → "MDR Schemes"
URL: /dashboard/distributor?tab=mdr-schemes
```

---

## 🔍 What You'll See

### Admin Page Shows:
- Table of all global schemes
- Mode (CARD/UPI)
- Card Type (CREDIT/DEBIT/PREPAID)
- Brand Type (VISA/MasterCard/etc.)
- Retailer MDR rates (T+1 and T+0)
- Distributor MDR rates (T+1 and T+0)
- Status (Active/Inactive)
- Actions (Edit/Delete)

### Distributor Page Shows:
- Table of all custom retailer schemes
- Retailer name
- Mode, Card Type, Brand
- MDR rates for both retailer and distributor
- Status
- Actions (Edit/Delete)

---

## ✨ Key Features

1. **Auto-calculation**: Global schemes auto-calculate T+0 = T+1 + 1%
2. **Validation**: Ensures Retailer MDR >= Distributor MDR
3. **Search & Filter**: Easy to find schemes
4. **Real-time Updates**: Changes reflect immediately
5. **User-friendly**: Clean, modern UI matching your existing design

---

## 🚀 Next Steps

1. **Test the UI**:
   - Login as Admin → Go to MDR Schemes
   - Create a test global scheme
   - Login as Distributor → Go to MDR Schemes tab
   - Create a test retailer scheme

2. **Create Schemes**:
   - Admin: Create global schemes for common payment modes
   - Distributor: Create custom schemes for specific retailers

3. **Verify**:
   - Check that schemes are saved in database
   - Test with a Razorpay payment to see scheme selection

---

## 📝 Notes

- **Global schemes** are managed by Admin only
- **Retailer schemes** are managed by Distributors
- Only **one active scheme** per combination (enforced by database)
- Schemes are used automatically during Razorpay webhook processing

---

## 🆘 Troubleshooting

**Can't see MDR Schemes in sidebar?**
- Make sure you're logged in as Admin
- Check that the page file exists: `app/admin/mdr-schemes/page.tsx`

**Can't see MDR Schemes tab in Distributor dashboard?**
- Make sure you're logged in as Distributor
- Check that the tab was added to the distributor page

**Scheme not saving?**
- Check browser console for errors
- Verify database tables exist (`global_schemes`, `retailer_schemes`)
- Check Supabase logs

---

**All UI components are ready!** 🎉

