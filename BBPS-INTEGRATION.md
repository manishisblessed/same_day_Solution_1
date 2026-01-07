# BBPS Integration Guide

This document explains how to set up and use the BBPS (Bharat Bill Payment System) integration in the Same Day Solution platform.

## Overview

The BBPS integration allows retailers to:
- Fetch available billers from the BBPS network
- Retrieve bill details for customers
- Pay bills using wallet balance
- Track BBPS transactions

## Prerequisites

1. **BBPS API Access**: You need access to a BBPS API provider with:
   - API Base URL
   - API Key
   - API Secret
   - Agent ID

2. **EC2 Instance**: An EC2 instance with whitelisted IP address for API access

3. **Database Setup**: Run the BBPS schema SQL file in Supabase

## Setup Instructions

### 1. Database Setup

Run the following SQL file in your Supabase SQL Editor:
```sql
-- Run: supabase-schema-bbps.sql
```

This will create:
- `bbps_billers` table - Cache of available billers
- `bbps_transactions` table - All BBPS payment transactions
- Wallet debit/refund functions for BBPS
- Required indexes and RLS policies

### 2. Environment Variables

Add the following environment variables to your `.env.local` file:

```env
# BBPS API Configuration (SparkUpTech)
BBPS_API_BASE_URL=https://api.sparkuptech.in/api/ba
BBPS_PARTNER_ID=your_partner_id_here (or BBPS_CLIENT_ID for backward compatibility)
BBPS_CONSUMER_KEY=your_consumer_key_here
BBPS_CONSUMER_SECRET=your_consumer_secret_here

# Payout API Configuration (for future use)
PAYOUT_API_BASE_URL=https://your-payout-api-provider.com/api
PAYOUT_API_KEY=your_payout_api_key
PAYOUT_API_SECRET=your_payout_api_secret
```

### 3. API Configuration

The BBPS service is configured in `lib/bbps/service.ts`. You may need to adjust:

1. **Authentication**: Uses Partner ID (partnerid), Consumer Key (consumerkey), and Consumer Secret (consumersecret) headers (already configured)
2. **API Endpoints** (SparkUpTech BBPS API):
   - `GET /billerId/getList` - Fetch billers by category
   - `POST /bbps/fetchbillerInfo` - Fetch biller information
   - `POST /bbps/fetchBill` - Fetch bill details
   - `POST /bbps/payRequest` - Pay bill
   - `POST /bbps/transactionStatus` - Get transaction status
   - `POST /complaintRegistration` - Register complaint
   - `POST /complaintTracking` - Track complaint
3. **Response Format**: Already configured for SparkUpTech API response structure

### 4. EC2 Instance Whitelisting

Ensure your EC2 instance IP is whitelisted with your BBPS API provider. The API calls will be made from your Next.js server (which should be running on the EC2 instance).

## Usage

### For Retailers

1. **Access BBPS**: Navigate to Retailer Dashboard → BBPS Payments tab
2. **View Wallet Balance**: Your current wallet balance is displayed at the top
3. **Select Biller**: Search and select a biller from the list
4. **Enter Consumer Number**: Enter the customer's consumer number
5. **Fetch Bill**: Click "Fetch Bill Details" to retrieve bill information
6. **Pay Bill**: Review bill details and click "Pay Bill" to complete payment

### API Endpoints

#### GET `/api/bbps/categories`
Fetch available BBPS categories
- Returns: List of categories

#### GET `/api/bbps/billers`
Fetch available billers by category
- Query params: `category` or `blr_category_name` (required for best results)
- Returns: List of billers for the specified category

#### POST `/api/bbps/bill/fetch`
Fetch bill details
- Body: `{ biller_id, consumer_number, additional_params? }`
- Returns: Bill details including amount, due date, etc.

#### POST `/api/bbps/bill/pay`
Pay a bill
- Body: `{ biller_id, consumer_number, amount, biller_name, consumer_name, due_date, bill_date, bill_number, additional_info? }`
- Returns: Payment result with transaction ID

#### POST `/api/bbps/biller-info`
Fetch biller information
- Body: `{ biller_id }`
- Returns: Detailed biller information including input parameters, payment modes, etc.

#### POST `/api/bbps/transaction-status`
Get transaction status
- Body: `{ transaction_id, track_type? }` (track_type defaults to 'TRANS_REF_ID')
- Returns: Transaction status details

#### POST `/api/bbps/complaint/register`
Register a complaint
- Body: `{ transaction_id, complaint_type?, description, complaint_disposition? }`
- Returns: Complaint registration result with complaint ID

#### POST `/api/bbps/complaint/track`
Track complaint status
- Body: `{ complaint_id, complaint_type? }` (complaint_type defaults to 'Service')
- Returns: Complaint tracking details

#### GET `/api/wallet/balance`
Get wallet balance for current retailer
- Returns: Current wallet balance

#### GET `/api/wallet/transactions`
Get wallet transaction history
- Query params: `limit`, `offset`, `type` (optional)
- Returns: List of wallet transactions

## Wallet Integration

The BBPS integration is fully integrated with the wallet system:

1. **Wallet Debit**: When a bill is paid, the amount is debited from the retailer's wallet
2. **Automatic Refund**: If payment fails, the wallet is automatically refunded
3. **Transaction Tracking**: All BBPS transactions are recorded in `bbps_transactions` table
4. **Ledger Entries**: Wallet debits/refunds are recorded in `wallet_ledger` table

## Transaction Flow

1. Retailer selects biller and enters consumer number
2. System fetches bill details from BBPS API
3. Retailer confirms payment
4. System debits wallet balance
5. System makes payment request to BBPS API
6. On success: Transaction marked as successful
7. On failure: Wallet is refunded, transaction marked as failed

## Error Handling

The system handles various error scenarios:
- Insufficient wallet balance
- BBPS API errors
- Network failures
- Invalid consumer numbers
- Bill fetch failures

All errors are displayed to the user with appropriate messages.

## Security Considerations

1. **API Keys**: Store API keys securely in environment variables
2. **IP Whitelisting**: Ensure only whitelisted IPs can access BBPS API
3. **Authentication**: Implement proper signature generation for API calls
4. **RLS Policies**: Review and tighten RLS policies in production
5. **Rate Limiting**: Consider implementing rate limiting for API calls

## Testing

1. **Test with Small Amounts**: Start with small bill amounts for testing
2. **Verify Wallet Balance**: Ensure wallet balance updates correctly
3. **Check Transaction Records**: Verify transactions are recorded properly
4. **Test Error Scenarios**: Test with invalid consumer numbers, insufficient balance, etc.

## Troubleshooting

### Billers Not Loading
- Check BBPS API credentials
- Verify API endpoint is correct
- Check network connectivity from EC2 instance
- Review API response format

### Payment Failures
- Verify wallet has sufficient balance
- Check BBPS API status
- Review error messages in transaction records
- Verify consumer number format

### Wallet Not Updating
- Check database functions are created correctly
- Verify RLS policies allow wallet operations
- Review transaction logs for errors

## Future Enhancements

- [ ] Payout API integration
- [ ] Transaction status polling
- [ ] Bill payment history
- [ ] Recurring bill payments
- [ ] Commission calculation for BBPS transactions
- [ ] Admin dashboard for BBPS transactions
- [ ] Webhook support for payment status updates

## Support

For issues or questions:
1. Check the error logs in Supabase
2. Review API response in browser network tab
3. Verify environment variables are set correctly
4. Check EC2 instance connectivity

