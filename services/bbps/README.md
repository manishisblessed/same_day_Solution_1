# BBPS API Integration

Complete SparkUpTech BBPS API integration with automatic mock/real API switching.

## 📁 Folder Structure

```
src/services/bbps/
├── index.ts                    # Main exports
├── config.ts                   # Configuration and environment
├── helpers.ts                  # Shared utility functions
├── bbpsClient.ts              # HTTP client wrapper
├── types.ts                    # TypeScript type definitions
├── getBillersByCategory.ts     # Get billers by category
├── fetchBillerInfo.ts          # Fetch biller information
├── fetchBill.ts                # Fetch bill details
├── payRequest.ts               # Process payment
├── transactionStatus.ts        # Get transaction status
├── complaintRegistration.ts    # Register complaint
├── complaintTracking.ts        # Track complaint
└── mocks/                      # Mock implementations
    ├── getBillersByCategory.ts
    ├── fetchBillerInfo.ts
    ├── fetchBill.ts
    ├── payRequest.ts
    ├── transactionStatus.ts
    ├── complaintRegistration.ts
    └── complaintTracking.ts
```

## 🔧 Configuration

### Environment Variables

```env
# BBPS API Configuration
BBPS_API_BASE_URL=https://api.sparkuptech.in/api/ba
BBPS_PARTNER_ID=your_partner_id
BBPS_CONSUMER_KEY=your_consumer_key
BBPS_CONSUMER_SECRET=your_consumer_secret

# Mock Mode (optional)
BBPS_USE_MOCK=true  # Use mock data instead of real API
BBPS_FORCE_REAL_API=true  # Force real API even in dev

# API Timeout (optional, default: 60000ms)
BBPS_API_TIMEOUT=60000
```

### Mock Mode

Mock mode is automatically enabled when:
- `BBPS_USE_MOCK=true` is set, OR
- `APP_ENV=dev` (unless `BBPS_FORCE_REAL_API=true`)

## 📚 Usage Examples

### 1. Get Billers by Category

```typescript
import { getBillersByCategory } from '@/services/bbps'

const billers = await getBillersByCategory({
  category: 'Electricity',
  limit: 100
})

console.log(`Found ${billers.length} billers`)
```

### 2. Fetch Biller Information

```typescript
import { fetchBillerInfo } from '@/services/bbps'

const billerInfo = await fetchBillerInfo({
  billerId: 'AEML00000NATD1'
})

console.log('Biller supports bill fetch:', billerInfo.supportBillFetch)
console.log('Input params:', billerInfo.billerInputParams)
```

### 3. Fetch Bill Details

```typescript
import { fetchBill } from '@/services/bbps'

const billDetails = await fetchBill({
  billerId: 'AEML00000NATD1',
  consumerNumber: '1234567890',
  inputParams: [
    { paramName: 'Consumer Number', paramValue: '1234567890' }
  ]
})

console.log('Bill Amount:', billDetails.bill_amount)
console.log('Due Date:', billDetails.due_date)
```

### 4. Pay Bill

```typescript
import { payRequest, generateAgentTransactionId } from '@/services/bbps'

const agentTxnId = generateAgentTransactionId('retailer-123')

const paymentResponse = await payRequest({
  billerId: 'AEML00000NATD1',
  consumerNumber: '1234567890',
  amount: 1000,
  agentTransactionId: agentTxnId,
  inputParams: [
    { paramName: 'Consumer Number', paramValue: '1234567890' }
  ]
})

if (paymentResponse.success) {
  console.log('Payment successful!')
  console.log('Transaction ID:', paymentResponse.transaction_id)
} else {
  console.error('Payment failed:', paymentResponse.error_message)
}
```

### 5. Check Transaction Status

```typescript
import { transactionStatus } from '@/services/bbps'

const status = await transactionStatus({
  transactionId: 'CC015056BAAE00071350',
  trackType: 'TRANS_REF_ID'
})

console.log('Transaction Status:', status.status)
console.log('Payment Status:', status.payment_status)
```

### 6. Register Complaint

```typescript
import { complaintRegistration } from '@/services/bbps'

const complaint = await complaintRegistration({
  transactionId: 'CC014110BAAE00054718',
  complaintType: 'Transaction',
  description: 'Amount deducted multiple times',
  complaintDisposition: 'Amount deducted multiple times'
})

if (complaint.success) {
  console.log('Complaint registered:', complaint.complaint_id)
}
```

### 7. Track Complaint

```typescript
import { complaintTracking } from '@/services/bbps'

const complaintStatus = await complaintTracking({
  complaintId: 'CC0125126291941',
  complaintType: 'Service'
})

console.log('Complaint Status:', complaintStatus.status)
console.log('Resolution:', complaintStatus.resolution)
```

## 🔄 Complete Payment Flow

```typescript
import {
  getBillersByCategory,
  fetchBillerInfo,
  fetchBill,
  payRequest,
  transactionStatus,
  generateAgentTransactionId
} from '@/services/bbps'

async function processBillPayment(
  category: string,
  consumerNumber: string,
  retailerId: string
) {
  try {
    // Step 1: Get billers
    const billers = await getBillersByCategory({ category })
    const biller = billers[0] // Select first biller
    
    // Step 2: Get biller info (optional, for validation)
    const billerInfo = await fetchBillerInfo({ billerId: biller.biller_id })
    
    // Step 3: Fetch bill details
    const billDetails = await fetchBill({
      billerId: biller.biller_id,
      consumerNumber,
    })
    
    // Step 4: Process payment
    const agentTxnId = generateAgentTransactionId(retailerId)
    const paymentResponse = await payRequest({
      billerId: biller.biller_id,
      consumerNumber,
      amount: billDetails.bill_amount,
      agentTransactionId: agentTxnId,
      inputParams: [
        { paramName: 'Consumer Number', paramValue: consumerNumber }
      ],
    })
    
    if (!paymentResponse.success) {
      throw new Error(paymentResponse.error_message)
    }
    
    // Step 5: Verify transaction status
    const status = await transactionStatus({
      transactionId: paymentResponse.transaction_id!,
    })
    
    return {
      success: true,
      transactionId: paymentResponse.transaction_id,
      status: status.status,
    }
  } catch (error) {
    console.error('Payment flow error:', error)
    throw error
  }
}
```

## 📊 Logging

All API calls are automatically logged with:
- API name
- Request ID (reqId)
- Biller ID (if applicable)
- Status code
- Response code

Logs never expose secrets (consumer secret is masked).

Example log output:
```json
[BBPS API] {"api":"getBillersByCategory","reqId":"ABC123...","timestamp":"2024-01-06T11:00:00.000Z","status":200}
```

## ⚠️ Error Handling

All services throw errors with descriptive messages. Always wrap calls in try-catch:

```typescript
try {
  const billers = await getBillersByCategory({ category: 'Electricity' })
} catch (error) {
  console.error('Failed to fetch billers:', error.message)
  // Handle error appropriately
}
```

## 🔐 Security

- Credentials are never logged
- All API calls are server-side only
- Request IDs are generated for tracking
- Timeout protection prevents hanging requests

## 🧪 Testing

Mock mode is perfect for local development and testing:

```env
BBPS_USE_MOCK=true
```

Mock responses simulate real API behavior including:
- Success/failure scenarios
- Realistic data structures
- Response delays
- Error codes

## 📝 Notes

- All services are async/await
- Request IDs are auto-generated if not provided
- Mock mode switches automatically based on environment
- All responses are typed with TypeScript
- Production-ready error handling and logging

